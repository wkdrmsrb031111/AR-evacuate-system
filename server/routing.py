"""Shortest registered distance to an active stair entrance on the source floor."""
from datetime import datetime, timezone
from decimal import Decimal
import heapq

from fastapi import HTTPException
from server.connections import list_app_links


def shortest_path(graph, source_id, destinations):
    distances = {source_id: Decimal(0)}
    previous = {}
    pending = [(Decimal(0), source_id)]
    while pending:
        total, current = heapq.heappop(pending)
        if total != distances[current]:
            continue
        if current in destinations:
            node_ids, steps = [current], []
            destination_id = current
            while current != source_id:
                prior, connection_id, distance, instruction, direction, facing_hint, sign_text = previous[current]
                steps.append({'connectionId': connection_id, 'fromPlaceId': prior, 'toPlaceId': current,
                              'distanceMeters': float(distance), 'instruction': instruction,
                              'direction': direction, 'facingHint': facing_hint, 'facingSignText': sign_text})
                node_ids.append(prior)
                current = prior
            return destination_id, float(total), list(reversed(node_ids)), list(reversed(steps))
        for next_id, distance, connection_id, instruction, direction, facing_hint, sign_text in graph[current]:
            proposed = total + distance
            if next_id not in distances or proposed < distances[next_id]:
                distances[next_id] = proposed
                previous[next_id] = (current, connection_id, distance, instruction, direction, facing_hint, sign_text)
                heapq.heappush(pending, (proposed, next_id))
    return None


def nearest_stairs(db, source_id: str):
    source_row = db.execute('SELECT * FROM places WHERE id=? AND deleted_at IS NULL', (source_id,)).fetchone()
    if source_row is None:
        raise HTTPException(404, '출발 장소를 찾을 수 없어요. 삭제되지 않은 장소를 다시 선택해 주세요.')
    rows = db.execute('''SELECT id,building,floor,room,kind FROM places
        WHERE deleted_at IS NULL AND building_key=? AND floor_key=? ORDER BY id''',
        (source_row['building_key'], source_row['floor_key'])).fetchall()
    places = {row['id']: dict(row) for row in rows}
    source = places[source_id]
    result = {
        'schemaVersion': 1, 'calculatedAt': datetime.now(timezone.utc).isoformat(),
        'criterion': 'distanceMeters', 'source': source, 'destination': None,
        'totalDistanceMeters': None, 'places': [], 'steps': [],
        'blockedConnectionCount': 0, 'rerouted': False, 'destinationChanged': False,
        'originalDestination': None,
        'notice': '관리자가 등록한 같은 층의 연결·거리·통행 불가 상태를 반영한 시연용 계산이에요. 화재·연기나 실제 통행 가능 여부를 자동 감지하지 않아요. 비상계단 입구 도착은 건물 밖 대피 완료와 달라요.',
    }
    destinations = {place['id'] for place in places.values() if place['kind'] == 'stairs'}
    if not destinations:
        return {**result, 'status': 'no_stairs', 'message': '이 건물·층에 비상계단 입구가 등록되어 있지 않아요. 장소 종류를 확인해 주세요.'}

    graph = {place_id: [] for place_id in places}
    baseline_graph = {place_id: [] for place_id in places}
    blocked_ids = set()
    for link in list_app_links(db, include_blocked=True):
        a, b = link['sourceId'], link['targetId']
        if a not in graph or b not in graph:
            continue
        distance = Decimal(str(link['distanceMeters']))
        forward = (b, distance, link['id'], link['forwardInstruction'], link['forwardDirection'],
                   link['forwardFacingHint'], link['forwardSignText'])
        reverse = (a, distance, link['id'], link['reverseInstruction'], link['reverseDirection'],
                   link['reverseFacingHint'], link['reverseSignText'])
        baseline_graph[a].append(forward)
        baseline_graph[b].append(reverse)
        if link['blocked']:
            blocked_ids.add(link['id'])
        else:
            graph[a].append(forward)
            graph[b].append(reverse)

    result['blockedConnectionCount'] = len(blocked_ids)
    path = shortest_path(graph, source_id, destinations)
    if path is None:
        message = ('통행 불가 구간을 제외하면 비상계단 입구까지 연결된 경로가 없어요.' if blocked_ids else
                   '등록된 연결로는 비상계단 입구까지 갈 수 없어요. 중간 장소와 연결을 확인해 주세요.')
        return {**result, 'status': 'unreachable', 'message': message}

    destination_id, total, node_ids, steps = path
    baseline = shortest_path(baseline_graph, source_id, destinations) if blocked_ids else None
    rerouted = bool(baseline and any(step['connectionId'] in blocked_ids for step in baseline[3]))
    changed = bool(rerouted and baseline[0] != destination_id)
    message = '등록된 이동 거리의 합이 가장 짧은 경로예요.'
    if changed:
        message = '통행 불가 구간을 피해 다른 비상계단 입구로 우회하는 경로예요.'
    elif rerouted:
        message = '통행 불가 구간을 피해 같은 비상계단 입구로 우회하는 경로예요.'
    elif blocked_ids:
        message = '통행 불가 구간을 제외한 연결 중 이동 거리의 합이 가장 짧은 경로예요.'
    return {
        **result, 'status': 'already_at_stairs' if destination_id == source_id else 'found',
        'message': '이미 비상계단 입구에 있어요.' if destination_id == source_id else message,
        'destination': places[destination_id], 'totalDistanceMeters': total,
        'places': [places[place_id] for place_id in node_ids], 'steps': steps,
        'rerouted': rerouted, 'destinationChanged': changed,
        'originalDestination': places[baseline[0]] if rerouted else None,
        'cameraReady': all(step['direction'] and step['facingHint'] for step in steps),
    }
