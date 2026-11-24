import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import DoorPhotoManager from './DoorPhotoManager'
import ConnectionManager from './ConnectionManager'
import RoutePreview from './RoutePreview'
import DemoReadiness from './DemoReadiness'
import BackupDownload from './BackupDownload'
import OcrTest from './OcrTest'
import { createPlace, errorMessage, getPlaces, getServerStatus, importLegacyPlaces, restorePlace as restoreServerPlace, trashPlace, updatePlace } from './api'
import { placeKindLabels } from './types'
import type { Place, PlaceKind } from './types'
import './App.css'

const STORAGE_KEY = 'evacuate-admin.places.v1'
const IMPORT_KEY = 'evacuate-admin.server-import.v1'
const clean = (value: string) => value.trim().replace(/\s+/g, ' ')
const WORKSPACES = [
  { id: 'places', title: '장소·사진', description: '장소를 등록하고 사진을 넣어요.', heading: '어느 장소를 관리할까요?' },
  { id: 'connections', title: '길·통행', description: '길을 연결하고 막힌 구간을 표시해요.', heading: '길과 통행 상태를 관리해요.' },
  { id: 'checks', title: '확인·점검', description: '대피 경로와 빠진 정보를 확인해요.', heading: '안내가 잘 되는지 확인해요.' },
] as const
type Workspace = typeof WORKSPACES[number]['id']

function readPlaces(): { places: Place[]; error: string } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return { places: [], error: '' }
    const parsed: unknown = JSON.parse(saved)
    if (!Array.isArray(parsed) || !parsed.every((item) =>
      item !== null && typeof item === 'object' &&
      ['id', 'building', 'floor', 'room', 'createdAt'].every((key) =>
        typeof item[key] === 'string' && item[key].trim().length > 0) &&
      (item.deletedAt === undefined || typeof item.deletedAt === 'string'),
    )) throw new Error('Invalid saved data')
    return { places: parsed as Place[], error: '' }
  } catch {
    return { places: [], error: '저장 정보를 읽지 못했어요. 브라우저 저장 설정을 확인한 뒤 새로고침해 주세요.' }
  }
}

