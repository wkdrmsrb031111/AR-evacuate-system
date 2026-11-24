"""Download a consistent copy of saved prototype data; no restore writes."""
from contextlib import closing
from datetime import datetime, timezone
import hashlib
from io import BytesIO
import json
from pathlib import Path
import sqlite3
import tempfile
from zipfile import ZipFile, ZIP_DEFLATED

from fastapi.responses import Response
from server.connections import encode_link


def create_backup(database: Path):
    exported_at = datetime.now(timezone.utc)
    output = BytesIO()
    with tempfile.TemporaryDirectory() as temporary:
        snapshot_path = Path(temporary) / 'evacuate.sqlite3'
        with closing(sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True, timeout=10)) as source:
            with closing(sqlite3.connect(snapshot_path)) as snapshot:
                # SQLite's backup API includes committed WAL data and creates one consistent snapshot.
                source.backup(snapshot)
                snapshot.row_factory = sqlite3.Row
                places = []
                for row in snapshot.execute('SELECT * FROM places ORDER BY id'):
                    places.append({
                        **{key: row[key] for key in ('id','building','floor','room','kind')},
                        'createdAt': row['created_at'],
                        **({'deletedAt':row['deleted_at']} if row['deleted_at'] else {}),
                    })
                connections = [encode_link(row) for row in snapshot.execute('SELECT * FROM connections ORDER BY id')]
                photos = snapshot.execute('SELECT * FROM photos ORDER BY place_id').fetchall()
                database_id = snapshot.execute("SELECT value FROM settings WHERE key='database_id'").fetchone()[0]
                manifest = {
                    'format': 'ar-evacuate-backup', 'formatVersion': 1,
                    'exportedAt': exported_at.isoformat(), 'databaseId': database_id,
                    'summary': {
                        'placeCount':len(places), 'activePlaceCount':sum(not place.get('deletedAt') for place in places),
                        'connectionCount':len(connections), 'photoCount':len(photos),
                    },
                    'places':places, 'connections':connections, 'photos':[],
                }
                with ZipFile(output, 'w', compression=ZIP_DEFLATED, compresslevel=6) as archive:
                    for index, photo in enumerate(photos, start=1):
                        # Original names and place IDs never become filesystem paths.
                        filename = f'photos/photo-{index:04d}.jpg'
                        archive.writestr(filename,photo['content'])
                        manifest['photos'].append({'placeId':photo['place_id'],'name':photo['name'],
                            'savedAt':photo['saved_at'],'fileName':filename,
                            'sha256':hashlib.sha256(photo['content']).hexdigest()})
                    archive.writestr('data.json',json.dumps(manifest,ensure_ascii=False,indent=2))
                    archive.write(snapshot_path,'database/evacuate.sqlite3')
                    archive.writestr('README.txt',
                        'AR Evacuate 등록 정보 백업\n'
                        'This archive contains a complete snapshot of saved places, photos, connections and blocked states.\n'
                        'It includes trashed records. It does not include application source code or browser drafts.\n'
                        'data.json: readable data and photo references (formatVersion 1).\n'
                        'photos/: JPEG photos. Original names are stored only in data.json.\n'
                        'database/evacuate.sqlite3: complete SQLite snapshot.\n'
                        'The web interface currently supports export only; importing/restoring a backup is not implemented.\n')
    return output.getvalue(), f'ar-evacuate-backup-{exported_at:%Y%m%dT%H%M%SZ}.zip'


def register_backup_routes(app, database: Path):
    @app.get('/api/backup')
    def download_backup():
        content, filename = create_backup(database)
        return Response(content, media_type='application/zip', headers={
            'Content-Disposition': f'attachment; filename="{filename}"',
            'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        })
