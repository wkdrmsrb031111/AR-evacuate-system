"""Read-only contract for the Unity app; no admin writes or trash records."""
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
from uuid import UUID

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, Response
from server.connections import list_app_links
from server.routing import nearest_stairs


def register_app_routes(app: FastAPI, database: Path):
    @contextmanager
    def read_database():
        try:
            db = sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True, timeout=10)
        except sqlite3.OperationalError:
            raise HTTPException(503, '데이터베이스를 열 수 없어요. 관리자 로컬 서버를 먼저 실행해 주세요.')
        db.row_factory = sqlite3.Row
        try:
            yield db
        finally:
            db.close()

    def encode(row):
        return {
            'id': row['id'], 'building': row['building'], 'floor': row['floor'], 'room': row['room'],
            'kind': row['kind'],
            'hasPhoto': row['photo_updated_at'] is not None,
            'photoUrl': f"/api/app/places/{row['id']}/photo" if row['photo_updated_at'] else None,
            'photoUpdatedAt': row['photo_updated_at'],
        }

    select = '''SELECT p.id,p.building,p.floor,p.room,p.kind,f.saved_at AS photo_updated_at
                FROM places p LEFT JOIN photos f ON f.place_id=p.id WHERE p.deleted_at IS NULL'''

    @app.get('/api/app/status', tags=['App read-only'])
    def app_status():
        with read_database() as db:
            db.execute('SELECT 1 FROM places LIMIT 1').fetchone()
        return {'status': 'ok', 'service': 'AR Evacuate App API', 'schemaVersion': 1}

    @app.get('/api/app/places', tags=['App read-only'])
    def app_places():
        with read_database() as db:
            places = [encode(row) for row in db.execute(select + ' ORDER BY p.building_key,p.floor_key,p.room_key,p.id')]
        return {'schemaVersion': 1, 'generatedAt': datetime.now(timezone.utc).isoformat(), 'count': len(places), 'places': places}

    @app.get('/api/app/connections', tags=['App read-only'])
    def app_connections():
        with read_database() as db:
            links = list_app_links(db)
        return {'schemaVersion': 1, 'count': len(links), 'connections': links}

    @app.get('/api/app/routes/nearest-stairs', tags=['App read-only'])
    def nearest_stairs_route(sourceId: UUID):
        with read_database() as db:
            # Keep source, places and links in a single consistent read snapshot.
            db.execute('BEGIN')
            return nearest_stairs(db, str(sourceId))

    @app.get('/api/app/places/{place_id}', tags=['App read-only'])
    def app_place(place_id: UUID):
        with read_database() as db:
            row = db.execute(select + ' AND p.id=?', (str(place_id),)).fetchone()
            if not row:
                raise HTTPException(404, '앱에서 사용할 수 없는 장소예요. 장소 목록을 다시 불러와 주세요.')
            return {'schemaVersion': 1, 'place': encode(row)}

    @app.get('/api/app/places/{place_id}/photo', tags=['App read-only'])
    def app_photo(place_id: UUID):
        with read_database() as db:
            row = db.execute('''SELECT f.content FROM photos f JOIN places p ON p.id=f.place_id
                                WHERE p.id=? AND p.deleted_at IS NULL''', (str(place_id),)).fetchone()
            if not row:
                raise HTTPException(404, '장소 또는 등록된 사진을 찾을 수 없어요. 장소 목록을 다시 불러와 주세요.')
            return Response(content=row['content'], media_type='image/jpeg', headers={'Cache-Control': 'no-store'})

    @app.get('/app-test', response_class=HTMLResponse, include_in_schema=False)
    def app_test():
        return HTMLResponse((Path(__file__).parent / 'app_test.html').read_text(encoding='utf-8'))
