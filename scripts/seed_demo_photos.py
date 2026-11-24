"""Register explicit fictional demo data through the local admin API.

Never edits existing places, links, photos, or blocked states. The existing real
room's photo is intentionally left to the browser upload verification step.
"""
from contextlib import closing
from datetime import datetime
import json
from pathlib import Path
import sqlite3

import httpx

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'demo-assets'
BUILDING = '[테스트] 가상 회사'
FLOOR = '2층'
ITEMS = [
    ('ai 듣기', 'room', 'demo-room.png'),
    ('복도 갈림길', 'corridor', 'demo-corridor.png'),
    ('동쪽 비상계단', 'stairs', 'demo-east-stairs.png'),
    ('서쪽 비상계단', 'stairs', 'demo-west-stairs.png'),
]


def seed():
    for _, _, filename in ITEMS:
        if not (ASSETS / filename).is_file():
            raise RuntimeError(f'Missing generated asset: {filename}')
    database = ROOT / 'server' / 'data' / 'evacuate.sqlite3'
    backup = database.with_name(f'before-demo-photos-{datetime.now():%Y%m%d-%H%M%S-%f}.sqlite3')
    with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)) as source:
        with closing(sqlite3.connect(backup)) as destination:
            source.backup(destination)

    report = {'building': BUILDING, 'floor': FLOOR, 'places': {}, 'connections': [], 'uploadedPhotos': [], 'keptPhotos': []}
    with httpx.Client(base_url='http://127.0.0.1:8000', timeout=30) as client:
        def request(method, path, **kwargs):
            result = client.request(method, path, **kwargs)
            result.raise_for_status()
            return result.json()

        existing = request('GET', '/api/places')
        ids = {}
        for room, kind, filename in ITEMS:
            matches = [place for place in existing if not place.get('deletedAt') and
                       (place['building'],place['floor'],place['room']) == (BUILDING,FLOOR,room)]
            place = matches[0] if matches else request('POST','/api/places',json={
                'building':BUILDING,'floor':FLOOR,'room':room,'kind':kind})
            if place['kind'] != kind:
                raise RuntimeError(f'Existing demo place kind differs; not overwriting: {room}')
            ids[room] = place['id']
            report['places'][room] = place['id']
            saved = request('GET',f"/api/places/{place['id']}/photo")
            if saved:
                report['keptPhotos'].append(room)
                continue
            with (ASSETS / filename).open('rb') as photo:
                request('PUT',f"/api/places/{place['id']}/photo",data={'name':f'시연용_실제장소아님_{filename}'},
                        files={'file':(filename,photo,'image/png')})
            report['uploadedPhotos'].append(room)

        edges = [
            ('ai 듣기','복도 갈림길',8,'문을 나와 파란 문이 보이는 복도 갈림길로 이동하세요.','ai 듣기 표지판이 있는 나무 문으로 이동하세요.'),
            ('복도 갈림길','동쪽 비상계단',12,'초록색 문과 동쪽 비상계단 표지판이 있는 입구로 이동하세요.','파란 문이 있는 복도 갈림길로 돌아가세요.'),
            ('ai 듣기','서쪽 비상계단',60,'주황색 문과 서쪽 비상계단 표지판이 있는 입구로 이동하세요.','ai 듣기 표지판이 있는 나무 문으로 돌아가세요.'),
        ]
        existing_links = request('GET','/api/connections')
        for source,target,distance,forward,reverse in edges:
            pair = {ids[source],ids[target]}
            matches = [link for link in existing_links if not link.get('deletedAt') and {link['sourceId'],link['targetId']} == pair]
            link = matches[0] if matches else request('POST','/api/connections',json={
                'sourceId':ids[source],'targetId':ids[target],'distanceMeters':distance,
                'forwardInstruction':forward,'reverseInstruction':reverse})
            report['connections'].append({'id':link['id'],'source':source,'target':target})
        report['route'] = request('GET','/api/app/routes/nearest-stairs',params={'sourceId':ids['ai 듣기']})
    (ASSETS / 'seed-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'building':BUILDING,'places':len(report['places']),'uploadedPhotos':len(report['uploadedPhotos']),
                      'connections':len(report['connections']),'routeDistance':report['route']['totalDistanceMeters']},ensure_ascii=False))


if __name__ == '__main__':
    seed()
