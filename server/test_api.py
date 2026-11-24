from io import BytesIO
import json
import sqlite3
import hashlib
from contextlib import closing
from zipfile import ZipFile
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image

from server.main import create_app
from server.app_reader import create_reader


def photo_bytes():
    image = Image.new('RGB', (40, 30), '#137d70')
    output = BytesIO()
    image.save(output, 'PNG')
    return output.getvalue()


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.path = Path(self.folder.name)
        self.client = TestClient(create_app(self.path))

    def tearDown(self):
        self.client.close()
        self.folder.cleanup()

    def add(self, room='제3회의실'):
        result = self.client.post('/api/places', json={'building': ' 본관 ', 'floor': '2층', 'room': room})
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def upload(self, place_id):
        result = self.client.put(f'/api/places/{place_id}/photo', data={'name': 'door.png'}, files={'file': ('door.png', photo_bytes(), 'image/png')})
        self.assertEqual(result.status_code, 200, result.text)

    def test_backup_empty_is_valid_and_not_exposed_on_reader(self):
        result = self.client.get('/api/backup')
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.headers['content-type'],'application/zip')
        self.assertEqual(result.headers['cache-control'],'no-store')
        self.assertRegex(result.headers['content-disposition'],r'attachment; filename="ar-evacuate-backup-\d{8}T\d{6}Z.zip"')
        with ZipFile(BytesIO(result.content)) as archive:
            self.assertIsNone(archive.testzip())
            manifest = json.loads(archive.read('data.json'))
            self.assertEqual(manifest['format'],'ar-evacuate-backup')
            self.assertEqual(manifest['formatVersion'],1)
            self.assertEqual(manifest['summary'],{'placeCount':0,'activePlaceCount':0,'connectionCount':0,'photoCount':0})
            self.assertEqual(manifest['places'],[])
            self.assertIn('database/evacuate.sqlite3',archive.namelist())
        self.assertEqual(self.client.post('/api/backup',json={}).status_code,405)
        with TestClient(create_reader(self.path)) as reader:
            self.assertEqual(reader.get('/api/backup').status_code,404)

    def test_backup_preserves_photos_blocked_and_deleted_records_without_writes(self):
        source, stairs, deleted = self.add('회의실'), self.add('계단'), self.add('삭제할 방')
        self.upload(source['id']); self.upload(deleted['id'])
        renamed_photo = self.client.put(f"/api/places/{source['id']}/photo",data={'name':'../../원본 사진.jpg'},
            files={'file':('door.png',photo_bytes(),'image/png')})
        self.assertEqual(renamed_photo.status_code,200)
        values = {'sourceId':source['id'],'targetId':stairs['id'],'distanceMeters':8,
                  'forwardInstruction':'계단 쪽','reverseInstruction':'회의실 쪽'}
        link = self.client.post('/api/connections',json=values).json()
        self.client.patch(f"/api/connections/{link['id']}/availability",json={'blocked':True,'reason':'통로 폐쇄'})
        old_link = self.client.post('/api/connections',json={**values,'targetId':deleted['id']}).json()
        self.client.delete(f"/api/connections/{old_link['id']}")
        self.client.delete(f"/api/places/{deleted['id']}")
        before = self.client.get('/api/places').json(), self.client.get('/api/connections').json(), self.client.get('/api/status').json()
        original_photo = self.client.get(f"/api/places/{source['id']}/photo/content").content
        result = self.client.get('/api/backup')
        self.assertEqual(result.status_code,200)
        self.assertEqual(before,(self.client.get('/api/places').json(),self.client.get('/api/connections').json(),self.client.get('/api/status').json()))
        with ZipFile(BytesIO(result.content)) as archive:
            self.assertIsNone(archive.testzip())
            manifest = json.loads(archive.read('data.json'))
            self.assertEqual(manifest['summary'],{'placeCount':3,'activePlaceCount':2,'connectionCount':2,'photoCount':2})
            self.assertEqual(manifest['databaseId'],before[2]['databaseId'])
            self.assertEqual(manifest['places'],sorted(before[0],key=lambda item:item['id']))
            self.assertEqual(manifest['connections'],sorted(before[1],key=lambda item:item['id']))
            self.assertTrue(all('..' not in name and not name.startswith('/') for name in archive.namelist()))
            photo = next(item for item in manifest['photos'] if item['placeId']==source['id'])
            self.assertEqual(photo['name'],'../../원본 사진.jpg')
            self.assertEqual(archive.read(photo['fileName']),original_photo)
            self.assertEqual(photo['sha256'],hashlib.sha256(original_photo).hexdigest())
            copy_path = self.path / 'backup-check.sqlite3'
            copy_path.write_bytes(archive.read('database/evacuate.sqlite3'))
        with closing(sqlite3.connect(copy_path)) as snapshot:
            self.assertEqual(snapshot.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            self.assertEqual(snapshot.execute('SELECT blocked,blocked_reason FROM connections WHERE id=?',(link['id'],)).fetchone(),(1,'통로 폐쇄'))
            self.assertIsNotNone(snapshot.execute('SELECT deleted_at FROM places WHERE id=?',(deleted['id'],)).fetchone()[0])
            self.assertIsNotNone(snapshot.execute('SELECT deleted_at FROM connections WHERE id=?',(old_link['id'],)).fetchone()[0])
            self.assertEqual(snapshot.execute('SELECT content FROM photos WHERE place_id=?',(source['id'],)).fetchone()[0],original_photo)

    def test_demo_readiness_empty_and_admin_only(self):
        response = self.client.get('/api/checks/demo-readiness')
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.headers['cache-control'],'no-store')
        data = response.json()
        self.assertEqual(data['summary'], {'activePlaceCount':0,'roomCount':0,'reachableRoomCount':0,'needsRouteCount':0,'missingPhotoCount':0})
        self.assertEqual(data['checks'],[])
        self.assertEqual(data['missingPhotoPlaces'],[])
        with TestClient(create_reader(self.path)) as reader:
            self.assertEqual(reader.get('/api/checks/demo-readiness').status_code,404)

    def test_demo_readiness_categorizes_routes_and_photos_and_excludes_trash(self):
        source, isolated = self.add('회의실'), self.add('연결 없는 방')
        self.upload(source['id'])
        stairs = self.client.post('/api/places',json={'building':'본관','floor':'2층','room':'계단','kind':'stairs'}).json()
        other_floor = self.client.post('/api/places',json={'building':'본관','floor':'3층','room':'다른 층 회의실'}).json()
        deleted = self.add('삭제할 방')
        self.client.delete(f"/api/places/{deleted['id']}")
        self.client.post('/api/connections',json={'sourceId':source['id'],'targetId':stairs['id'],
            'distanceMeters':8,'forwardInstruction':'계단 쪽','reverseInstruction':'회의실 쪽'})
        before = self.client.get('/api/places').json(), self.client.get('/api/connections').json()
        for _ in range(2):
            report = self.client.get('/api/checks/demo-readiness').json()
            self.assertEqual(report['summary'], {'activePlaceCount':4,'roomCount':3,'reachableRoomCount':1,'needsRouteCount':2,'missingPhotoCount':3})
            checks = {item['place']['id']:item for item in report['checks']}
            self.assertEqual(checks[source['id']]['status'],'found')
            self.assertEqual(checks[source['id']]['totalDistanceMeters'],8)
            self.assertEqual(checks[isolated['id']]['status'],'unreachable')
            self.assertEqual(checks[other_floor['id']]['status'],'no_stairs')
            self.assertNotIn(stairs['id'],checks)
            self.assertNotIn(deleted['id'],checks)
            self.assertEqual({p['id'] for p in report['missingPhotoPlaces']},{isolated['id'],stairs['id'],other_floor['id']})
        self.assertEqual(before,(self.client.get('/api/places').json(),self.client.get('/api/connections').json()))

    def test_demo_readiness_respects_blocks_and_latest_photos(self):
        source = self.add('회의실')
        stairs = self.client.post('/api/places',json={'building':'본관','floor':'2층','room':'계단','kind':'stairs'}).json()
        link = self.client.post('/api/connections',json={'sourceId':source['id'],'targetId':stairs['id'],
            'distanceMeters':8,'forwardInstruction':'계단 쪽','reverseInstruction':'회의실 쪽'}).json()
        self.assertEqual(self.client.get('/api/checks/demo-readiness').json()['summary']['reachableRoomCount'],1)
        self.client.patch(f"/api/connections/{link['id']}/availability",json={'blocked':True,'reason':'통로 폐쇄'})
        blocked = self.client.get('/api/checks/demo-readiness').json()
        self.assertEqual(blocked['summary']['needsRouteCount'],1)
        self.assertEqual(blocked['checks'][0]['blockedConnectionCount'],1)
        self.assertEqual(blocked['checks'][0]['status'],'unreachable')
        self.upload(source['id']); self.upload(stairs['id'])
        self.client.patch(f"/api/connections/{link['id']}/availability",json={'blocked':False})
        ready = self.client.get('/api/checks/demo-readiness').json()
        self.assertEqual(ready['summary']['reachableRoomCount'],1)
        self.assertEqual(ready['summary']['missingPhotoCount'],0)

    def link_values(self):
        source, target = self.add('회의실'), self.add('복도')
        return {'sourceId': source['id'], 'targetId': target['id'], 'distanceMeters': 8,
                'forwardInstruction': '파란 문으로 이동하세요.', 'reverseInstruction': '회의실 문으로 이동하세요.'}

    def test_connection_create_edit_restart_and_rename(self):
        values = self.link_values()
        created = self.client.post('/api/connections', json=values)
        self.assertEqual(created.status_code, 201, created.text)
        link = created.json()
        self.assertTrue(link['bidirectional'])
        values.update(distanceMeters=12.5, reverseInstruction='표지판 아래 문으로 이동하세요.')
        edited = self.client.put(f"/api/connections/{link['id']}", json=values)
        self.assertEqual(edited.status_code, 200, edited.text)
        self.assertEqual(edited.json()['id'], link['id'])
        renamed = self.client.put(f"/api/places/{values['sourceId']}", json={'building':'본관','floor':'2층','room':'회의실 A'})
        self.assertEqual(renamed.status_code, 200)
        with TestClient(create_app(self.path)) as restarted:
            saved = restarted.get('/api/app/connections').json()['connections'][0]
            self.assertEqual(saved['distanceMeters'], 12.5)
            self.assertEqual(saved['reverseInstruction'], values['reverseInstruction'])
            self.assertEqual(saved['sourceId'], values['sourceId'])

    def test_connection_rejects_invalid_duplicate_and_other_floors(self):
        values = self.link_values()
        self.assertEqual(self.client.post('/api/connections', json=values).status_code, 201)
        for change in ({}, {'sourceId':values['targetId'], 'targetId':values['sourceId']}):
            self.assertEqual(self.client.post('/api/connections', json={**values, **change}).status_code, 409)
        for change in ({'targetId':values['sourceId']}, {'targetId':str(uuid4())}, {'distanceMeters':0},
                       {'distanceMeters':-1}, {'distanceMeters':1001}, {'distanceMeters':'NaN'}, {'forwardInstruction':'   '}):
            self.assertEqual(self.client.post('/api/connections', json={**values, **change}).status_code, 422)
        other = self.client.post('/api/places', json={'building':'별관','floor':'2층','room':'복도'}).json()
        self.assertEqual(self.client.post('/api/connections', json={**values,'targetId':other['id']}).status_code, 422)
        other = self.client.post('/api/places', json={'building':'본관','floor':'3층','room':'복도'}).json()
        self.assertEqual(self.client.post('/api/connections', json={**values,'targetId':other['id']}).status_code, 422)

    def test_connection_soft_delete_restore_and_conflict(self):
        values = self.link_values()
        link = self.client.post('/api/connections', json=values).json()
        endpoint = f"/api/connections/{link['id']}"
        self.assertEqual(self.client.delete(endpoint).status_code, 200)
        self.assertEqual(self.client.get('/api/app/connections').json()['count'], 0)
        self.assertEqual(self.client.put(endpoint, json=values).status_code, 409)
        self.assertEqual(self.client.post(endpoint+'/restore').status_code, 200)
        self.client.delete(endpoint)
        self.assertEqual(self.client.post('/api/connections', json=values).status_code, 201)
        self.assertEqual(self.client.post(endpoint+'/restore').status_code, 409)
        self.assertEqual(len(self.client.get('/api/connections').json()), 2)

    def test_connection_place_delete_restore_and_floor_move(self):
        values = self.link_values()
        link = self.client.post('/api/connections', json=values).json()
        endpoint = f"/api/places/{values['sourceId']}"
        moved = self.client.put(endpoint, json={'building':'본관','floor':'3층','room':'회의실'})
        self.assertEqual(moved.status_code, 409)
        self.client.delete(endpoint)
        self.assertEqual(self.client.get('/api/app/connections').json()['count'], 0)
        self.assertEqual(self.client.post('/api/connections', json=values).status_code, 422)
        self.client.post(endpoint+'/restore')
        self.assertEqual(self.client.get('/api/app/connections').json()['count'], 1)
        self.client.delete(f"/api/connections/{link['id']}")
        self.assertEqual(self.client.put(endpoint, json={'building':'본관','floor':'3층','room':'회의실'}).status_code, 200)
        self.assertEqual(self.client.post(f"/api/connections/{link['id']}/restore").status_code, 422)

    def test_reader_connection_contract_and_no_writes(self):
        values = self.link_values()
        link = self.client.post('/api/connections', json=values).json()
        with TestClient(create_reader(self.path)) as reader:
            result = reader.get('/api/app/connections').json()
            self.assertEqual(result['schemaVersion'], 1)
            self.assertEqual(result['connections'][0]['forwardInstruction'],values['forwardInstruction'])
            self.assertEqual(reader.post('/api/connections',json=values).status_code,404)
            self.assertEqual(reader.post('/api/app/connections',json=values).status_code,405)
            self.client.delete(f"/api/connections/{link['id']}")
            self.assertEqual(reader.get('/api/app/connections').json()['count'],0)

    def test_place_kind_persists_and_reaches_app(self):
        place = self.add()
        self.assertEqual(place['kind'], 'room')
        self.upload(place['id'])
        for kind in ('corridor', 'stairs', 'exit'):
            result = self.client.put(f"/api/places/{place['id']}", json={
                'building': '본관', 'floor': '2층', 'room': '테스트 장소', 'kind': kind})
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json()['kind'], kind)
            self.assertEqual(self.client.get(f"/api/app/places/{place['id']}").json()['place']['kind'], kind)
        invalid = self.client.put(f"/api/places/{place['id']}", json={
            'building': '본관', 'floor': '2층', 'room': '테스트 장소', 'kind': 'unknown'})
        self.assertEqual(invalid.status_code, 422)
        self.client.delete(f"/api/places/{place['id']}")
        self.assertEqual(self.client.post(f"/api/places/{place['id']}/restore").json()['kind'], 'exit')
        with TestClient(create_app(self.path)) as restarted:
            self.assertEqual(restarted.get('/api/app/places').json()['places'][0]['kind'], 'exit')
            self.assertEqual(restarted.get(f"/api/places/{place['id']}/photo/content").status_code, 200)

    def test_old_database_migration_keeps_places_and_photos(self):
        with tempfile.TemporaryDirectory() as old_dir:
            old_path = Path(old_dir)
            place_id = str(uuid4())
            with sqlite3.connect(old_path / 'evacuate.sqlite3') as db:
                db.executescript('''
                    CREATE TABLE places(id TEXT PRIMARY KEY,building TEXT NOT NULL,floor TEXT NOT NULL,room TEXT NOT NULL,
                    building_key TEXT NOT NULL,floor_key TEXT NOT NULL,room_key TEXT NOT NULL,created_at TEXT NOT NULL,deleted_at TEXT);
                    CREATE TABLE photos(place_id TEXT PRIMARY KEY REFERENCES places(id),name TEXT NOT NULL,content BLOB NOT NULL,saved_at TEXT NOT NULL);
                ''')
                db.execute('INSERT INTO places VALUES (?,?,?,?,?,?,?,?,?)',
                    (place_id,'본관','2층','기존 방','본관','2층','기존 방','2026-11-23T00:00:00Z',None))
                db.execute('INSERT INTO photos VALUES (?,?,?,?)', (place_id,'existing.jpg',b'preserved-photo','2026-11-23T00:00:00Z'))
            db.close()
            for _ in range(2):
                with TestClient(create_app(old_path)) as migrated:
                    saved = migrated.get('/api/places').json()[0]
                    self.assertEqual((saved['id'],saved['room'],saved['kind']), (place_id,'기존 방','room'))
                    self.assertEqual(migrated.get(f'/api/places/{place_id}/photo/content').content,b'preserved-photo')

    def test_create_edit_photo_and_restart(self):
        place = self.add()
        self.assertEqual(place['building'], '본관')
        self.upload(place['id'])
        edited = self.client.put(f"/api/places/{place['id']}", json={'building': '별관', 'floor': '3층', 'room': '회의실 B'})
        self.assertEqual(edited.json()['id'], place['id'])
        with TestClient(create_app(self.path)) as restarted:
            self.assertEqual(restarted.get('/api/places').json()[0]['room'], '회의실 B')
            image = restarted.get(f"/api/places/{place['id']}/photo/content")
            self.assertEqual(image.status_code, 200)
            self.assertEqual(image.headers['content-type'], 'image/jpeg')
            self.assertEqual(Image.open(BytesIO(image.content)).size, (40, 30))

    def test_duplicate_and_blank_values(self):
        self.add()
        duplicate = self.client.post('/api/places', json={'building': '본관', 'floor': '2층', 'room': '제3회의실'})
        self.assertEqual(duplicate.status_code, 409)
        blank = self.client.post('/api/places', json={'building': '  ', 'floor': '2층', 'room': '새 방'})
        self.assertEqual(blank.status_code, 422)
        self.assertEqual(len(self.client.get('/api/places').json()), 1)

    def test_trash_restore_conflict_and_photo(self):
        place = self.add()
        self.upload(place['id'])
        self.assertEqual(self.client.delete(f"/api/places/{place['id']}").status_code, 200)
        self.assertEqual(self.client.get(f"/api/places/{place['id']}/photo").status_code, 404)
        other = self.add()
        self.assertEqual(self.client.post(f"/api/places/{place['id']}/restore").status_code, 409)
        self.client.delete(f"/api/places/{other['id']}")
        self.assertEqual(self.client.post(f"/api/places/{place['id']}/restore").status_code, 200)
        self.assertEqual(self.client.get(f"/api/places/{place['id']}/photo").json()['name'], 'door.png')

    def test_bad_photo_keeps_previous(self):
        place = self.add()
        self.upload(place['id'])
        before = self.client.get(f"/api/places/{place['id']}/photo/content").content
        rejected = self.client.put(f"/api/places/{place['id']}/photo", data={'name': 'broken.jpg'}, files={'file': ('broken.jpg', b'not an image', 'image/jpeg')})
        self.assertEqual(rejected.status_code, 422)
        self.assertEqual(before, self.client.get(f"/api/places/{place['id']}/photo/content").content)

    def test_import_atomic_idempotent_and_keeps_server_edits(self):
        place_id = str(uuid4())
        manifest = {'places': [{'id': place_id, 'building': '본관', 'floor': '2층', 'room': '예전 방', 'createdAt': '2026-11-23T00:00:00Z'}],
                    'photos': [{'placeId': place_id, 'name': 'door.png', 'fileName': 'photo.png'}]}

        def copy():
            return self.client.post('/api/import', data={'manifest': json.dumps(manifest)}, files=[('files', ('photo.png', photo_bytes(), 'image/png'))])

        self.assertEqual(copy().json()['importedPhotos'], 1)
        self.client.put(f'/api/places/{place_id}', json={'building': '본관', 'floor': '2층', 'room': '최신 방'})
        repeated = copy().json()
        self.assertEqual(repeated['importedPlaces'], 0)
        self.assertEqual(repeated['importedPhotos'], 0)
        self.assertEqual(repeated['places'][0]['room'], '최신 방')
        manifest['photos'] = []
        manifest['places'] = [
            {'id': str(uuid4()), 'building': '본관', 'floor': '2층', 'room': '충돌 전 신규', 'createdAt': '2026-11-23T00:00:00Z'},
            {'id': str(uuid4()), 'building': '본관', 'floor': '2층', 'room': '최신 방', 'createdAt': '2026-11-23T00:00:00Z'},
        ]
        conflict = self.client.post('/api/import', data={'manifest': json.dumps(manifest)})
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(len(self.client.get('/api/places').json()), 1)

    def test_foreign_origin_cannot_write(self):
        result = self.client.post('/api/places', headers={'Origin': 'https://other.example'}, json={'building': '본관', 'floor': '2층', 'room': '회의실'})
        self.assertEqual(result.status_code, 403)
        self.assertEqual(self.client.get('/api/places').json(), [])

    def test_app_contract_excludes_deleted_places_and_photos(self):
        active = self.add('활성 방')
        deleted = self.add('삭제 방')
        self.upload(active['id'])
        self.upload(deleted['id'])
        self.client.delete(f"/api/places/{deleted['id']}")
        result = self.client.get('/api/app/places').json()
        self.assertEqual(result['schemaVersion'], 1)
        self.assertEqual(result['count'], 1)
        self.assertEqual(result['places'][0]['id'], active['id'])
        self.assertNotIn('deletedAt', result['places'][0])
        self.assertNotIn('name', result['places'][0])
        self.assertEqual(result['places'][0]['photoUrl'], f"/api/app/places/{active['id']}/photo")
        self.assertEqual(self.client.get(result['places'][0]['photoUrl']).status_code, 200)
        self.assertEqual(self.client.get(f"/api/app/places/{deleted['id']}").status_code, 404)
        self.assertEqual(self.client.get(f"/api/app/places/{deleted['id']}/photo").status_code, 404)

    def test_app_without_photo_and_empty_list(self):
        self.assertEqual(self.client.get('/api/app/places').json()['places'], [])
        place = self.add()
        detail = self.client.get(f"/api/app/places/{place['id']}").json()['place']
        self.assertFalse(detail['hasPhoto'])
        self.assertIsNone(detail['photoUrl'])
        self.assertEqual(self.client.get(f"/api/app/places/{place['id']}/photo").status_code, 404)
        self.assertEqual(self.client.get('/api/app/places/not-a-uuid').status_code, 422)

    def test_separate_reader_has_no_admin_mutations(self):
        place = self.add()
        self.upload(place['id'])
        with TestClient(create_reader(self.path)) as reader:
            self.assertEqual(reader.get('/api/app/status').status_code, 200)
            self.assertEqual(reader.get('/api/app/places').json()['count'], 1)
            self.assertEqual(reader.get('/api/places').status_code, 404)
            self.assertEqual(reader.post('/api/places', json={}).status_code, 404)
            self.assertEqual(reader.delete(f"/api/app/places/{place['id']}").status_code, 405)
            self.assertEqual(reader.get(f"/api/app/places/{place['id']}/photo").status_code, 200)
            self.assertEqual(reader.get('/app-test').status_code, 200)


if __name__ == '__main__':
    unittest.main()
