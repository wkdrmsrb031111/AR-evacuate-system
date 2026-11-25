export type PlaceKind = 'room' | 'corridor' | 'stairs' | 'exit'

export const placeKindLabels: Record<PlaceKind, string> = {
  room: '일반 장소',
  corridor: '복도·갈림길',
  stairs: '비상계단 입구',
  exit: '건물 밖 출구',
}

export type Place = {
  id: string
  building: string
  floor: string
  room: string
  kind: PlaceKind
  createdAt: string
  deletedAt?: string
}

export type PlaceValues = Pick<Place, 'building' | 'floor' | 'room' | 'kind'>

export type ConnectionValues = {
  sourceId: string
  targetId: string
  distanceMeters: number
  forwardInstruction: string
  reverseInstruction: string
  forwardDirection: 'left' | 'straight' | 'right' | null
  reverseDirection: 'left' | 'straight' | 'right' | null
  forwardFacingHint: string
  reverseFacingHint: string
  forwardSignText: string
  reverseSignText: string
}

export type PlaceConnection = ConnectionValues & {
  id: string
  bidirectional: boolean
  blocked: boolean
  blockedReason: string
  blockedAt: string | null
  createdAt: string
  deletedAt?: string
}

export type RoutePlace = Pick<Place, 'id' | 'building' | 'floor' | 'room' | 'kind'>
export type NearestStairsRoute = {
  schemaVersion: number
  calculatedAt: string
  criterion: 'distanceMeters'
  blockedConnectionCount: number
  rerouted: boolean
  destinationChanged: boolean
  originalDestination: RoutePlace | null
  status: 'found' | 'already_at_stairs' | 'no_stairs' | 'unreachable'
  source: RoutePlace
  destination: RoutePlace | null
  totalDistanceMeters: number | null
  places: RoutePlace[]
  steps: { connectionId: string; fromPlaceId: string; toPlaceId: string; distanceMeters: number; instruction: string; direction: 'left' | 'straight' | 'right' | null; facingHint: string; facingSignText: string }[]
  cameraReady?: boolean
  message: string
  notice: string
}

export type DemoReadiness = {
  schemaVersion: number
  checkedAt: string
  summary: { activePlaceCount: number; roomCount: number; reachableRoomCount: number; needsRouteCount: number; missingPhotoCount: number }
  checks: {
    place: RoutePlace
    status: 'found' | 'no_stairs' | 'unreachable'
    destination: RoutePlace | null
    totalDistanceMeters: number | null
    message: string
    rerouted: boolean
    blockedConnectionCount: number
  }[]
  missingPhotoPlaces: RoutePlace[]
  notice: string
}
