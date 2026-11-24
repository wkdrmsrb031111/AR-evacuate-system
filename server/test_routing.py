from pathlib import Path
from contextlib import closing
import sqlite3
import tempfile
import unittest
from uuid import uuid4

from fastapi.testclient import TestClient
from server.main import create_app
from server.app_reader import create_reader


class RoutingTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.path = Path(self.folder.name)
        self.client = TestClient(create_app(self.path))

    def tearDown(self):
        self.client.close()
        self.folder.cleanup()

    def place(self, room, kind='room', building='본관', floor='2층'):
        response = self.client.post('/api/places', json=dict(building=building, floor=floor, room=room, kind=kind))
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()['id']

    def link(self, source, target, distance, forward='가는 방향', reverse='오는 방향'):
        response = self.client.post('/api/connections', json={
            'sourceId':source,'targetId':target,'distanceMeters':distance,
            'forwardInstruction':forward,'reverseInstruction':reverse})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()['id']

    def route(self, source, client=None):
        return (client or self.client).get('/api/app/routes/nearest-stairs', params={'sourceId':source})

    def block(self, link_id, blocked=True, reason='통로 장애물'):
        return self.client.patch(f'/api/connections/{link_id}/availability',json={'blocked':blocked,'reason':reason})

    def test_blocked_path_changes_stair_destination_and_reopens(self):
        start, hall = self.place('회의실'), self.place('복도','corridor')
        near, far = self.place('가까운 계단','stairs'), self.place('먼 계단','stairs')
        self.link(start,hall,8)
        blocked_link = self.link(hall,near,12)
        self.link(start,far,60)
        self.assertEqual(self.route(start).json()['totalDistanceMeters'],20)
        marked = self.block(blocked_link)
        self.assertEqual(marked.status_code,200,marked.text)
        self.assertTrue(marked.json()['blocked'])
        self.assertEqual(marked.json()['blockedReason'],'통로 장애물')
        self.assertIsNotNone(marked.json()['blockedAt'])
        rerouted = self.route(start).json()
        self.assertEqual(rerouted['destination']['id'],far)
        self.assertEqual(rerouted['totalDistanceMeters'],60)
        self.assertTrue(rerouted['rerouted'])
        self.assertTrue(rerouted['destinationChanged'])
        self.assertEqual(rerouted['originalDestination']['id'],near)
        self.assertEqual(rerouted['blockedConnectionCount'],1)
        self.assertNotIn(blocked_link,[s['connectionId'] for s in rerouted['steps']])
        with TestClient(create_app(self.path)) as restarted:
            saved = next(item for item in restarted.get('/api/connections').json() if item['id']==blocked_link)
            self.assertTrue(saved['blocked'])
        with TestClient(create_reader(self.path)) as reader:
            self.assertEqual(reader.get('/api/app/connections').json()['count'],2)
            self.assertEqual(self.route(start,reader).json()['destination']['id'],far)
            self.assertEqual(reader.patch(f'/api/connections/{blocked_link}/availability',json={'blocked':False}).status_code,404)
        opened = self.block(blocked_link,False).json()
        self.assertFalse(opened['blocked'])
        self.assertEqual(opened['blockedReason'],'')
        self.assertIsNone(opened['blockedAt'])
        self.assertEqual(self.route(start).json()['totalDistanceMeters'],20)
        self.assertFalse(self.route(start).json()['rerouted'])

    def test_same_stair_detour_blocks_reverse_edge_too(self):
        start, hall, detour = self.place('회의실'), self.place('복도','corridor'), self.place('우회 복도','corridor')
        stairs = self.place('계단','stairs')
        blocked_link = self.link(hall,start,1)
        self.link(hall,stairs,1)
        self.link(start,detour,3)
        self.link(detour,hall,3)
        self.block(blocked_link)
        result = self.route(start).json()
        self.assertEqual(result['totalDistanceMeters'],7)
        self.assertEqual(result['destination']['id'],stairs)
        self.assertTrue(result['rerouted'])
        self.assertFalse(result['destinationChanged'])
        self.assertEqual([p['id'] for p in result['places']],[start,detour,hall,stairs])

    def test_all_paths_blocked_and_unrelated_block_does_not_claim_reroute(self):
        start, other = self.place('회의실'), self.place('다른 방')
        stairs = self.place('계단','stairs')
        used = self.link(start,stairs,5)
        unrelated = self.link(other,stairs,1)
        self.block(unrelated)
        result = self.route(start).json()
        self.assertEqual(result['status'],'found')
        self.assertFalse(result['rerouted'])
        self.assertIsNone(result['originalDestination'])
        self.block(used)
        result = self.route(start).json()
        self.assertEqual(result['status'],'unreachable')
        self.assertEqual(result['blockedConnectionCount'],2)
        self.assertIsNone(result['destination'])
        self.assertIsNone(result['totalDistanceMeters'])
        self.assertEqual(result['steps'],[])
        self.assertEqual(self.route(stairs).json()['status'],'already_at_stairs')

    def test_availability_validation_and_deleted_links(self):
        start, stairs = self.place('회의실'), self.place('계단','stairs')
        link = self.link(start,stairs,5)
        for body in ({'blocked':True}, {'blocked':True,'reason':'  '}, {'blocked':'false'},
                     {'blocked':1}, {'reason':'사유'}, {'blocked':True,'reason':'a'*201}):
            self.assertEqual(self.client.patch(f'/api/connections/{link}/availability',json=body).status_code,422)
        self.assertFalse(self.client.get('/api/connections').json()[0]['blocked'])
        self.assertEqual(self.block(str(uuid4())).status_code,404)
        self.assertEqual(self.block('invalid').status_code,422)
        self.client.delete(f'/api/connections/{link}')
        self.assertEqual(self.block(link).status_code,409)
        self.client.post(f'/api/connections/{link}/restore')
        self.client.delete(f'/api/places/{start}')
        self.assertEqual(self.block(link).status_code,422)

    def test_edit_and_trash_restore_keep_blocked_status(self):
        start, stairs = self.place('회의실'), self.place('계단','stairs')
        link = self.link(start,stairs,5)
        first = self.block(link).json()
        self.assertEqual(first['blockedAt'],self.block(link).json()['blockedAt'])
        edited = self.client.put(f'/api/connections/{link}',json={
            'sourceId':start,'targetId':stairs,'distanceMeters':10,
            'forwardInstruction':'계단 쪽','reverseInstruction':'회의실 쪽'}).json()
        self.assertTrue(edited['blocked'])
        self.assertEqual(edited['blockedReason'],first['blockedReason'])
        self.client.delete(f'/api/connections/{link}')
        self.assertTrue(self.client.post(f'/api/connections/{link}/restore').json()['blocked'])
        self.assertEqual(self.route(start).json()['status'],'unreachable')

    def test_migrate_previous_connections_keeps_routes(self):
        start, stairs = self.place('회의실'), self.place('계단','stairs')
        link = self.link(start,stairs,5)
        with closing(sqlite3.connect(self.path / 'evacuate.sqlite3')) as db:
            for column in ('blocked','blocked_reason','blocked_at'):
                db.execute(f'ALTER TABLE connections DROP COLUMN {column}')
            db.commit()
        for _ in range(2):
            with TestClient(create_app(self.path)) as migrated:
                saved = migrated.get('/api/connections').json()[0]
                self.assertEqual(saved['id'],link)
                self.assertFalse(saved['blocked'])
                self.assertEqual(saved['blockedReason'],'')
                self.assertIsNone(saved['blockedAt'])
                self.assertEqual(self.route(start,migrated).json()['totalDistanceMeters'],5)

    def test_total_distance_beats_fewer_hops_and_ignores_exit(self):
        start = self.place('회의실')
        hall = self.place('복도','corridor')
        short = self.place('동쪽 계단','stairs')
        long = self.place('서쪽 계단','stairs')
        outside = self.place('건물 밖 출구','exit')
        isolated = self.place('연결 없는 계단','stairs')
        self.link(start, long, 20)
        self.link(start, outside, 1)
        first = self.link(start, hall, 4, '복도로 이동', '회의실로 이동')
        second = self.link(hall, short, 6, '동쪽 계단으로 이동', '복도로 돌아가기')
        self.link(hall, long, 25)  # A cycle must not disturb the cheapest path.
        result = self.route(start).json()
        self.assertEqual(result['status'],'found')
        self.assertEqual(result['destination']['id'],short)
        self.assertEqual(result['totalDistanceMeters'],10)
        self.assertEqual([p['id'] for p in result['places']],[start,hall,short])
        self.assertEqual([s['connectionId'] for s in result['steps']],[first,second])
        self.assertEqual([s['instruction'] for s in result['steps']],['복도로 이동','동쪽 계단으로 이동'])
        self.assertNotEqual(result['destination']['id'],isolated)

    def test_reverse_instructions_and_decimal_distances(self):
        start = self.place('회의실')
        hall = self.place('복도','corridor')
        stairs = self.place('계단','stairs')
        self.link(hall,start,.1,'회의실 방향','복도 방향')
        self.link(stairs,hall,.2,'복도 방향','계단 방향')
        result = self.route(start).json()
        self.assertEqual(result['totalDistanceMeters'],.3)
        self.assertEqual([s['instruction'] for s in result['steps']],['복도 방향','계단 방향'])
        self.assertEqual(result['steps'][0]['fromPlaceId'],start)

    def test_no_stairs_unreachable_and_source_already_stairs(self):
        start = self.place('회의실')
        self.assertEqual(self.route(start).json()['status'],'no_stairs')
        stairs = self.place('계단','stairs')
        missing = self.route(start).json()
        self.assertEqual(missing['status'],'unreachable')
        self.assertIsNone(missing['totalDistanceMeters'])
        self.assertEqual(missing['places'],[])
        self.assertEqual(missing['steps'],[])
        arrived = self.route(stairs).json()
        self.assertEqual(arrived['status'],'already_at_stairs')
        self.assertEqual(arrived['totalDistanceMeters'],0)
        self.assertEqual(arrived['destination']['id'],stairs)
        self.assertEqual(arrived['steps'],[])

    def test_deleted_connections_and_places_never_used_and_restore_recalculates(self):
        start = self.place('회의실')
        hall = self.place('복도','corridor')
        stairs = self.place('계단','stairs')
        self.link(start,hall,3)
        link = self.link(hall,stairs,4)
        self.assertEqual(self.route(start).json()['totalDistanceMeters'],7)
        self.client.delete(f'/api/connections/{link}')
        self.assertEqual(self.route(start).json()['status'],'unreachable')
        self.client.post(f'/api/connections/{link}/restore')
        self.client.delete(f'/api/places/{hall}')
        self.assertEqual(self.route(start).json()['status'],'unreachable')
        self.client.post(f'/api/places/{hall}/restore')
        self.assertEqual(self.route(start).json()['totalDistanceMeters'],7)
        self.client.delete(f'/api/places/{stairs}')
        self.assertEqual(self.route(start).json()['status'],'no_stairs')

    def test_other_buildings_and_floors_excluded_and_bad_source(self):
        start = self.place('회의실')
        self.place('다른 층 계단','stairs',floor='3층')
        self.place('다른 건물 계단','stairs',building='별관')
        self.assertEqual(self.route(start).json()['status'],'no_stairs')
        self.assertEqual(self.route(str(uuid4())).status_code,404)
        self.assertEqual(self.route('invalid').status_code,422)
        self.assertEqual(self.client.get('/api/app/routes/nearest-stairs').status_code,422)
        self.client.delete(f'/api/places/{start}')
        self.assertEqual(self.route(start).status_code,404)

    def test_read_only_reader_and_updated_distances_change_destination(self):
        start = self.place('회의실')
        a,b = self.place('A계단','stairs'), self.place('B계단','stairs')
        link = self.link(start,a,5)
        self.link(start,b,10)
        with TestClient(create_reader(self.path)) as reader:
            self.assertEqual(self.route(start,reader).json()['destination']['id'],a)
            self.client.put(f'/api/connections/{link}',json={
                'sourceId':start,'targetId':a,'distanceMeters':15,
                'forwardInstruction':'A계단 방향','reverseInstruction':'회의실 방향'})
            self.assertEqual(self.route(start,reader).json()['destination']['id'],b)
            self.assertEqual(reader.post('/api/app/routes/nearest-stairs',json={}).status_code,405)

    def test_equal_distance_choice_is_stable(self):
        start = self.place('회의실')
        a,b = self.place('A계단','stairs'), self.place('B계단','stairs')
        self.link(start,a,5)
        self.link(start,b,5)
        first = self.route(start).json()
        self.assertEqual(first['totalDistanceMeters'],5)
        self.assertEqual(first['destination']['id'],self.route(start).json()['destination']['id'])


if __name__ == '__main__':
    unittest.main()
