"""Read-only demo data checks, not a real-world safety assessment."""
from datetime import datetime, timezone

from fastapi.responses import JSONResponse
from server.routing import nearest_stairs


def inspect_demo_data(db):
    rows = db.execute('''SELECT p.id,p.building,p.floor,p.room,p.kind,
        EXISTS(SELECT 1 FROM photos f WHERE f.place_id=p.id) AS has_photo
        FROM places p WHERE p.deleted_at IS NULL
        ORDER BY p.building_key,p.floor_key,p.room_key,p.id''').fetchall()
    missing_photos = [dict((key,row[key]) for key in ('id','building','floor','room','kind'))
                      for row in rows if not row['has_photo']]
    checks = []
    for row in rows:
        if row['kind'] != 'room':
            continue
        route = nearest_stairs(db, row['id'])
        checks.append({
            'place': route['source'], 'status': route['status'],
            'destination': route['destination'], 'totalDistanceMeters': route['totalDistanceMeters'],
            'message': route['message'], 'rerouted': route['rerouted'],
            'blockedConnectionCount': route['blockedConnectionCount'],
        })
    reachable = sum(item['status'] == 'found' for item in checks)
    return {
        'schemaVersion': 1, 'checkedAt': datetime.now(timezone.utc).isoformat(),
        'summary': {
            'activePlaceCount': len(rows), 'roomCount': len(checks), 'reachableRoomCount': reachable,
            'needsRouteCount': len(checks) - reachable, 'missingPhotoCount': len(missing_photos),
        },
        'checks': checks, 'missingPhotoPlaces': missing_photos,
        'notice': '일반 장소의 계단 경로와 모든 활성 장소의 사진 등록 여부를 점검해요. 통행 불가 상태를 반영하며 실제 대피 안전성·앱 실행·사진 내용의 정확성을 검증하는 기능은 아니에요.',
    }


def register_readiness_routes(app, connection):
    @app.get('/api/checks/demo-readiness')
    def demo_readiness():
        with connection() as db:
            db.execute('BEGIN')
            report = inspect_demo_data(db)
        return JSONResponse(report, headers={'Cache-Control': 'no-store'})
