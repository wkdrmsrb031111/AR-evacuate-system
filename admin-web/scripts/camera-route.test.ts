import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseCameraRoute } from '../src/camera-route.ts'

test('서버에서 내보낸 가상 회사 파일은 20m 연속 경로다', () => { const route = parseCameraRoute(JSON.parse(readFileSync(new URL('../public/camera-route-demo.json', import.meta.url), 'utf8'))); assert.equal(route.demo, true); assert.equal(route.totalDistanceMeters, 20); assert.equal(route.steps.length, 2) })

const valid = () => ({ kind: 'evacuation-camera-route', schemaVersion: 1, calculatedAt: '2026-11-24T00:00:00Z', building: '[테스트] 가상 회사', floor: '2층', demo: true, source: { id: 'room', room: '회의실' }, destination: { id: 'stairs', room: '동쪽 계단' }, totalDistanceMeters: 20, steps: [
  { fromPlaceId: 'room', toPlaceId: 'hall', toName: '복도', distanceMeters: 8, instruction: '출입문을 지나세요.', direction: 'straight', facingHint: '출입문을 정면으로 보세요.' },
  { fromPlaceId: 'hall', toPlaceId: 'stairs', toName: '동쪽 계단', distanceMeters: 12, instruction: '계단 입구로 가세요.', direction: 'right', facingHint: '걸어오던 방향을 유지하세요.' },
] })
test('연속된 실제 계산 경로와 구간 방향을 읽는다', () => { assert.deepEqual(parseCameraRoute(valid()).steps.map(s => s.direction), ['straight', 'right']) })
test('방향이나 바라볼 기준이 없으면 거절한다', () => { for (const key of ['direction', 'facingHint']) { const r = valid(); r.steps[0][key as 'direction' | 'facingHint'] = ''; assert.throws(() => parseCameraRoute(r)) } })
test('끊긴 경로와 잘못된 목적지는 거절한다', () => { const r = valid(); r.steps[1].fromPlaceId = 'other'; assert.throws(() => parseCameraRoute(r)); const s = valid(); s.destination.id = 'wrong'; assert.throws(() => parseCameraRoute(s)) })
test('거리 불일치와 순환을 거절한다', () => { const r = valid(); r.totalDistanceMeters = 3; assert.throws(() => parseCameraRoute(r)); const s = valid(); s.steps[1].toPlaceId = 'room'; assert.throws(() => parseCameraRoute(s)) })
test('빈 경로, 알 수 없는 방향, 잘못된 날짜를 거절한다', () => { const r = valid(); r.steps = []; assert.throws(() => parseCameraRoute(r)); const s = valid(); s.steps[0].direction = 'guess'; assert.throws(() => parseCameraRoute(s)); const t = valid(); t.calculatedAt = 'not-a-date'; assert.throws(() => parseCameraRoute(t)) })
test('선택적인 AI 기준은 두 글자 이상 문자열만 허용한다', () => { const r = valid(); Object.assign(r.steps[0], { facingSignText: '제3강의실' }); assert.equal(parseCameraRoute(r).steps[0].facingSignText, '제3강의실'); Object.assign(r.steps[0], { facingSignText: ['제3강의실'] }); assert.throws(() => parseCameraRoute(r)); Object.assign(r.steps[0], { facingSignText: '!' }); assert.throws(() => parseCameraRoute(r)) })