function App() {
  const [workspace, setWorkspace] = useState<Workspace>('places')
  const [placeView, setPlaceView] = useState<'list' | 'photos'>('list')
  const [checkView, setCheckView] = useState<'route' | 'readiness' | 'ocr'>('route')
  const [placeFormOpen, setPlaceFormOpen] = useState(false)
  const [placeSearch, setPlaceSearch] = useState('')
  const [buildingFilter, setBuildingFilter] = useState('')
  const [requestedPhoto, setRequestedPhoto] = useState<{ id: string } | null>(null)
  const [largeText, setLargeText] = useState(() => {
    try { return localStorage.getItem('evacuate-admin.large-text') === 'true' } catch { return false }
  })
  const [initial] = useState(readPlaces)
  const [places, setPlaces] = useState<Place[]>([])
  const [connection, setConnection] = useState<'loading' | 'ready' | 'error'>('loading')
  const [connectionError, setConnectionError] = useState('')
  const [databaseId, setDatabaseId] = useState('')
  const [reloadVersion, setReloadVersion] = useState(0)
  const [connectionRevision, setConnectionRevision] = useState(0)
  const connectionsChanged = useCallback(() => setConnectionRevision((version) => version + 1), [])
  const [photoRevision, setPhotoRevision] = useState(0)
  const photosChanged = useCallback(() => setPhotoRevision((version) => version + 1), [])
  const [needsImport, setNeedsImport] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [importMessage, setImportMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [building, setBuilding] = useState('')
  const [floor, setFloor] = useState('')
  const [room, setRoom] = useState('')
  const [kind, setKind] = useState<PlaceKind>('room')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingPlace, setDeletingPlace] = useState<Place | null>(null)
  const [listError, setListError] = useState('')
  const [listMessage, setListMessage] = useState('')
  const roomInput = useRef<HTMLInputElement>(null)
  const buildingInput = useRef<HTMLInputElement>(null)
  const deleteDialog = useRef<HTMLDialogElement>(null)
  const activePlaces = places.filter((place) => !place.deletedAt)
  const deletedPlaces = places.filter((place) => Boolean(place.deletedAt))
  const canWrite = connection === 'ready' && !saving && !importing && !needsImport
  const currentWorkspace = WORKSPACES.find((item) => item.id === workspace)!
  const buildings = [...new Set(activePlaces.map((place) => place.building))]
  const visiblePlaces = activePlaces.filter((place) => (!buildingFilter || place.building === buildingFilter) &&
    `${place.building} ${place.floor} ${place.room}`.toLocaleLowerCase().includes(placeSearch.trim().toLocaleLowerCase()))

  useEffect(() => {
    try { localStorage.setItem('evacuate-admin.large-text', String(largeText)) } catch { /* Preference is optional. */ }
  }, [largeText])

  function showPhoto(place: Place) {
    setRequestedPhoto({ id: place.id }); setPlaceView('photos')
  }

  function navigateTo(target: 'places' | 'connections' | 'photos') {
    setWorkspace(target === 'connections' ? 'connections' : 'places')
    setPlaceView(target === 'photos' ? 'photos' : 'list')
    if (target === 'places') { setBuildingFilter(''); setPlaceSearch('') }
    requestAnimationFrame(() => document.getElementById(`nav-${target === 'connections' ? 'connections' : 'places'}`)?.focus())
  }

  useEffect(() => {
    let cancelled = false
    setConnection('loading')
    setConnectionError('')
    Promise.all([getServerStatus(), getPlaces()]).then(([status, data]) => {
      if (cancelled) return
      setDatabaseId(status.databaseId)
      setPlaces(data)
      let alreadyCopied = false
      try { alreadyCopied = localStorage.getItem(IMPORT_KEY) === status.databaseId } catch { /* Backup marker is optional. */ }
      setNeedsImport(initial.places.length > 0 && !alreadyCopied)
      setConnection('ready')
    }).catch((cause) => {
      if (!cancelled) { setConnectionError(errorMessage(cause)); setConnection('error') }
    })
    return () => { cancelled = true }
  }, [initial.places, reloadVersion])

  async function copyLegacyData() {
    if (importing || connection !== 'ready') return
    setImporting(true)
    setImportError('')
    try {
      const copied = await importLegacyPlaces(initial.places)
      setPlaces(copied.places)
      try { localStorage.setItem(IMPORT_KEY, databaseId) } catch { /* Repeating import is safe. */ }
      setNeedsImport(false)
      setImportMessage(`서버 복사 완료 · 새 장소 ${copied.importedPlaces}개, 사진 ${copied.importedPhotos}장. 브라우저 원본도 유지했어요.`)
    } catch (cause) { setImportError(errorMessage(cause)) }
    finally { setImporting(false) }
  }

  function replacePlace(stored: Place) {
    setPlaces((current) => current.map((place) => place.id === stored.id ? stored : place))
  }

  useEffect(() => {
    if (deletingPlace) deleteDialog.current?.showModal()
    else deleteDialog.current?.close()
  }, [deletingPlace])

  function resetForm() {
    setEditingId(null)
    setBuilding('')
    setFloor('')
    setRoom('')
    setKind('room')
    setError('')
    setMessage('')
  }

  function editPlace(place: Place) {
    setPlaceFormOpen(true)
    setEditingId(place.id)
    setBuilding(place.building)
    setFloor(place.floor)
    setRoom(place.room)
    setKind(place.kind)
    setError('')
    setMessage('')
    requestAnimationFrame(() => {
      buildingInput.current?.focus()
      buildingInput.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }

  async function confirmDelete() {
    if (!deletingPlace || !canWrite) return
    setSaving(true)
    try {
      replacePlace(await trashPlace(deletingPlace.id))
      if (editingId === deletingPlace.id) resetForm()
      setListError('')
      setListMessage(`${deletingPlace.room}을 삭제한 장소로 이동했어요. 아래에서 복원할 수 있어요.`)
    } catch (cause) { setListError(errorMessage(cause)) }
    finally { setDeletingPlace(null); setSaving(false) }
  }

  async function restorePlace(place: Place) {
    if (!canWrite) return
    setListMessage('')
    const duplicate = activePlaces.some((other) =>
      (['building', 'floor', 'room'] as const).every((key) => clean(other[key]).toLocaleLowerCase() === clean(place[key]).toLocaleLowerCase()))
    if (duplicate) {
      setListError('같은 건물·층·방 이름의 장소가 이미 있어요. 등록된 장소의 이름을 수정한 뒤 복원해 주세요.')
      return
    }
    setSaving(true)
    try {
      replacePlace(await restoreServerPlace(place.id))
      setListError('')
      setListMessage(`${place.room}을 복원했어요. 연결된 출입문 사진도 다시 확인할 수 있어요.`)
    } catch (cause) { setListError(errorMessage(cause)) }
    finally { setSaving(false) }
  }

  async function registerPlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    if (!canWrite) return
    const values = { building: clean(building), floor: clean(floor), room: clean(room), kind }
    if (Object.values(values).some((value) => !value)) {
      setError('건물 이름, 층, 방 이름을 모두 입력해 주세요.')
      return
    }
    if (activePlaces.some((place) => place.id !== editingId &&
      (['building', 'floor', 'room'] as const).every((key) =>
        place[key].toLocaleLowerCase() === values[key].toLocaleLowerCase()),
    )) {
      setError('같은 건물·층에 이미 등록된 방이에요. 목록을 확인해 주세요.')
      return
    }
    if (editingId && !activePlaces.some((place) => place.id === editingId)) {
      setError('수정할 장소를 찾을 수 없어요. 목록에서 다시 선택해 주세요.')
      return
    }
    setSaving(true)
    try {
      const stored = editingId ? await updatePlace(editingId, values) : await createPlace(values)
      if (editingId) replacePlace(stored)
      else setPlaces((current) => [stored, ...current])
      const wasEditing = Boolean(editingId)
      setEditingId(null)
      setBuilding(values.building)
      setFloor(values.floor)
      setRoom('')
      setPlaceFormOpen(false)
      requestAnimationFrame(() => document.getElementById('add-place-trigger')?.focus())
      setMessage(`${values.building} · ${values.floor} · ${values.room} 서버 ${wasEditing ? '수정' : '등록'} 완료`)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setSaving(false) }
  }

  return (
    <div className={`app-shell ${largeText ? 'large-text' : ''}`}>
      <a className="skip-link" href="#main-content">본문으로 바로가기</a>
      <header className="site-header">
        <div className="brand"><span className="brand-mark" aria-hidden="true">▤</span><div><strong>AR Evacuate</strong><span>대피 안내 관리자</span></div></div>
        <button type="button" className="text-size-button" aria-pressed={largeText} onClick={() => setLargeText((value) => !value)}>큰 글씨 {largeText ? '켜짐' : '보기'}</button>
      </header>
      <main id="main-content">
        <div className="connection-bar">
          <span className={`connection-pill ${connection}`} role="status">{connection === 'ready' ? '저장 준비됨' : connection === 'loading' ? '연결 확인 중' : '저장 연결 끊김'}</span>
          <details className="connection-details"><summary>연결 확인</summary><div><p>정보는 이 PC의 서버에 저장돼요.</p><button type="button" className="place-cancel" disabled={connection === 'loading' || saving || importing} onClick={() => setReloadVersion((version) => version + 1)}>다시 연결하기</button></div></details>
        </div>
        {connection === 'error' && <p className="feedback error" role="alert">{connectionError} ‘연결 확인’에서 다시 연결해 주세요.</p>}
        <div className="page-intro"><div className="eyebrow">관리자 화면</div><h1>{currentWorkspace.heading}</h1><p>{currentWorkspace.description} </p></div>
        <div className="workspace-nav" role="tablist" aria-label="관리 작업 선택">{WORKSPACES.map((item, index) => <button key={item.id} id={`nav-${item.id}`} type="button" role="tab" aria-label={item.title} aria-selected={workspace === item.id} aria-controls={`panel-${item.id}`} tabIndex={workspace === item.id ? 0 : -1} disabled={saving || importing} onClick={() => setWorkspace(item.id)} onKeyDown={(event) => {
          const current = WORKSPACES.findIndex((entry) => entry.id === workspace)
          const next = event.key === 'ArrowRight' ? (current + 1) % 3 : event.key === 'ArrowLeft' ? (current + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : -1
          if (next < 0) return
          event.preventDefault(); setWorkspace(WORKSPACES[next].id); document.getElementById(`nav-${WORKSPACES[next].id}`)?.focus()
        }}><span className="workspace-number" aria-hidden="true">{index + 1}</span><strong><span className="nav-word">{item.title.split('·')[0]}</span><span className="nav-separator">·</span><span className="nav-word">{item.title.split('·')[1]}</span></strong><span className="workspace-description">{item.description}</span></button>)}</div>
        {needsImport && connection === 'ready' && <section className="migration-panel" aria-label="기존 데이터 서버 복사"><div><h2>기존 장소와 사진을 가져와요.</h2><p>이 브라우저에 남은 장소 {initial.places.length}개와 사진을 서버로 복사해요. 원본은 유지돼요.</p></div><button type="button" className="register-button" disabled={importing} onClick={copyLegacyData}>{importing ? '가져오는 중…' : '기존 정보 가져오기'}</button>{importError && <p className="feedback error" role="alert">{importError}</p>}</section>}
        {initial.error && <p className="feedback error" role="alert">{initial.error}</p>}
        {importMessage && <p className="feedback success" role="status">{importMessage}</p>}

        <section id="panel-places" role="tabpanel" aria-labelledby="nav-places" hidden={workspace !== 'places'}>
          <div className="view-switch" role="group" aria-label="장소 작업 선택"><button type="button" aria-pressed={placeView === 'list'} onClick={() => setPlaceView('list')}>장소 관리</button><button type="button" aria-pressed={placeView === 'photos'} onClick={() => setPlaceView('photos')}>사진 관리</button></div>
          <div hidden={placeView !== 'list'}>
            <div className="task-toolbar"><div><h2>등록된 장소 <span className="count">{activePlaces.length}곳</span></h2><p>장소를 고른 뒤 사진을 넣거나 정보를 수정하세요.</p></div><button type="button" id="add-place-trigger" className="register-button" disabled={!canWrite} onClick={() => { setPlaceFormOpen(true); setEditingId(null); setRoom(''); setKind('room'); setError(''); setMessage(''); requestAnimationFrame(() => buildingInput.current?.focus()) }}>새 장소 추가</button></div>
            <section className="panel form-panel" aria-labelledby="register-title" hidden={!placeFormOpen}>
              <div className="form-heading"><h2 id="register-title">{editingId ? '장소 정보 수정' : '새 장소 등록'}</h2><button type="button" className="place-cancel" disabled={saving} onClick={() => { setPlaceFormOpen(false); resetForm() }}>닫기</button></div>
              <p className="panel-description">표지판에 적힌 이름을 입력하세요. 사진은 등록 후 넣을 수 있어요.</p>
              <form onSubmit={registerPlace}>
                <div className="place-input-grid"><div><label htmlFor="building">건물 이름</label><input ref={buildingInput} id="building" value={building} onChange={(event) => setBuilding(event.target.value)} placeholder="예: 본관" maxLength={60} required disabled={!canWrite} /></div>
                <div><label htmlFor="floor">층</label><input id="floor" value={floor} onChange={(event) => setFloor(event.target.value)} placeholder="예: 2층" maxLength={30} required disabled={!canWrite} /></div>
                <div><label htmlFor="kind">장소 종류</label><select id="kind" value={kind} onChange={(event) => setKind(event.target.value as PlaceKind)} disabled={!canWrite}>{Object.entries(placeKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
                <div><label htmlFor="room">장소 이름</label><input ref={roomInput} id="room" value={room} onChange={(event) => setRoom(event.target.value)} placeholder="예: 제3회의실" maxLength={60} required disabled={!canWrite} /></div></div>
                {error && <p className="feedback error" role="alert">{error}</p>}
                <div className="place-form-actions"><button className="register-button" type="submit" disabled={!canWrite}>{saving ? '저장 중…' : editingId ? '수정 내용 저장' : '장소 등록'}</button><button className="place-cancel" type="button" disabled={saving} onClick={() => { setPlaceFormOpen(false); resetForm() }}>취소</button></div>
              </form>
            </section>
            {message && <p className="feedback success" role="status">{message}</p>}
            {listError && <p className="feedback error" role="alert">{listError}</p>}
            {listMessage && <p className="feedback success" role="status">{listMessage}</p>}
            {activePlaces.length > 0 && <div className="place-filters"><div><label htmlFor="place-building-filter">건물 선택</label><select id="place-building-filter" value={buildingFilter} onChange={(event) => setBuildingFilter(event.target.value)}><option value="">전체 건물</option>{buildings.map((name) => <option key={name} value={name}>{name}</option>)}</select></div><div><label htmlFor="place-search">장소 찾기</label><input id="place-search" type="search" value={placeSearch} onChange={(event) => setPlaceSearch(event.target.value)} placeholder="장소 이름이나 층을 입력하세요" /></div></div>}
            {activePlaces.length === 0 ? <div className="panel empty-state"><h3>아직 등록된 장소가 없어요.</h3><p>‘새 장소 추가’부터 시작하세요.</p></div> : visiblePlaces.length === 0 ? <div className="panel empty-state"><h3>찾는 장소가 없어요.</h3><button type="button" className="place-cancel" onClick={() => { setBuildingFilter(''); setPlaceSearch('') }}>검색 조건 지우기</button></div> : <ul className="place-cards">{visiblePlaces.map((place) => <li key={place.id} className="panel place-card"><div className="place-card-heading"><span className={`place-kind kind-${place.kind}`}>{placeKindLabels[place.kind]}</span><span className="place-location">{place.floor}</span></div><h3>{place.room}</h3><p>{place.building}</p><div className="place-card-actions"><button type="button" className="photo-place-button" onClick={() => showPhoto(place)} aria-label={`${place.building} ${place.floor} ${place.room} 사진 관리`}>사진 관리</button><button type="button" className="edit-place" disabled={!canWrite} onClick={() => editPlace(place)} aria-label={`${place.building} ${place.floor} ${place.room} 수정`}>수정</button><button type="button" className="delete-place" disabled={!canWrite} onClick={() => { setListError(''); setListMessage(''); setDeletingPlace(place) }} aria-label={`${place.building} ${place.floor} ${place.room} 삭제`}>삭제</button></div></li>)}</ul>}
            {deletedPlaces.length > 0 && <details className="deleted-places"><summary>삭제한 장소 {deletedPlaces.length}곳</summary><p>복원하면 기존 사진과 연결 정보도 다시 확인할 수 있어요.</p><ul>{deletedPlaces.map((place) => <li key={place.id}><span>{place.building} · {place.floor} · {place.room}</span><button type="button" className="edit-place" disabled={!canWrite} onClick={() => restorePlace(place)}>복원</button></li>)}</ul></details>}
          </div>
          <div hidden={placeView !== 'photos'}><DoorPhotoManager places={activePlaces} disabled={connection !== 'ready' || importing || needsImport} onSaved={photosChanged} requestedPlace={requestedPhoto} /></div>
        </section>
        <section id="panel-connections" role="tabpanel" aria-labelledby="nav-connections" hidden={workspace !== 'connections'}><ConnectionManager places={places} disabled={connection !== 'ready' || importing || needsImport} onChanged={connectionsChanged} /></section>
        <section id="panel-checks" role="tabpanel" aria-labelledby="nav-checks" hidden={workspace !== 'checks'}>
          <div className="view-switch" role="group" aria-label="확인 작업 선택"><button type="button" aria-pressed={checkView === 'route'} onClick={() => setCheckView('route')}>대피 경로 확인</button><button type="button" aria-pressed={checkView === 'readiness'} onClick={() => setCheckView('readiness')}>등록 정보 점검</button><button type="button" aria-pressed={checkView === 'ocr'} onClick={() => setCheckView('ocr')}>표지판 인식 테스트</button></div>
          {checkView === 'ocr' && workspace === 'checks' && <OcrTest places={activePlaces} disabled={connection !== 'ready' || importing || needsImport || saving} connectionRevision={connectionRevision} />}
          <div hidden={checkView !== 'route'}><RoutePreview places={places} disabled={connection !== 'ready' || importing || needsImport || saving} connectionRevision={connectionRevision} /></div>
          <div hidden={checkView !== 'readiness'}><DemoReadiness places={places} disabled={connection !== 'ready' || importing || needsImport || saving} connectionRevision={connectionRevision} photoRevision={photoRevision} onNavigate={navigateTo} /></div>
        </section>
        <BackupDownload disabled={!canWrite} />
        <footer className="page-footer">총알받이 · 관리자용 시제품</footer>
      </main>
      <dialog ref={deleteDialog} className="delete-dialog" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description" onCancel={(event) => { if (saving) event.preventDefault(); else setDeletingPlace(null) }} onClose={() => setDeletingPlace(null)}>
        <h2 id="delete-dialog-title">이 장소를 삭제할까요?</h2>
        {deletingPlace && <p className="delete-place-name">{deletingPlace.building} · {deletingPlace.floor} · {deletingPlace.room}</p>}
        <p id="delete-dialog-description">장소와 사진은 ‘삭제한 장소’에 보관돼요. 나중에 복원할 수 있어요.</p>
        <div className="dialog-actions"><button autoFocus type="button" className="place-cancel" disabled={saving} onClick={() => setDeletingPlace(null)}>취소</button><button type="button" className="confirm-delete" disabled={!canWrite} onClick={confirmDelete}>{saving ? '처리 중…' : '삭제하기'}</button></div>
      </dialog>
    </div>
  )
}

export default App
