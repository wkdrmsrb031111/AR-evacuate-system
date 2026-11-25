"""Local prototype API. Run on 127.0.0.1; no public deployment/auth yet."""
from contextlib import contextmanager
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
import sqlite3
import warnings
from uuid import UUID, uuid4
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field, ValidationError, field_validator
from server.app_routes import register_app_routes
from server.connections import register_connection_routes
from server.readiness import register_readiness_routes
from server.backup import register_backup_routes

MAX_UPLOAD = 15 * 1024 * 1024


def now():
    return datetime.now(timezone.utc).isoformat()


class PlaceValues(BaseModel):
    building: str = Field(min_length=1, max_length=60)
    floor: str = Field(min_length=1, max_length=30)
    room: str = Field(min_length=1, max_length=60)
    kind: Literal['room', 'corridor', 'stairs', 'exit'] = 'room'

    @field_validator('building', 'floor', 'room', mode='before')
    @classmethod
    def normalize(cls, value):
        return ' '.join(value.split()) if isinstance(value, str) else value


class ImportedPlace(PlaceValues):
    id: UUID
    createdAt: datetime
    deletedAt: datetime | None = None


class ImportedPhoto(BaseModel):
    placeId: UUID
    name: str = Field(min_length=1, max_length=255)
    fileName: str


class ImportManifest(BaseModel):
    places: list[ImportedPlace] = Field(max_length=1000)
    photos: list[ImportedPhoto] = Field(default_factory=list, max_length=1000)


def encode_place(row):
    result = {key: row[key] for key in ('id', 'building', 'floor', 'room', 'kind')}
    result['createdAt'] = row['created_at']
    if row['deleted_at']:
        result['deletedAt'] = row['deleted_at']
    return result


def encode_photo(row):
    return {'placeId': row['place_id'], 'name': row['name'], 'savedAt': row['saved_at']}


