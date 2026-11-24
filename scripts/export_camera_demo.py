"""Export only fictional demo route data; never publish actual building data."""
import json
from pathlib import Path
import httpx

root = Path(__file__).resolve().parents[1]
with httpx.Client(base_url='http://127.0.0.1:8000', timeout=15) as client:
    response = client.get('/api/app/places')
    response.raise_for_status()
    sources = [p for p in response.json()['places'] if (p['building'], p['floor'], p['room']) == ('[테스트] 가상 회사', '2층', 'ai 듣기')]
    if len(sources) != 1:
        raise RuntimeError('Register the fictional company demo first')
    response = client.get('/api/app/routes/nearest-stairs', params={'sourceId': sources[0]['id']})
    response.raise_for_status()
    route = response.json()
if route['status'] != 'found' or route['totalDistanceMeters'] != 20 or len(route['steps']) != 2:
    raise RuntimeError('Expected the unblocked fictional 20m route; not changing any data')
names = {p['id']: p['room'] for p in route['places']}
directions = [('straight', 'AI 연결 시연 기준: 복도 갈림길 표지판을 정면으로 비춰 주세요.'), ('right', 'AI 연결 시연 기준: 동쪽 비상계단 표지판을 정면으로 비춰 주세요.')]
data = {'kind': 'evacuation-camera-route', 'schemaVersion': 1, 'demo': True, 'calculatedAt': route['calculatedAt'], 'building': route['source']['building'], 'floor': route['source']['floor'], 'source': {key: route['source'][key] for key in ('id', 'room')}, 'destination': {key: route['destination'][key] for key in ('id', 'room')}, 'totalDistanceMeters': route['totalDistanceMeters'], 'steps': [{**s, 'toName': names[s['toPlaceId']], 'direction': directions[i][0], 'facingHint': directions[i][1]} for i, s in enumerate(route['steps'])]}
target = root / 'admin-web/public/camera-route-demo.json'
for step, sign in zip(data['steps'], ['복도 갈림길', '동쪽 비상계단']):
    step['facingSignText'] = sign
target.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
print('Exported fictional server route with explicitly simulated directions:', target)
