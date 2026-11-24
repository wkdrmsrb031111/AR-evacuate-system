import type { Place, PlaceValues, ConnectionValues, PlaceConnection, NearestStairsRoute, DemoReadiness } from './types'
import type { DoorPhoto } from './photos'
import { readLocalDoorPhoto } from './photos'

export function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : '요청을 처리하지 못했어요. 다시 시도해 주세요.'
}

async function response(path: string, options: RequestInit = {}) {
  let result: Response
  try {
    result = await fetch(`/api${path}`, {
      ...options,
      signal: AbortSignal.timeout(30000),
      headers: typeof options.body === 'string' ? { 'Content-Type': 'application/json', ...options.headers } : options.headers,
    })
  } catch {
    throw new Error('서버에 연결하지 못했어요. 로컬 서버가 켜져 있는지 확인해 주세요.')
  }
  if (!result.ok) {
    if (result.status >= 500) throw new Error('서버 요청을 처리하지 못했어요. 로컬 서버가 켜져 있는지 확인한 뒤 다시 연결해 주세요.')
    const detail = await result.json().catch(() => null)
    throw new Error(typeof detail?.detail === 'string' ? detail.detail : '요청을 처리하지 못했어요. 입력 내용을 확인하거나 서버 연결을 다시 시도해 주세요.')
  }
  return result
}

async function json<T>(path: string, options?: RequestInit): Promise<T> {
  return (await response(path, options)).json() as Promise<T>
}

export const getServerStatus = () => json<{ status: string; databaseId: string }>('/status')
export const getPlaces = () => json<Place[]>('/places')
export const createPlace = (values: PlaceValues) => json<Place>('/places', { method: 'POST', body: JSON.stringify(values) })
export const updatePlace = (id: string, values: PlaceValues) => json<Place>(`/places/${id}`, { method: 'PUT', body: JSON.stringify(values) })
export const trashPlace = (id: string) => json<Place>(`/places/${id}`, { method: 'DELETE' })
export const restorePlace = (id: string) => json<Place>(`/places/${id}/restore`, { method: 'POST' })
export const getConnections = () => json<PlaceConnection[]>('/connections')
export const createConnection = (values: ConnectionValues) => json<PlaceConnection>('/connections', { method: 'POST', body: JSON.stringify(values) })
export const updateConnection = (id: string, values: ConnectionValues) => json<PlaceConnection>(`/connections/${id}`, { method: 'PUT', body: JSON.stringify(values) })
export const trashConnection = (id: string) => json<PlaceConnection>(`/connections/${id}`, { method: 'DELETE' })
export const restoreConnection = (id: string) => json<PlaceConnection>(`/connections/${id}/restore`, { method: 'POST' })
export const setConnectionAvailability = (id: string, blocked: boolean, reason = '') => json<PlaceConnection>(`/connections/${id}/availability`, { method: 'PATCH', body: JSON.stringify({ blocked, reason }) })
export const getNearestStairsRoute = (sourceId: string) => json<NearestStairsRoute>(`/app/routes/nearest-stairs?sourceId=${encodeURIComponent(sourceId)}`)
export const getDemoReadiness = () => json<DemoReadiness>('/checks/demo-readiness', { cache: 'no-store' })

export async function getBackupFile() {
  const result = await response('/backup', { cache: 'no-store' })
  if (!result.headers.get('content-type')?.includes('application/zip')) throw new Error('백업 파일을 확인하지 못했어요. 다시 시도해 주세요.')
  const filename = result.headers.get('content-disposition')?.match(/filename="([A-Za-z0-9_.-]+)"/)?.[1] ?? 'ar-evacuate-backup.zip'
  return { filename, blob: await result.blob() }
}

export async function readServerDoorPhoto(placeId: string): Promise<DoorPhoto | undefined> {
  const info = await json<Omit<DoorPhoto, 'blob'> | null>(`/places/${placeId}/photo`)
  if (!info) return undefined
  const blob = await (await response(`/places/${placeId}/photo/content`)).blob()
  return { ...info, blob }
}

export async function saveServerDoorPhoto(photo: DoorPhoto): Promise<DoorPhoto> {
  const body = new FormData()
  body.append('name', photo.name)
  body.append('file', photo.blob, 'door-photo.jpg')
  const saved = await json<Omit<DoorPhoto, 'blob'>>(`/places/${photo.placeId}/photo`, { method: 'PUT', body })
  return { ...saved, blob: photo.blob }
}

export async function importLegacyPlaces(places: Place[]) {
  const localPhotos = await Promise.all(places.map((place) => readLocalDoorPhoto(place.id)))
  const photos = localPhotos.filter((photo): photo is DoorPhoto => Boolean(photo))
  const body = new FormData()
  body.append('manifest', JSON.stringify({
    places,
    photos: photos.map((photo) => ({ placeId: photo.placeId, name: photo.name, fileName: `${photo.placeId}.jpg` })),
  }))
  photos.forEach((photo) => body.append('files', photo.blob, `${photo.placeId}.jpg`))
  return json<{ places: Place[]; importedPlaces: number; importedPhotos: number }>('/import', { method: 'POST', body })
}
