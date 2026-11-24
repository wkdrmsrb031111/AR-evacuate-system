import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { errorMessage, getNearestStairsRoute } from './api'
import { placeKindLabels } from './types'
import type { NearestStairsRoute, Place } from './types'
import RoutePlacePhoto from './RoutePlacePhoto'
import CameraRouteExport from './CameraRouteExport'
import './RoutePreview.css'

export default function RoutePreview({ places, disabled, connectionRevision, confirmedSource }: {
  places: Place[]; disabled: boolean; connectionRevision: number; confirmedSource?: Place
}) {
  const titleId = useId()
  const sourceInputId = useId()
  const [sourceId, setSourceId] = useState(confirmedSource?.id ?? '')
  const [result, setResult] = useState<NearestStairsRoute | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(confirmedSource ? 1 : 0)
  const requestVersion = useRef(0)
  const activePlaces = places.filter((place) => !place.deletedAt)
  const sourceValid = activePlaces.some((place) => place.id === sourceId)

  useEffect(() => {
    const version = ++requestVersion.current
    setResult(null); setError('')
    if (disabled || attempt === 0 || !places.some((place) => place.id === sourceId && !place.deletedAt)) {
      setBusy(false)
      return () => { requestVersion.current++ }
    }
    setBusy(true)
    getNearestStairsRoute(sourceId).then((calculated) => {
      if (version === requestVersion.current) setResult(calculated)
    }).catch((cause) => {
      if (version === requestVersion.current) setError(errorMessage(cause))
    }).finally(() => {
      if (version === requestVersion.current) setBusy(false)
    })
    return () => { requestVersion.current++ }
  }, [places, disabled, connectionRevision, sourceId, attempt])

  function selectSource(value: string) {
    requestVersion.current++
    setSourceId(value); setAttempt(0); setResult(null); setError(''); setBusy(false)
  }

  function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled || busy || !sourceValid) return
    setResult(null); setError(''); setBusy(true)
    setAttempt((value) => value + 1)
  }

  const found = result?.status === 'found' || result?.status === 'already_at_stairs'
  const routePlaces = new Map(result?.places.map((place) => [place.id, place]) ?? [])

  return <section className="panel route-panel" aria-labelledby={titleId}>
    <div className="eyebrow">경로 계산 미리보기</div>
    <h2 id={titleId}>가장 가까운 비상계단 입구를 찾아요.</h2>
    <p className="panel-description">같은 건물·층에서 통행 불가 구간을 제외하고 가장 가까운 입구를 찾아요. 계산 후 연결 상태를 바꾸면 자동으로 다시 계산해요.</p>
    <form className="route-search" onSubmit={calculate}>
      {confirmedSource ? <div><strong>선택한 출발 장소</strong><p>{confirmedSource.building} · {confirmedSource.floor} · {confirmedSource.room}</p></div> : <div><label htmlFor={sourceInputId}>경로 출발 장소</label>
        <select id={sourceInputId} value={sourceValid ? sourceId : ''} onChange={(event) => selectSource(event.target.value)} required disabled={disabled}>
          <option value="">출발 장소 선택</option>{activePlaces.map((place) => <option key={place.id} value={place.id}>{place.building} · {place.floor} · {place.room}</option>)}
        </select></div>}
      <button type="submit" className="register-button" disabled={disabled || busy || !sourceValid}>{busy ? '경로 계산 중…' : confirmedSource ? '경로 다시 확인' : '가장 가까운 계단 찾기'}</button>
    </form>
    {activePlaces.length === 0 && <p className="connection-note">먼저 출발 장소와 비상계단 입구를 등록하고 장소 사이를 연결해 주세요.</p>}
    {error && <p className="feedback error" role="alert">{error}</p>}
    {result && <div className={`route-result ${found ? 'route-found' : 'route-missing'}`}>
      <p className="route-status" role="status">{result.message}</p>
      {result.blockedConnectionCount > 0 && <p className="route-blocked-info">이 층의 통행 불가 구간 {result.blockedConnectionCount}개 제외{result.destinationChanged && result.originalDestination && result.destination ? ` · ${result.originalDestination.room} 대신 ${result.destination.room}로 안내` : ''}</p>}
      {found && result.destination && <>
        <div className="route-summary"><div><span>도착할 비상계단 입구</span><h3>{result.destination.room}</h3><p>{result.destination.building} · {result.destination.floor}</p></div>
          <div className="route-distance"><strong>{result.totalDistanceMeters}m</strong><span>총 {result.steps.length}구간</span></div></div>
        <p className="route-chain" aria-label="전체 이동 순서">{result.places.map((place) => place.room).join(' → ')}</p>
        {result.steps.length > 0 && <ol className="route-steps">{result.steps.map((step, index) => <li key={`${step.connectionId}-${step.fromPlaceId}`}>
          <span className="route-step-number" aria-hidden="true">{index + 1}</span><div><strong>{routePlaces.get(step.fromPlaceId)?.room} → {routePlaces.get(step.toPlaceId)?.room}</strong>
            <p>{step.instruction}</p><span className="route-step-meta">{step.distanceMeters}m · {placeKindLabels[routePlaces.get(step.toPlaceId)!.kind]}</span>
            <RoutePlacePhoto key={`${step.toPlaceId}-${result.calculatedAt}`} placeId={step.toPlaceId} name={routePlaces.get(step.toPlaceId)?.room ?? '다음 장소'} /></div>
        </li>)}</ol>}
      </>}
      {!found && <p className="route-help">위의 장소 등록·이동 경로 관리에서 정보를 수정한 뒤 다시 계산해 주세요. 경로 없음은 실제 대피할 곳이 없다는 뜻이 아니에요.</p>}
      {result.status === 'found' && result.steps.length > 0 && <CameraRouteExport key={`${result.source.id}-${result.calculatedAt}`} route={result} />}
      <p className="route-calculated">계산 시각: {new Date(result.calculatedAt).toLocaleTimeString('ko-KR')}</p>
    </div>}
    <p className="connection-note">{result?.notice ?? '관리자가 등록한 연결·거리·통행 불가 상태로 계산하는 시연 기능이에요. 화재·연기·실제 통행 가능 여부를 자동 감지하지 않으며, 비상계단 입구 도착은 건물 밖 대피 완료와 달라요.'}</p>
  </section>
}
