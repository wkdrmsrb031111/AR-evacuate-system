import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { prepareDoorPhoto } from './photos'
import { errorMessage, readServerDoorPhoto, saveServerDoorPhoto } from './api'
import type { DoorPhoto } from './photos'
import './DoorPhotoManager.css'

type PhotoPlace = { id: string; building: string; floor: string; room: string }
type Draft = { blob: Blob; name: string }

export default function DoorPhotoManager({ places, disabled = false, onSaved, requestedPlace }: { places: PhotoPlace[]; disabled?: boolean; onSaved?: () => void; requestedPlace?: { id: string } | null }) {
  const [selectedId, setSelectedId] = useState(() => places[0]?.id ?? '')
  const activePlace = places.find((place) => place.id === selectedId) ?? places[0]
  const activeId = activePlace?.id
  const [saved, setSaved] = useState<DoorPhoto>()
  const [draft, setDraft] = useState<Draft>()
  const [preview, setPreview] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState(false)
  const [message, setMessage] = useState('')
  const operationVersion = useRef(0)

  useEffect(() => {
    if (requestedPlace) setSelectedId(requestedPlace.id)
  }, [requestedPlace])

  // Keep the chosen room stable when another room is registered above.
  useEffect(() => {
    if (activeId && selectedId !== activeId) setSelectedId(activeId)
  }, [selectedId, activeId])

  useEffect(() => {
    let cancelled = false
    operationVersion.current += 1
    setSaved(undefined)
    setDraft(undefined)
    setError('')
    setMessage('')
    setLoadError(false)
    setLoading(false)
    setBusy(false)
    if (!activeId || disabled) return
    setLoading(true)
    readServerDoorPhoto(activeId).then((photo) => {
      if (!cancelled) setSaved(photo)
    }).catch((cause) => {
      if (!cancelled) {
        setError(errorMessage(cause))
        setLoadError(true)
      }
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activeId, disabled])

  const visibleBlob = draft?.blob ?? saved?.blob
  useEffect(() => {
    if (!visibleBlob) { setPreview(''); return }
    const url = URL.createObjectURL(visibleBlob)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [visibleBlob])

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !activeId || disabled) return
    const version = operationVersion.current
    setError('')
    setMessage('')
    setBusy(true)
    // If a new selection fails, keep only the last successfully saved photo.
    setDraft(undefined)
    try {
      const blob = await prepareDoorPhoto(file)
      if (version !== operationVersion.current) return
      setDraft({ blob, name: file.name })
    } catch (cause) {
      if (version === operationVersion.current) setError(cause instanceof Error ? cause.message : '사진을 처리하지 못했어요. 다시 선택해 주세요.')
    } finally { if (version === operationVersion.current) setBusy(false) }
  }

  async function save() {
    if (!draft || !activeId || busy || loading || loadError || disabled) return
    const version = operationVersion.current
    setBusy(true)
    setError('')
    setMessage('')
    const photo: DoorPhoto = { placeId: activeId, ...draft, savedAt: new Date().toISOString() }
    try {
      const stored = await saveServerDoorPhoto(photo)
      onSaved?.()
      if (version !== operationVersion.current) return
      setSaved(stored)
      setDraft(undefined)
      setMessage(`${activePlace.room} 출입문 사진을 서버에 저장했어요.`)
    } catch (cause) {
      if (version === operationVersion.current) setError(errorMessage(cause))
    } finally { if (version === operationVersion.current) setBusy(false) }
  }

  return (
    <section className="panel photo-panel" aria-labelledby="photo-title">
      <div className="photo-section-heading"><div><div className="panel-heading"><span className="section-icon" aria-hidden="true">▧</span><h2 id="photo-title">출입문 사진 등록</h2></div><p className="panel-description">방 이름과 출입문이 함께 보이는 사진을 연결해 주세요.</p></div><span className="photo-local-tag">로컬 서버에 보관</span></div>
      {!activePlace ? <p className="photo-no-places">먼저 위에서 장소를 등록하면 출입문 사진을 연결할 수 있어요.</p> : (
        <div className="photo-layout">
          <div className="photo-controls">
            <label htmlFor="photo-place">사진을 연결할 장소</label>
            <select id="photo-place" value={activeId} disabled={busy || loading || disabled} onChange={(event) => setSelectedId(event.target.value)}>{places.map((place) => <option key={place.id} value={place.id}>{place.building} · {place.floor} · {place.room}</option>)}</select>
            <label htmlFor="door-photo">출입문 사진 선택</label>
            <input id="door-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || loading || loadError || disabled} onChange={selectFile} aria-describedby="photo-file-hint" />
            <p className="input-hint" id="photo-file-hint">JPG · PNG · WebP 사진, 최대 15MB</p>
            <details className="photo-tip"><summary>사진 촬영 안내</summary><p>출입문과 장소 이름이 함께 보이게 촬영하세요. 복도에서 바라본 모습이면 알아보기 쉬워요.</p></details>
            {saved && !draft && <details className="photo-saved-info"><summary>저장된 사진 정보</summary><p>{saved.name}<br />{new Date(saved.savedAt).toLocaleString('ko-KR')} 저장</p></details>}
            {draft && <p className="photo-draft-info">선택한 사진: {draft.name}<br />아직 저장하지 않았어요. 미리보기 확인 후 저장해 주세요.{saved && <><br />저장하면 이 장소의 기존 사진을 교체해요.</>}</p>}
            {loading && <p className="feedback" role="status">저장된 사진을 불러오는 중이에요.</p>}
            {busy && <p className="feedback" role="status">사진을 처리하고 있어요.</p>}
            {error && <p className="feedback error" role="alert">{error}</p>}
            <p className="feedback success" role="status">{message}</p>
            <div className="photo-actions"><button type="button" className="register-button" disabled={!draft || busy || loading || loadError || disabled} onClick={save}>사진 저장</button>{draft && <button type="button" className="photo-cancel" disabled={busy} onClick={() => { setDraft(undefined); setError(''); setMessage('사진 선택을 취소했어요.'); }}>선택 취소</button>}</div>
          </div>
          <div className="photo-preview-area"><div className="photo-preview-heading"><strong>사진 미리보기</strong><span>{draft ? '저장 전' : saved ? '저장됨' : '사진 없음'}</span></div><div className="photo-preview-frame">{preview ? <img src={preview} alt={`${activePlace.building} ${activePlace.floor} ${activePlace.room} 출입문${draft ? ' 저장 전 미리보기' : ' 저장된 사진'}`} /> : <div className="photo-placeholder"><span aria-hidden="true">▧</span><strong>출입문 사진을 선택해 주세요.</strong><p>선택한 사진이 여기에 표시돼요.</p></div>}</div><p className="photo-preview-caption">{activePlace.building} · {activePlace.floor} · {activePlace.room}</p></div>
        </div>
      )}
      <p className="photo-storage-note">사진을 바꿀 때는 새 사진을 선택한 뒤 ‘사진 저장’을 눌러 주세요.</p>
    </section>
  )
}
