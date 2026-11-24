import { useState } from 'react'
import type { NearestStairsRoute } from './types'
import { parseCameraRoute } from './camera-route'
import type { ArrowDirection } from './camera-route'

export default function CameraRouteExport({ route }: { route: NearestStairsRoute }) {
  const [guidance, setGuidance] = useState(() => route.steps.map(() => ({ direction: '' as ArrowDirection | '', facingHint: '', facingSignText: '' })))
  const [message, setMessage] = useState('')
  const names = new Map(route.places.map(p => [p.id, p.room]))
  const ready = guidance.every(g => g.direction && g.facingHint.trim() && (!g.facingSignText.trim() || g.facingSignText.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').length >= 2))
  function save() {
    if (!ready || !route.destination) return
    const data = parseCameraRoute({ kind: 'evacuation-camera-route', schemaVersion: 1, calculatedAt: route.calculatedAt, building: route.source.building, floor: route.source.floor, source: { id: route.source.id, room: route.source.room }, destination: { id: route.destination.id, room: route.destination.room }, totalDistanceMeters: route.totalDistanceMeters, demo: route.source.building.startsWith('[테스트]'), steps: route.steps.map((s, i) => ({ ...s, toName: names.get(s.toPlaceId), direction: guidance[i].direction, facingHint: guidance[i].facingHint.trim(), ...(guidance[i].facingSignText.trim() ? { facingSignText: guidance[i].facingSignText.trim() } : {}) })) })
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'camera-route.json'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    setMessage('안내 파일을 저장했어요. 휴대폰으로 옮긴 뒤 카메라 화면의 ‘안내 파일 가져오기’에서 선택하세요.')
  }
  return <details className="camera-export"><summary>카메라 안내 파일 만들기</summary><p>각 구간의 출발점에서 바라볼 기준과 이동 방향을 등록하세요. 휴대폰은 바라보는 방향을 자동 확인하지 않아요.</p>
    {route.steps.map((s, i) => <fieldset key={`${s.fromPlaceId}-${s.toPlaceId}`}><legend>{i + 1}. {names.get(s.fromPlaceId)} → {names.get(s.toPlaceId)}</legend><label>출발점에서 바라볼 기준<input value={guidance[i].facingHint} maxLength={200} placeholder="예: 회의실 안에서 출입문을 정면으로 보세요." onChange={e => { setGuidance(items => items.map((g, n) => n === i ? { ...g, facingHint: e.target.value } : g)); setMessage('') }} /></label><label>기준을 바라봤을 때 이동 방향<select value={guidance[i].direction} onChange={e => { setGuidance(items => items.map((g, n) => n === i ? { ...g, direction: e.target.value as ArrowDirection } : g)); setMessage('') }}><option value="">방향 선택</option><option value="straight">직진</option><option value="left">왼쪽</option><option value="right">오른쪽</option></select></label></fieldset>)}
    <h3>AI 표지판 일치로 화살표 표시 (선택)</h3><p>각 구간의 바라볼 기준에 해당하는 표지판 글자를 등록하세요. 그 표지판을 정면으로 봤을 때 위 이동 방향이 맞는지 현장에서 확인해야 해요. 두 글자 이상, 같은 건물에서 구별되는 이름을 사용하세요.</p>{route.steps.map((s, i) => <label key={s.connectionId}>{i + 1}구간 기준 표지판 글자<input value={guidance[i].facingSignText} maxLength={60} placeholder="예: 제3회의실" onChange={e => { setGuidance(items => items.map((g, n) => n === i ? { ...g, facingSignText: e.target.value } : g)); setMessage('') }} /></label>)}
    <p className="input-hint">계산 시점의 경로만 담아요. 통행 상태가 바뀌면 다시 계산하고 새 파일을 가져와야 해요.</p><button type="button" className="register-button" disabled={!ready} onClick={save}>카메라 안내 파일 저장</button>{message && <p role="status">{message}</p>}
  </details>
}
