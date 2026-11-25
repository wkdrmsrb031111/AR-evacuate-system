import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { createConnection, errorMessage, getConnections, restoreConnection, setConnectionAvailability, trashConnection, updateConnection } from './api'
import type { Place, PlaceConnection } from './types'
import './ConnectionManager.css'
import './ConnectionGuidance.css'

const placeLabel = (place: Place) => `${place.building} · ${place.floor} · ${place.room}`
const normalized = (value: string) => value.toLocaleLowerCase().trim()

export default function ConnectionManager({ places, disabled, onChanged }: { places: Place[]; disabled: boolean; onChanged: () => void }) {
  const [links, setLinks] = useState<PlaceConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [distance, setDistance] = useState('')
  const [forward, setForward] = useState('')
  const [reverse, setReverse] = useState('')
  const [forwardDirection, setForwardDirection] = useState('')
  const [reverseDirection, setReverseDirection] = useState('')
  const [forwardFacingHint, setForwardFacingHint] = useState('')
  const [reverseFacingHint, setReverseFacingHint] = useState('')
  const [forwardSignText, setForwardSignText] = useState('')
  const [reverseSignText, setReverseSignText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [blockingId, setBlockingId] = useState<string | null>(null)
  const [blockedReason, setBlockedReason] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    if (disabled) return
    let cancelled = false
    setLoading(true)
    setLoaded(false)
    setError('')
    getConnections().then((data) => {
      if (!cancelled) { setLinks(data); setLoaded(true); onChanged() }
    }).catch((cause) => { if (!cancelled) setError(errorMessage(cause)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [disabled, revision, onChanged])

  const placesById = new Map(places.map((place) => [place.id, place]))
  const activePlaces = places.filter((place) => !place.deletedAt)
  const source = activePlaces.find((place) => place.id === sourceId)
  const destinations = source ? activePlaces.filter((place) => place.id !== source.id &&
    normalized(place.building) === normalized(source.building) && normalized(place.floor) === normalized(source.floor)) : []
  const activeLinks = links.filter((link) => !link.deletedAt)
  const visibleLinks = activeLinks.filter((link) => statusFilter === 'all' || (statusFilter === 'blocked' ? link.blocked : !link.blocked))
  const deletedLinks = links.filter((link) => link.deletedAt)
  const locked = disabled || busy || loading || !loaded
  const validSign = (value: string) => !value.trim() || value.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').length >= 2
  const guidanceReady = Boolean(forwardDirection && reverseDirection && forwardFacingHint.trim() && reverseFacingHint.trim() && validSign(forwardSignText) && validSign(reverseSignText))
  const canSubmit = !locked && Boolean(source) && destinations.some((place) => place.id === targetId) && guidanceReady
  const label = (id: string) => {
    const place = placesById.get(id)
    return place ? `${placeLabel(place)}${place.deletedAt ? ' (삭제한 장소)' : ''}` : '목록에 없는 장소'
  }
  const usable = (link: PlaceConnection) => [link.sourceId, link.targetId].every((id) => {
    const place = placesById.get(id)
    return place && !place.deletedAt
  })

  function clearForm() {
    setEditingId(null); setSourceId(''); setTargetId(''); setDistance(''); setForward(''); setReverse('')
    setForwardDirection(''); setReverseDirection(''); setForwardFacingHint(''); setReverseFacingHint('')
    setForwardSignText(''); setReverseSignText('')
  }

  function edit(link: PlaceConnection) {
    setFormOpen(true)
    setEditingId(link.id); setSourceId(link.sourceId); setTargetId(link.targetId)
    setDistance(String(link.distanceMeters)); setForward(link.forwardInstruction); setReverse(link.reverseInstruction)
    setForwardDirection(link.forwardDirection ?? ''); setReverseDirection(link.reverseDirection ?? '')
    setForwardFacingHint(link.forwardFacingHint); setReverseFacingHint(link.reverseFacingHint)
    setForwardSignText(link.forwardSignText); setReverseSignText(link.reverseSignText)
    setError(''); setMessage('')
    requestAnimationFrame(() => document.getElementById('connection-source')?.focus())
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    setError(''); setMessage('')
    const meters = Number(distance)
    if (!Number.isFinite(meters) || meters <= 0 || meters > 1000 || !forward.trim() || !reverse.trim() || !guidanceReady) {
      setError('거리, 양방향 안내 문장, 화살표 방향과 바라볼 기준을 입력해 주세요. 표지판 이름은 비우거나 두 글자 이상 작성해야 합니다.'); return
    }
    if (activeLinks.some((link) => link.id !== editingId &&
      ((link.sourceId === sourceId && link.targetId === targetId) || (link.sourceId === targetId && link.targetId === sourceId)))) {
      setError('이미 연결한 두 장소예요. 기존 연결을 수정해 주세요.'); return
    }
    setBusy(true)
    try {
      const values = { sourceId, targetId, distanceMeters: meters, forwardInstruction: forward.trim(), reverseInstruction: reverse.trim(),
        forwardDirection: forwardDirection as 'left' | 'straight' | 'right', reverseDirection: reverseDirection as 'left' | 'straight' | 'right',
        forwardFacingHint: forwardFacingHint.trim(), reverseFacingHint: reverseFacingHint.trim(),
        forwardSignText: forwardSignText.trim(), reverseSignText: reverseSignText.trim() }
      const saved = editingId ? await updateConnection(editingId, values) : await createConnection(values)
      setLinks((current) => [saved, ...current.filter((link) => link.id !== saved.id)])
      onChanged()
      setMessage(`${label(saved.sourceId)} ↔ ${label(saved.targetId)} 연결 저장 완료`)
      clearForm()
      setFormOpen(false)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  async function changeDeleted(link: PlaceConnection, restore = false) {
    if (locked) return
    setBusy(true); setError(''); setMessage('')
    try {
      const saved = await (restore ? restoreConnection(link.id) : trashConnection(link.id))
      setLinks((current) => current.map((item) => item.id === saved.id ? saved : item))
      onChanged()
      if (editingId === link.id) clearForm()
      if (blockingId === link.id) { setBlockingId(null); setBlockedReason('') }
      setMessage(restore ? '연결을 복원했어요.' : '연결을 삭제했어요. 아래 ‘삭제한 연결’에서 복원할 수 있어요.')
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  async function changeAvailability(link: PlaceConnection, blocked: boolean) {
    if (locked) return
    if (blocked && !blockedReason.trim()) { setError('통행 불가 사유를 입력해 주세요.'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const saved = await setConnectionAvailability(link.id, blocked, blockedReason.trim())
      setLinks((current) => current.map((item) => item.id === saved.id ? saved : item))
      setBlockingId(null); setBlockedReason(''); onChanged()
      setMessage(blocked ? '양방향 통행 불가로 저장했어요. 계산한 경로가 있으면 자동으로 다시 계산해요.' : '통행 가능으로 변경했어요. 계산한 경로가 있으면 자동으로 다시 계산해요.')
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  return <section className="panel connection-panel" aria-labelledby="connections-title">
    <div className="connection-heading"><div><h2 id="connections-title">길과 통행 상태</h2>
      <p className="panel-description">막힌 구간은 ‘통행 불가 등록’을 눌러 표시하세요.</p></div>
      <button className="register-button" type="button" disabled={locked} onClick={() => { clearForm(); setFormOpen(true); requestAnimationFrame(() => document.getElementById('connection-source')?.focus()) }}>새 길 연결</button></div>
    {activePlaces.length < 2 && <p className="connection-note">먼저 같은 건물·층에 장소를 두 곳 이상 등록해 주세요. 예: 제3회의실과 복도 갈림길.</p>}
    <div className={`connection-workspace ${formOpen ? 'with-form' : ''}`}>
      <form onSubmit={save} className="connection-form" hidden={!formOpen}>
        <div className="form-heading"><h3>{editingId ? '연결 정보 수정' : '새 연결 등록'}</h3><button type="button" className="place-cancel" disabled={busy} onClick={() => setFormOpen(false)}>닫기</button></div>
        <label htmlFor="connection-source">출발 장소</label>
        <select id="connection-source" required value={sourceId} disabled={locked} onChange={(event) => { setSourceId(event.target.value); setTargetId('') }}>
          <option value="">장소 선택</option>{activePlaces.map((place) => <option key={place.id} value={place.id}>{placeLabel(place)}</option>)}
        </select>
        <label htmlFor="connection-target">도착 장소</label>
        <select id="connection-target" required value={targetId} disabled={locked || !source} onChange={(event) => setTargetId(event.target.value)}>
          <option value="">같은 건물·층의 다른 장소 선택</option>{destinations.map((place) => <option key={place.id} value={place.id}>{placeLabel(place)}</option>)}
        </select>
        {source && destinations.length === 0 && <p className="input-hint">이 층에 연결할 다른 장소가 없어요. 먼저 장소를 추가해 주세요.</p>}
        <label htmlFor="connection-distance">두 장소 사이 거리 (m)</label>
        <input id="connection-distance" type="number" min="0.1" max="1000" step="0.1" inputMode="decimal" placeholder="예: 8" required value={distance} disabled={locked} onChange={(event) => setDistance(event.target.value)} />
        <label htmlFor="connection-forward">출발 → 도착 안내</label>
        <textarea id="connection-forward" rows={2} maxLength={300} placeholder="예: 회의실 문을 나와 파란 문 쪽으로 이동하세요." required value={forward} disabled={locked} onChange={(event) => setForward(event.target.value)} />
        <fieldset className="connection-guidance"><legend>출발 → 도착 카메라 안내</legend>
          <label htmlFor="connection-forward-direction">화살표 방향</label><select id="connection-forward-direction" required value={forwardDirection} disabled={locked} onChange={(event) => setForwardDirection(event.target.value)}><option value="">방향 선택</option><option value="straight">직진</option><option value="left">왼쪽</option><option value="right">오른쪽</option></select>
          <label htmlFor="connection-forward-facing">방향을 판단할 기준</label><input id="connection-forward-facing" required maxLength={200} value={forwardFacingHint} disabled={locked} placeholder="예: 회의실 문을 등지고 복도 표지판을 보세요." onChange={(event) => setForwardFacingHint(event.target.value)} />
          <label htmlFor="connection-forward-sign">AI가 읽을 표지판 이름 (선택)</label><input id="connection-forward-sign" maxLength={60} value={forwardSignText} disabled={locked} placeholder="예: 복도 갈림길" onChange={(event) => setForwardSignText(event.target.value)} />
        </fieldset>
        <label htmlFor="connection-reverse">도착 → 출발 안내</label>
        <textarea id="connection-reverse" rows={2} maxLength={300} placeholder="예: 제3회의실 표지판이 있는 문으로 이동하세요." required value={reverse} disabled={locked} onChange={(event) => setReverse(event.target.value)} />
        <fieldset className="connection-guidance"><legend>도착 → 출발 카메라 안내</legend>
          <label htmlFor="connection-reverse-direction">화살표 방향</label><select id="connection-reverse-direction" required value={reverseDirection} disabled={locked} onChange={(event) => setReverseDirection(event.target.value)}><option value="">방향 선택</option><option value="straight">직진</option><option value="left">왼쪽</option><option value="right">오른쪽</option></select>
          <label htmlFor="connection-reverse-facing">방향을 판단할 기준</label><input id="connection-reverse-facing" required maxLength={200} value={reverseFacingHint} disabled={locked} placeholder="예: 계단 문을 등지고 회의실 표지판을 보세요." onChange={(event) => setReverseFacingHint(event.target.value)} />
          <label htmlFor="connection-reverse-sign">AI가 읽을 표지판 이름 (선택)</label><input id="connection-reverse-sign" maxLength={60} value={reverseSignText} disabled={locked} placeholder="예: 제3회의실" onChange={(event) => setReverseSignText(event.target.value)} />
        </fieldset>
        <p className="input-hint">반대로 걸을 때는 안내가 달라질 수 있어요. 두 방향을 각각 작성해 주세요.</p>
        <div className="place-form-actions"><button className="register-button" type="submit" disabled={!canSubmit}>{busy ? '처리 중…' : editingId ? '연결 수정 저장' : '연결 저장'}</button>
          <button className="place-cancel" type="button" disabled={busy} onClick={() => { clearForm(); setFormOpen(false) }}>취소</button></div>
      </form>
      <div className="connection-list"><div className="connection-list-toolbar"><div><label htmlFor="connection-status-filter">통행 상태 선택</label><select id="connection-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">전체 {activeLinks.length}구간</option><option value="blocked">통행 불가 {activeLinks.filter((link) => link.blocked).length}구간</option><option value="open">통행 가능 {activeLinks.filter((link) => !link.blocked).length}구간</option></select></div><button className="place-cancel" type="button" disabled={disabled || busy || loading} onClick={() => setRevision((value) => value + 1)}>목록 새로고침</button></div>
        {loading && !disabled && <p className="connection-note">연결 목록을 불러오는 중이에요.</p>}
        {loaded && activeLinks.length === 0 && <div className="connection-empty"><strong>첫 번째 연결을 만들어 보세요.</strong><p>회의실 ↔ 복도, 복도 ↔ 비상계단 입구처럼<br />구간을 나누어 저장해요.</p></div>}
        {loaded && activeLinks.length > 0 && visibleLinks.length === 0 && <p className="connection-empty">선택한 상태의 구간이 없어요.</p>}
        <ul>{visibleLinks.map((link) => <li key={link.id} className={`${editingId === link.id ? 'selected-link' : ''} ${link.blocked ? 'blocked-link' : ''}`}>
          <strong>{placesById.get(link.sourceId)?.room ?? label(link.sourceId)}<span className="connection-pair">↔ {placesById.get(link.targetId)?.room ?? label(link.targetId)}</span></strong>
          <p className="connection-location">{placesById.get(link.sourceId)?.building} · {placesById.get(link.sourceId)?.floor}</p>
          <span className={`connection-availability ${link.blocked ? 'unavailable' : ''}`}>{link.blocked ? '통행 불가 · 양방향' : '통행 가능'}</span>
          <p className="connection-meta">{link.distanceMeters}m · 양방향 연결{!usable(link) ? ' · 연결된 장소 삭제로 앱에서 숨김' : ''}</p>
          {link.blocked && <div className="blocked-details"><p>통행 불가 사유: {link.blockedReason}</p><p>등록 시각: {link.blockedAt ? new Date(link.blockedAt).toLocaleString('ko-KR') : '확인 필요'}</p></div>}
          <div className="row-actions"><button type="button" className={link.blocked ? 'edit-place' : 'block-connection'} disabled={locked || !usable(link)} onClick={() => {
              if (link.blocked) void changeAvailability(link, false)
              else { setBlockingId(link.id); setBlockedReason(''); setError(''); setMessage('') }
            }}>{link.blocked ? '통행 가능으로 변경' : '통행 불가 등록'}</button></div>
          {blockingId === link.id && <form className="block-form" onSubmit={(event) => { event.preventDefault(); void changeAvailability(link, true) }}>
            <label htmlFor={`block-reason-${link.id}`}>통행 불가 사유</label>
            <input id={`block-reason-${link.id}`} value={blockedReason} onChange={(event) => setBlockedReason(event.target.value)} maxLength={200} required disabled={locked} placeholder="예: 통로에 장애물이 있어 이동 불가" />
            <p>이 연결은 양방향 모두 경로 계산에서 제외돼요.</p>
            <div className="row-actions"><button type="submit" className="block-connection" disabled={locked}>통행 불가 저장</button><button type="button" className="place-cancel" disabled={busy} onClick={() => { setBlockingId(null); setBlockedReason('') }}>통행 불가 등록 취소</button></div>
          </form>}
          <details className="connection-edit-details"><summary>길 정보 보기·수정</summary><p>가는 길: {link.forwardInstruction} · {link.forwardDirection ?? '화살표 미등록'}</p><p>오는 길: {link.reverseInstruction} · {link.reverseDirection ?? '화살표 미등록'}</p>{(!link.forwardDirection || !link.reverseDirection) && <p className="connection-guidance-warning">카메라 안내를 사용하려면 이 연결을 수정해 방향 기준을 등록해 주세요.</p>}<div className="row-actions"><button type="button" className="edit-place" disabled={locked || !usable(link)} onClick={() => edit(link)}>연결 수정</button><button type="button" className="delete-place" disabled={locked} onClick={() => changeDeleted(link)}>연결 삭제</button></div></details>
        </li>)}</ul>
        {deletedLinks.length > 0 && <details className="deleted-places"><summary>삭제한 연결 {deletedLinks.length}개</summary><ul>{deletedLinks.map((link) => <li key={link.id}><span>{label(link.sourceId)} ↔ {label(link.targetId)}</span>
          <button type="button" className="edit-place" disabled={locked || !usable(link)} onClick={() => changeDeleted(link, true)}>연결 복원</button></li>)}</ul><p>연결된 장소가 삭제됐다면 장소부터 복원해 주세요.</p></details>}
      </div>
    </div>
    {error && <p className="feedback error" role="alert">{error}</p>}
    <p className="feedback success" role="status">{message}</p>
    <p className="connection-note">통행 불가로 등록한 연결은 양방향 모두 경로 계산에서 제외돼요. 통행 가능으로 변경하면 다시 계산에 포함돼요. 장소·구간·통행 상태는 관리자가 직접 등록하는 시연 기능이에요.</p>
  </section>
}
