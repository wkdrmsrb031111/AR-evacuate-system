import { useEffect, useRef, useState } from 'react'
import { errorMessage, getDemoReadiness } from './api'
import { placeKindLabels } from './types'
import type { DemoReadiness as Report, Place } from './types'
import './DemoReadiness.css'

export default function DemoReadiness({ places, disabled, connectionRevision, photoRevision, onNavigate }: {
  places: Place[]; disabled: boolean; connectionRevision: number; photoRevision: number; onNavigate: (target: 'places' | 'connections' | 'photos') => void
}) {
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [changed, setChanged] = useState(false)
  const requestVersion = useRef(0)
  const checkedOnce = useRef(false)

  useEffect(() => {
    requestVersion.current++
    setReport(null); setBusy(false); setError(''); setChanged(checkedOnce.current)
    return () => { requestVersion.current++ }
  }, [places, disabled, connectionRevision, photoRevision])

  async function inspect() {
    if (busy || disabled) return
    const version = ++requestVersion.current
    setBusy(true); setReport(null); setError(''); setChanged(false)
    try {
      const result = await getDemoReadiness()
      if (version !== requestVersion.current) return
      checkedOnce.current = true
      setReport(result)
    } catch (cause) {
      if (version === requestVersion.current) setError(errorMessage(cause))
    } finally {
      if (version === requestVersion.current) setBusy(false)
    }
  }

  return <section className="panel readiness-panel" aria-labelledby="readiness-title">
    <div className="readiness-heading"><div><div className="eyebrow">발표 전 확인</div><h2 id="readiness-title">시연 준비를 점검해요.</h2>
      <p className="panel-description">일반 장소마다 계단 입구까지 경로가 있는지, 등록된 장소에 사진이 빠졌는지 한 번에 확인해요.</p></div>
      <button className="register-button" type="button" disabled={disabled || busy} onClick={inspect}>{busy ? '등록 정보 점검 중…' : '시연 준비 점검하기'}</button></div>
    {busy && <p className="feedback" role="status">등록된 장소·연결·통행 불가 상태·사진을 확인하고 있어요.</p>}
    {error && <p className="feedback error" role="alert">{error}</p>}
    {changed && <p className="connection-note" role="status">등록 정보가 변경되었어요. 다시 점검해 최신 결과를 확인해 주세요.</p>}
    {!report && !busy && !error && !changed && <p className="readiness-intro">버튼을 누르면 보완할 장소를 정리해 드려요. 사진이 없어도 경로 계산은 가능해요.</p>}
    {report && <>
      <p className="readiness-time" role="status">점검 완료 · {new Date(report.checkedAt).toLocaleString('ko-KR')}</p>
      <dl className="readiness-summary">
        <div><dt>점검한 일반 장소</dt><dd>{report.summary.roomCount}<span>곳</span></dd></div>
        <div className="readiness-positive"><dt>경로 계산 가능</dt><dd>{report.summary.reachableRoomCount}<span>곳</span></dd></div>
        <div className={report.summary.needsRouteCount > 0 ? 'readiness-attention' : ''}><dt>경로 보완 필요</dt><dd>{report.summary.needsRouteCount}<span>곳</span></dd></div>
        <div className={report.summary.missingPhotoCount > 0 ? 'readiness-attention' : ''}><dt>사진 미등록 · 전체 장소</dt><dd>{report.summary.missingPhotoCount}<span>곳</span></dd></div>
      </dl>
      <h3>일반 장소별 경로 점검</h3>
      {report.checks.length === 0 ? <p className="connection-note">점검할 일반 장소가 없어요. 회의실·강의실을 ‘일반 장소’로 먼저 등록해 주세요.</p> :
        <ul className="readiness-checks">{report.checks.map((item) => <li key={item.place.id}>
          <div className="readiness-place"><strong>{item.place.room}</strong><span>{item.place.building} · {item.place.floor}</span></div>
          <div className="readiness-result"><span className={`readiness-badge ${item.status === 'found' ? 'available' : 'needs-work'}`}>{item.status === 'found' ? '경로 계산 가능' : item.status === 'no_stairs' ? '계단 입구 미등록' : '연결된 경로 없음'}</span>
            {item.status === 'found' && item.destination ? <p>{item.destination.room}까지 {item.totalDistanceMeters}m{item.rerouted ? ' · 우회 경로' : ''}</p> : <p>{item.message}</p>}
          </div>
        </li>)}</ul>}
      <details className="readiness-photos"><summary>사진 미등록 장소 {report.summary.missingPhotoCount}곳 확인</summary>
        {report.missingPhotoPlaces.length === 0 ? <p>모든 활성 장소에 사진이 등록되어 있어요. 사진 내용은 직접 확인해 주세요.</p> :
          <ul>{report.missingPhotoPlaces.map((place) => <li key={place.id}>{place.building} · {place.floor} · <strong>{place.room}</strong> <span>({placeKindLabels[place.kind]})</span></li>)}</ul>}
      </details>
      <nav className="readiness-actions" aria-label="점검 결과 보완"><button type="button" className="place-cancel" onClick={() => onNavigate('places')}>장소 관리로 이동</button><button type="button" className="place-cancel" onClick={() => onNavigate('connections')}>길·통행 관리로 이동</button><button type="button" className="place-cancel" onClick={() => onNavigate('photos')}>사진 관리로 이동</button></nav>
      <p className="connection-note">{report.notice}</p>
    </>}
  </section>
}
