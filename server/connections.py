"""Manually registered, bidirectional links between places on one floor."""
import sqlite3
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import BaseModel, Field, StrictBool, field_validator


class ConnectionValues(BaseModel):
    sourceId: UUID
    targetId: UUID
    distanceMeters: float = Field(gt=0, le=1000, allow_inf_nan=False)
    forwardInstruction: str = Field(min_length=1, max_length=300)
    reverseInstruction: str = Field(min_length=1, max_length=300)

    @field_validator('forwardInstruction', 'reverseInstruction', mode='before')
    @classmethod
    def clean_instruction(cls, value):
        return ' '.join(value.split()) if isinstance(value, str) else value


class AvailabilityValues(BaseModel):
    blocked: StrictBool
    reason: str = Field(default='', max_length=200)

    @field_validator('reason', mode='before')
    @classmethod
    def clean_reason(cls, value):
        return ' '.join(value.split()) if isinstance(value, str) else value


def encode_link(row):
    return {
        'id': row['id'], 'sourceId': row['source_id'], 'targetId': row['target_id'],
        'distanceMeters': row['distance_meters'], 'forwardInstruction': row['forward_instruction'],
        'reverseInstruction': row['reverse_instruction'], 'bidirectional': True,
        'createdAt': row['created_at'],
        'blocked': bool(row['blocked']), 'blockedReason': row['blocked_reason'], 'blockedAt': row['blocked_at'],
        **({'deletedAt': row['deleted_at']} if row['deleted_at'] else {}),
    }


def list_app_links(db, include_blocked=False):
    rows = db.execute('''SELECT c.* FROM connections c
        JOIN places s ON s.id=c.source_id JOIN places t ON t.id=c.target_id
        WHERE c.deleted_at IS NULL AND s.deleted_at IS NULL AND t.deleted_at IS NULL
          AND s.building_key=t.building_key AND s.floor_key=t.floor_key
        ORDER BY c.created_at,c.id''')
    return [encode_link(row) for row in rows if include_blocked or not row['blocked']]


def register_connection_routes(app, connection):
    def require_link(db, link_id):
        row = db.execute('SELECT * FROM connections WHERE id=?', (str(link_id),)).fetchone()
        if not row:
            raise HTTPException(404, '연결을 찾을 수 없어요. 목록을 다시 불러와 주세요.')
        return row

    def validate_endpoints(db, source_id, target_id):
        if source_id == target_id:
            raise HTTPException(422, '서로 다른 두 장소를 선택해 주세요.')
        rows = [db.execute('SELECT * FROM places WHERE id=? AND deleted_at IS NULL', (place_id,)).fetchone()
                for place_id in (source_id, target_id)]
        if not all(rows):
            raise HTTPException(422, '삭제되지 않은 장소 두 곳을 선택해 주세요. 장소 목록을 새로고침해 주세요.')
        if any(rows[0][key] != rows[1][key] for key in ('building_key', 'floor_key')):
            raise HTTPException(422, '이번 단계에서는 같은 건물·같은 층의 장소만 연결할 수 있어요.')

    def write_link(db, values, link_id=None):
        source_id, target_id = str(values.sourceId), str(values.targetId)
        validate_endpoints(db, source_id, target_id)
        pair_a, pair_b = sorted((source_id, target_id))
        try:
            if link_id:
                row = require_link(db, link_id)
                if row['deleted_at']:
                    raise HTTPException(409, '삭제한 연결은 먼저 복원해 주세요.')
                db.execute('''UPDATE connections SET source_id=?,target_id=?,pair_a=?,pair_b=?,distance_meters=?,
                    forward_instruction=?,reverse_instruction=? WHERE id=?''',
                    (source_id,target_id,pair_a,pair_b,values.distanceMeters,values.forwardInstruction,values.reverseInstruction,str(link_id)))
            else:
                link_id = str(uuid4())
                db.execute('''INSERT INTO connections(id,source_id,target_id,pair_a,pair_b,distance_meters,
                    forward_instruction,reverse_instruction,created_at) VALUES (?,?,?,?,?,?,?,?,?)''',
                    (link_id,source_id,target_id,pair_a,pair_b,values.distanceMeters,values.forwardInstruction,
                     values.reverseInstruction,datetime.now(timezone.utc).isoformat()))
        except sqlite3.IntegrityError:
            raise HTTPException(409, '두 장소는 이미 연결되어 있어요. 반대 방향도 같은 연결이에요. 기존 연결을 수정해 주세요.')
        return encode_link(require_link(db, link_id))

    @app.get('/api/connections')
    def get_connections():
        with connection() as db:
            return [encode_link(row) for row in db.execute('SELECT * FROM connections ORDER BY created_at DESC,id')]

    @app.post('/api/connections', status_code=201)
    def add_connection(values: ConnectionValues):
        with connection() as db:
            return write_link(db, values)

    @app.put('/api/connections/{link_id}')
    def edit_connection(link_id: UUID, values: ConnectionValues):
        with connection() as db:
            return write_link(db, values, link_id)

    @app.delete('/api/connections/{link_id}')
    def delete_connection(link_id: UUID):
        with connection() as db:
            require_link(db, link_id)
            db.execute('UPDATE connections SET deleted_at=COALESCE(deleted_at,?) WHERE id=?',
                       (datetime.now(timezone.utc).isoformat(),str(link_id)))
            return encode_link(require_link(db, link_id))

    @app.patch('/api/connections/{link_id}/availability')
    def change_availability(link_id: UUID, values: AvailabilityValues):
        with connection() as db:
            row = require_link(db, link_id)
            if row['deleted_at']:
                raise HTTPException(409, '삭제한 연결은 먼저 복원해 주세요.')
            validate_endpoints(db, row['source_id'], row['target_id'])
            if values.blocked and not values.reason:
                raise HTTPException(422, '통행 불가 사유를 입력해 주세요.')
            reason = values.reason if values.blocked else ''
            blocked_at = (row['blocked_at'] if row['blocked'] and row['blocked_reason'] == reason
                          else datetime.now(timezone.utc).isoformat()) if values.blocked else None
            db.execute('UPDATE connections SET blocked=?,blocked_reason=?,blocked_at=? WHERE id=?',
                       (int(values.blocked),reason,blocked_at,str(link_id)))
            return encode_link(require_link(db, link_id))

    @app.post('/api/connections/{link_id}/restore')
    def restore_connection(link_id: UUID):
        with connection() as db:
            row = require_link(db, link_id)
            validate_endpoints(db, row['source_id'], row['target_id'])
            try:
                db.execute('UPDATE connections SET deleted_at=NULL WHERE id=?', (str(link_id),))
            except sqlite3.IntegrityError:
                raise HTTPException(409, '같은 두 장소를 연결한 항목이 이미 있어 복원할 수 없어요.')
            return encode_link(require_link(db, link_id))