def image_bytes(upload: UploadFile):
    content = upload.file.read(MAX_UPLOAD + 1)
    if len(content) > MAX_UPLOAD:
        raise HTTPException(413, '15MB 이하의 사진을 선택해 주세요.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as image:
                if image.format not in ('JPEG', 'PNG', 'WEBP'):
                    raise HTTPException(415, 'JPG, PNG, WebP 사진만 저장할 수 있어요.')
                image = ImageOps.exif_transpose(image)
                image.thumbnail((1600, 1600))
                rgba = image.convert('RGBA')
                flattened = Image.new('RGB', rgba.size, 'white')
                flattened.paste(rgba, mask=rgba.getchannel('A'))
                output = BytesIO()
                flattened.save(output, 'JPEG', quality=85)
                return output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(422, '사진을 열 수 없어요. 올바른 JPG, PNG, WebP 파일을 선택해 주세요.')


def create_app(data_dir: Path | None = None):
    data_dir = data_dir or Path(__file__).parent / 'data'
    data_dir.mkdir(parents=True, exist_ok=True)
    database = data_dir / 'evacuate.sqlite3'

    @contextmanager
    def connection():
        db = sqlite3.connect(database, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            with db:
                yield db
        finally:
            db.close()

    with connection() as db:
        db.executescript('''
          CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS places (
            id TEXT PRIMARY KEY, building TEXT NOT NULL, floor TEXT NOT NULL, room TEXT NOT NULL,
            building_key TEXT NOT NULL, floor_key TEXT NOT NULL, room_key TEXT NOT NULL,
            created_at TEXT NOT NULL, deleted_at TEXT
          );
          CREATE UNIQUE INDEX IF NOT EXISTS active_place_name
            ON places(building_key, floor_key, room_key) WHERE deleted_at IS NULL;
          CREATE TABLE IF NOT EXISTS photos (
            place_id TEXT PRIMARY KEY REFERENCES places(id), name TEXT NOT NULL,
            content BLOB NOT NULL, saved_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS connections (
            id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES places(id),
            target_id TEXT NOT NULL REFERENCES places(id), pair_a TEXT NOT NULL, pair_b TEXT NOT NULL,
            distance_meters REAL NOT NULL CHECK(distance_meters>0 AND distance_meters<=1000),
            forward_instruction TEXT NOT NULL, reverse_instruction TEXT NOT NULL,
            created_at TEXT NOT NULL, deleted_at TEXT,
            CHECK(source_id<>target_id)
          );
          CREATE UNIQUE INDEX IF NOT EXISTS active_connection_pair
            ON connections(pair_a,pair_b) WHERE deleted_at IS NULL;
        ''')
        if 'kind' not in {row['name'] for row in db.execute('PRAGMA table_info(places)')}:
            db.execute("ALTER TABLE places ADD COLUMN kind TEXT NOT NULL DEFAULT 'room' CHECK(kind IN ('room','corridor','stairs','exit'))")
        link_columns = {row['name'] for row in db.execute('PRAGMA table_info(connections)')}
        for name, definition in (
            ('blocked', 'INTEGER NOT NULL DEFAULT 0 CHECK(blocked IN (0,1))'),
            ('blocked_reason', "TEXT NOT NULL DEFAULT ''"),
            ('blocked_at', 'TEXT'),
            ('forward_direction', "TEXT CHECK(forward_direction IN ('left','straight','right'))"),
            ('reverse_direction', "TEXT CHECK(reverse_direction IN ('left','straight','right'))"),
            ('forward_facing_hint', "TEXT NOT NULL DEFAULT ''"),
            ('reverse_facing_hint', "TEXT NOT NULL DEFAULT ''"),
            ('forward_sign_text', "TEXT NOT NULL DEFAULT ''"),
            ('reverse_sign_text', "TEXT NOT NULL DEFAULT ''"),
        ):
            if name not in link_columns:
                db.execute(f'ALTER TABLE connections ADD COLUMN {name} {definition}')
        db.execute('INSERT OR IGNORE INTO settings VALUES (?, ?)', ('database_id', str(uuid4())))

    app = FastAPI(title='AR Evacuate 로컬 서버', version='0.1.0')

    @app.middleware('http')
    async def local_origins(request: Request, call_next):
        origin = request.headers.get('origin')
        if request.method not in ('GET', 'HEAD', 'OPTIONS') and origin and origin not in (
            'http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:8000', 'http://localhost:8000'
        ):
            return JSONResponse(status_code=403, content={'detail': '허용된 로컬 관리자 화면에서 요청해 주세요.'})
        return await call_next(request)

    @app.exception_handler(sqlite3.IntegrityError)
    async def integrity_error(_request, _error):
        return JSONResponse(status_code=409, content={'detail': '같은 건물·층·방 이름의 장소가 이미 있어요. 이름을 확인해 주세요.'})

    def require_place(db, place_id: str, active=True):
        row = db.execute('SELECT * FROM places WHERE id=?', (place_id,)).fetchone()
        if not row or (active and row['deleted_at']):
            raise HTTPException(404, '장소를 찾을 수 없어요. 목록을 새로고침해 주세요.')
        return row

    def list_places(db):
        return [encode_place(row) for row in db.execute('SELECT * FROM places ORDER BY created_at DESC, id')]

    @app.get('/api/status')
    def status():
        with connection() as db:
            return {'status': 'ok', 'databaseId': db.execute('SELECT value FROM settings WHERE key=?', ('database_id',)).fetchone()[0]}

    @app.get('/api/places')
    def get_places():
        with connection() as db:
            return list_places(db)

    @app.post('/api/places', status_code=201)
    def add_place(values: PlaceValues):
        place_id, created_at = str(uuid4()), now()
        with connection() as db:
            db.execute('INSERT INTO places (id,building,floor,room,building_key,floor_key,room_key,created_at,deleted_at,kind) VALUES (?,?,?,?,?,?,?,?,?,?)', (
                place_id, values.building, values.floor, values.room,
                values.building.casefold(), values.floor.casefold(), values.room.casefold(), created_at, None, values.kind))
            return encode_place(require_place(db, place_id))

    @app.put('/api/places/{place_id}')
    def edit_place(place_id: UUID, values: PlaceValues):
        with connection() as db:
            current = require_place(db, str(place_id))
            if (current['building_key'], current['floor_key']) != (values.building.casefold(), values.floor.casefold()):
                linked = db.execute('SELECT 1 FROM connections WHERE deleted_at IS NULL AND (source_id=? OR target_id=?) LIMIT 1',
                                    (str(place_id),str(place_id))).fetchone()
                if linked:
                    raise HTTPException(409, '이 장소에 이동 경로가 연결되어 있어요. 연결을 삭제한 뒤 건물·층을 변경해 주세요. 이름과 종류는 바로 수정할 수 있어요.')
            db.execute('UPDATE places SET building=?,floor=?,room=?,building_key=?,floor_key=?,room_key=?,kind=? WHERE id=?', (
                values.building, values.floor, values.room, values.building.casefold(), values.floor.casefold(), values.room.casefold(), values.kind, str(place_id)))
            return encode_place(require_place(db, str(place_id)))

    @app.delete('/api/places/{place_id}')
    def trash_place(place_id: UUID):
        with connection() as db:
            require_place(db, str(place_id), active=False)
            db.execute('UPDATE places SET deleted_at=COALESCE(deleted_at,?) WHERE id=?', (now(), str(place_id)))
            return encode_place(require_place(db, str(place_id), active=False))

    @app.post('/api/places/{place_id}/restore')
    def restore_place(place_id: UUID):
        with connection() as db:
            require_place(db, str(place_id), active=False)
            db.execute('UPDATE places SET deleted_at=NULL WHERE id=?', (str(place_id),))
            return encode_place(require_place(db, str(place_id)))

    @app.get('/api/places/{place_id}/photo')
    def photo_info(place_id: UUID):
        with connection() as db:
            require_place(db, str(place_id))
            row = db.execute('SELECT place_id,name,saved_at FROM photos WHERE place_id=?', (str(place_id),)).fetchone()
            return encode_photo(row) if row else None

    @app.get('/api/places/{place_id}/photo/content')
    def photo_content(place_id: UUID):
        with connection() as db:
            require_place(db, str(place_id))
            row = db.execute('SELECT content FROM photos WHERE place_id=?', (str(place_id),)).fetchone()
            if not row:
                raise HTTPException(404, '등록된 사진이 없어요.')
            return Response(content=row['content'], media_type='image/jpeg', headers={'Cache-Control': 'no-store'})

    @app.put('/api/places/{place_id}/photo')
    def upload_photo(place_id: UUID, file: UploadFile = File(), name: str = Form(min_length=1, max_length=255)):
        content, saved_at = image_bytes(file), now()
        with connection() as db:
            require_place(db, str(place_id))
            db.execute('INSERT INTO photos VALUES (?,?,?,?) ON CONFLICT(place_id) DO UPDATE SET name=excluded.name,content=excluded.content,saved_at=excluded.saved_at',
                       (str(place_id), name, content, saved_at))
        return {'placeId': str(place_id), 'name': name, 'savedAt': saved_at}

    @app.post('/api/import')
    def import_legacy(manifest: str = Form(), files: list[UploadFile] = File(default=[])):
        try:
            data = ImportManifest.model_validate_json(manifest)
        except ValidationError:
            raise HTTPException(422, '복사할 장소·사진 데이터의 형식이 올바르지 않아요.')
        place_ids = {str(place.id) for place in data.places}
        photo_ids = {str(photo.placeId) for photo in data.photos}
        filenames = [file.filename for file in files]
        if len(place_ids) != len(data.places) or len(photo_ids) != len(data.photos) or not photo_ids.issubset(place_ids):
            raise HTTPException(422, '중복되거나 연결할 장소가 없는 사진이 있어요.')
        if len(set(filenames)) != len(files) or set(filenames) != {photo.fileName for photo in data.photos}:
            raise HTTPException(422, '사진 목록과 실제 첨부 파일이 일치하지 않아요.')
        prepared = {file.filename: image_bytes(file) for file in files}
        imported_places = imported_photos = 0
        with connection() as db:
            # One transaction: any conflict leaves all existing server data unchanged.
            for place in data.places:
                if db.execute('SELECT 1 FROM places WHERE id=?', (str(place.id),)).fetchone():
                    continue  # Retry never overwrites newer server edits.
                db.execute('INSERT INTO places (id,building,floor,room,building_key,floor_key,room_key,created_at,deleted_at,kind) VALUES (?,?,?,?,?,?,?,?,?,?)', (
                    str(place.id), place.building, place.floor, place.room,
                    place.building.casefold(), place.floor.casefold(), place.room.casefold(),
                    place.createdAt.isoformat(), place.deletedAt.isoformat() if place.deletedAt else None, place.kind))
                imported_places += 1
            for photo in data.photos:
                if db.execute('SELECT 1 FROM photos WHERE place_id=?', (str(photo.placeId),)).fetchone():
                    continue
                db.execute('INSERT INTO photos VALUES (?,?,?,?)', (str(photo.placeId), photo.name, prepared[photo.fileName], now()))
                imported_photos += 1
            return {'places': list_places(db), 'importedPlaces': imported_places, 'importedPhotos': imported_photos}

    register_connection_routes(app, connection)
    register_readiness_routes(app, connection)
    register_backup_routes(app, database)
    register_app_routes(app, database)
    return app


app = create_app()
