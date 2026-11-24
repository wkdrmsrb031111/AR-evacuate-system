export type DoorPhoto = {
  placeId: string
  name: string
  blob: Blob
  savedAt: string
}

const DB_NAME = 'evacuate-admin-photos'
const STORE_NAME = 'door-photos'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'placeId' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('다른 탭의 저장 작업이 끝난 뒤 다시 시도해 주세요.'))
  })
}

// Read-only access to the previous browser storage, used during migration.
export async function readLocalDoorPhoto(placeId: string): Promise<DoorPhoto | undefined> {
  const db = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(placeId)
      let photo: DoorPhoto | undefined
      request.onsuccess = () => { photo = request.result as DoorPhoto | undefined }
      transaction.oncomplete = () => resolve(photo)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

export async function prepareDoorPhoto(file: File): Promise<Blob> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('JPG, PNG, WebP 사진을 선택해 주세요. HEIC 사진은 JPG로 변환한 뒤 등록해 주세요.')
  }
  if (file.size > 15 * 1024 * 1024) throw new Error('15MB 이하의 사진을 선택해 주세요.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('사진을 열 수 없어요. 손상되지 않은 JPG, PNG, WebP 파일로 다시 시도해 주세요.')
  }
  try {
    const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('이 브라우저에서 사진을 처리할 수 없어요.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('사진 변환에 실패했어요. 다시 선택해 주세요.')), 'image/jpeg', 0.85)
    })
  } finally {
    bitmap.close()
  }
}
