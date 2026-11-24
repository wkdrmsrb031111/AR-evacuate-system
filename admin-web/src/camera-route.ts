export type ArrowDirection = 'left' | 'straight' | 'right'
type RoutePoint = { id: string; room: string }
export type CameraRoute = {
  kind: 'evacuation-camera-route'; schemaVersion: 1; calculatedAt: string
  building: string; floor: string; source: RoutePoint; destination: RoutePoint
  totalDistanceMeters: number; demo: boolean
  steps: { fromPlaceId: string; toPlaceId: string; toName: string; distanceMeters: number; instruction: string; direction: ArrowDirection; facingHint: string; facingSignText?: string }[]
}

export function parseCameraRoute(value: unknown): CameraRoute {
  const fail = () => { throw new Error('올바른 카메라 안내 파일이 아니에요. 관리자 웹에서 다시 저장해 주세요.') }
  const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
  const text = (v: unknown, max = 300): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max
  const meters = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 100000
  if (!object(value)) return fail()
  const r = value
  if (r.kind !== 'evacuation-camera-route' || r.schemaVersion !== 1 || !text(r.calculatedAt, 60) || !Number.isFinite(Date.parse(r.calculatedAt)) || !text(r.building, 60) || !text(r.floor, 30) || typeof r.demo !== 'boolean' || !meters(r.totalDistanceMeters)) return fail()
  if (!object(r.source) || !object(r.destination) || !text(r.source.id, 100) || !text(r.source.room, 60) || !text(r.destination.id, 100) || !text(r.destination.room, 60)) return fail()
  if (!Array.isArray(r.steps) || r.steps.length === 0 || r.steps.length > 100) return fail()
  let previous = r.source.id
  let total = 0
  const visited = new Set([previous])
  for (const s of r.steps) {
    if (!object(s) || s.fromPlaceId !== previous || !text(s.toPlaceId, 100) || visited.has(s.toPlaceId) || !text(s.toName, 60) || !meters(s.distanceMeters) || !text(s.instruction) || !text(s.facingHint, 200) || typeof s.direction !== 'string' || !['left', 'straight', 'right'].includes(s.direction)) return fail()
    if (s.facingSignText !== undefined && (!text(s.facingSignText, 60) || s.facingSignText.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').length < 2)) return fail()
    previous = s.toPlaceId; visited.add(previous); total += s.distanceMeters
  }
  if (previous !== r.destination.id || Math.abs(total - r.totalDistanceMeters) > 0.01 || r.steps.at(-1)?.toName !== r.destination.room) return fail()
  return r as unknown as CameraRoute
}
