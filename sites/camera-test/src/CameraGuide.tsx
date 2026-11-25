import { useCallback, useEffect, useRef, useState } from 'react'
import './CameraGuide.css'
import { cameraRouteFromNearest, parseCameraRoute } from './camera-route'
import type { CameraRoute } from './camera-route'
import SignAiCheck from './SignAiCheck'

const directions = [
  { id: 'left', label: '왼쪽', path: 'M132 180V110H53M53 110L86 77M53 110L86 143' },
  { id: 'straight', label: '직진', path: 'M100 185V55M100 55L56 99M100 55L144 99' },
  { id: 'right', label: '오른쪽', path: 'M68 180V110H147M147 110L114 77M147 110L114 143' },
] as const

type AppPlace = { id: string; building: string; floor: string; room: string; kind: string }

export default function CameraGuide() {
  const [direction, setDirection] = useState<typeof directions[number]['id']>('straight')
  const [state, setState] = useState<'off' | 'starting' | 'live'>('off')
  const [error, setError] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  const stage = useRef<HTMLElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const generation = useRef(0)
  const starting = useRef(false)
  const [route, setRoute] = useState<CameraRoute | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [aligned, setAligned] = useState(false)
  const [aiMatched, setAiMatched] = useState(false)
  const alignmentVersion = useRef(0)
  const [routeError, setRouteError] = useState('')
  const [loadingRoute, setLoadingRoute] = useState(false)
  const [showRouteChange, setShowRouteChange] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showDisplay, setShowDisplay] = useState(false)
  const [largeText, setLargeText] = useState(() => { try { return localStorage.getItem('ar-evacuate-large-text') === '1' } catch { return false } })
  const [highContrast, setHighContrast] = useState(() => { try { return localStorage.getItem('ar-evacuate-high-contrast') === '1' } catch { return false } })
  const [voiceGuide, setVoiceGuide] = useState(() => { try { return localStorage.getItem('ar-evacuate-voice-guide') !== '0' } catch { return true } })
  const [vibrationGuide, setVibrationGuide] = useState(() => { try { return localStorage.getItem('ar-evacuate-vibration-guide') !== '0' } catch { return true } })
  const [voiceError, setVoiceError] = useState('')
  const [serverPlaces, setServerPlaces] = useState<AppPlace[]>([])
  const [selectedPlaceId, setSelectedPlaceId] = useState('')
  const [loadingPlaces, setLoadingPlaces] = useState(false)
  const lastSpokenKey = useRef('')
  const loadVersion = useRef(0)
  const step = route?.steps[stepIndex]
  const complete = Boolean(route && stepIndex >= route.steps.length)
  const selected = directions.find(item => item.id === (step?.direction ?? direction))!
  const effectiveAligned = aligned || Boolean(step?.facingSignText && aiMatched && state === 'live')
  const phase = complete ? 'complete' : state !== 'live' ? 'camera' : !effectiveAligned ? 'sign' : 'move'
  const cameraErrorTitle = error.includes('권한') ? '카메라 권한이 필요합니다' : error.includes('찾지 못') ? '카메라를 찾지 못했습니다' : error.includes('접속 주소') ? '안전한 접속 주소가 필요합니다' : '카메라를 시작하지 못했습니다'
  const showArrow = !route || Boolean(step && effectiveAligned)
  const cameraSession = generation.current
  const alignmentSession = alignmentVersion.current
  const voiceInstruction = complete
    ? '비상계단 입구 안내가 끝났습니다. 계단을 이용해 건물 밖 안전한 장소까지 계속 대피하세요.'
    : step && effectiveAligned
      ? `${selected.label} 방향으로 ${step.distanceMeters}미터 이동하세요. ${step.instruction}`
      : ''

  const speakGuidance = useCallback((text = voiceInstruction, vibrate = true) => {
    if (!text) return
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      setVoiceError('이 브라우저에서는 음성 안내를 사용할 수 없습니다.')
      return
    }
    setVoiceError('')
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'ko-KR'
    utterance.rate = 0.92
    utterance.pitch = 1
    window.speechSynthesis.speak(utterance)
    if (vibrate && vibrationGuide && 'vibrate' in navigator) navigator.vibrate([180, 90, 180])
  }, [voiceInstruction, vibrationGuide])

  function resetAlignment() { alignmentVersion.current++; setAligned(false); setAiMatched(false) }

  async function loadRoute(file?: File) {
    const version = ++loadVersion.current
    setRoute(null); resetAlignment(); setStepIndex(0); setRouteError(''); setShowRouteChange(false); setLoadingRoute(true)
    try {
      if (file && file.size > 256 * 1024) throw new Error('안내 파일은 256KB 이하로 선택해 주세요.')
      let data: unknown
      if (file) data = JSON.parse(await file.text())
      else {
        const response = await fetch('./camera-route-demo.json', { cache: 'no-store', signal: AbortSignal.timeout(15000) })
        if (!response.ok) throw new Error('예제 경로를 불러오지 못했어요.')
        data = await response.json()
      }
      const parsed = parseCameraRoute(data)
      if (version === loadVersion.current) setRoute(parsed)
    } catch (cause) {
      if (version === loadVersion.current) setRouteError(cause instanceof SyntaxError ? 'JSON 안내 파일을 읽지 못했어요.' : cause instanceof Error ? cause.message : '안내 파일을 불러오지 못했어요.')
    } finally { if (version === loadVersion.current) setLoadingRoute(false) }
  }

  async function loadServerPlaces() {
    setLoadingPlaces(true); setRouteError('')
    try {
      const response = await fetch('/api/app/places', { cache: 'no-store', signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error('관리자 서버에서 장소 목록을 불러오지 못했어요.')
      const data = await response.json() as { places?: AppPlace[] }
      const places = Array.isArray(data.places) ? data.places.filter(place => place.kind !== 'stairs' && place.kind !== 'exit') : []
      setServerPlaces(places)
      setSelectedPlaceId(current => places.some(place => place.id === current) ? current : places[0]?.id ?? '')
      if (places.length === 0) setRouteError('선택할 수 있는 일반 장소가 없어요. 관리자 웹에서 장소를 등록해 주세요.')
    } catch (cause) {
      setRouteError(cause instanceof Error ? `${cause.message} 로컬 관리자 웹에서 열거나 아래 예제 경로를 사용해 주세요.` : '장소 목록을 불러오지 못했어요.')
    } finally { setLoadingPlaces(false) }
  }

  async function loadRouteFromServer() {
    if (!selectedPlaceId) return
    const version = ++loadVersion.current
    setRoute(null); resetAlignment(); setStepIndex(0); setRouteError(''); setLoadingRoute(true)
    try {
      const response = await fetch(`/api/app/routes/nearest-stairs?sourceId=${encodeURIComponent(selectedPlaceId)}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : '서버에서 대피 경로를 계산하지 못했어요.')
      const parsed = cameraRouteFromNearest(data)
      if (version === loadVersion.current) setRoute(parsed)
    } catch (cause) {
      if (version === loadVersion.current) setRouteError(cause instanceof Error ? cause.message : '서버 경로를 불러오지 못했어요.')
    } finally { if (version === loadVersion.current) setLoadingRoute(false) }
  }

  function stopCamera() {
    generation.current++
    resetAlignment()
    starting.current = false
    stream.current?.getTracks().forEach(track => { track.onended = null; track.stop() })
    stream.current = null
    if (video.current) video.current.srcObject = null
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    setState('off')
  }

  function chooseAnotherRoute() {
    loadVersion.current++
    stopCamera()
    setRoute(null)
    setStepIndex(0)
    setRouteError('')
    setLoadingRoute(false)
    setShowRouteChange(false)
  }

  useEffect(() => {
    const onVisibility = () => { if (document.hidden) stopCamera() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', stopCamera)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', stopCamera)
      generation.current++
      loadVersion.current++
      stream.current?.getTracks().forEach(track => { track.onended = null; track.stop() })
    }
  }, [])

  useEffect(() => {
    if (!showHelp && !showDisplay) return
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setShowHelp(false); setShowDisplay(false) } }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', closeOnEscape) }
  }, [showHelp, showDisplay])

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('camera-large-text', largeText)
    root.classList.toggle('camera-high-contrast', highContrast)
    try {
      localStorage.setItem('ar-evacuate-large-text', largeText ? '1' : '0')
      localStorage.setItem('ar-evacuate-high-contrast', highContrast ? '1' : '0')
      localStorage.setItem('ar-evacuate-voice-guide', voiceGuide ? '1' : '0')
      localStorage.setItem('ar-evacuate-vibration-guide', vibrationGuide ? '1' : '0')
    } catch { /* 설정 저장을 지원하지 않는 브라우저에서는 현재 화면에만 적용 */ }
    return () => { root.classList.remove('camera-large-text', 'camera-high-contrast') }
  }, [largeText, highContrast, voiceGuide, vibrationGuide])

  useEffect(() => {
    if (!voiceGuide || !voiceInstruction || (!complete && state !== 'live')) return
    const key = complete ? `complete-${route?.calculatedAt ?? ''}` : `${route?.calculatedAt ?? ''}-${stepIndex}-${voiceInstruction}`
    if (lastSpokenKey.current === key) return
    lastSpokenKey.current = key
    speakGuidance(voiceInstruction)
  }, [voiceGuide, voiceInstruction, complete, state, route?.calculatedAt, stepIndex, speakGuidance])

  async function startCamera() {
    if (starting.current || stream.current) return
    setError('')
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('카메라를 사용할 수 없는 접속 주소예요. USB 연결용 localhost 주소 또는 HTTPS 주소로 열어 주세요.')
      return
    }
    starting.current = true
    resetAlignment()
    const version = ++generation.current
    setState('starting')
    let opened: MediaStream | undefined
    try {
      opened = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      if (version !== generation.current || document.hidden || !video.current) { opened.getTracks().forEach(track => track.stop()); return }
      stream.current = opened
      video.current.srcObject = opened
      opened.getVideoTracks().forEach(track => { track.onended = () => { if (version === generation.current) { stopCamera(); setError('카메라 연결이 종료됐어요. 다시 켜 주세요.') } } })
      await video.current.play()
      if (version === generation.current) setState('live')
    } catch (cause) {
      opened?.getTracks().forEach(track => track.stop())
      if (version !== generation.current) return
      stream.current = null
      if (video.current) video.current.srcObject = null
      setState('off')
      const name = cause instanceof DOMException ? cause.name : ''
      setError(name === 'NotAllowedError' ? '카메라 권한이 허용되지 않았어요. 주소창의 사이트 설정에서 카메라를 허용한 뒤 다시 켜 주세요.' : name === 'NotFoundError' ? '사용할 카메라를 찾지 못했어요. 카메라가 있는 휴대폰에서 열어 주세요.' : '카메라를 열지 못했어요. 다른 카메라 앱을 닫고 다시 시도해 주세요.')
    } finally {
      if (version === generation.current) starting.current = false
    }
  }

  return <main className="camera-guide">
    <header className="camera-header"><div><span>AR EVACUATE</span><h1>대피 길 안내</h1></div><div className="camera-header-actions"><span className="camera-badge">{complete ? '안내 완료' : route ? `${Math.min(stepIndex + 1, route.steps.length)}/${route.steps.length} 구간` : '준비'}</span><div className="camera-header-tools"><button type="button" onClick={() => { setShowDisplay(false); setShowHelp(true) }}>사용 방법</button><button type="button" onClick={() => { setShowHelp(false); setShowDisplay(true) }}>보기 설정</button></div></div></header>
    {!route && <section className="camera-start" aria-label="안내 시작">
      <p className="camera-eyebrow">현재 위치 선택</p><h2>어디에 계신가요?</h2><p>등록된 장소를 선택하면 가장 가까운 비상계단까지 계산합니다.</p>
      <button type="button" className="camera-help-link" onClick={() => setShowHelp(true)}>처음 사용하시나요? 30초 사용법 보기</button>
      {serverPlaces.length === 0 ? <button type="button" className="camera-primary" disabled={loadingPlaces} onClick={loadServerPlaces}>{loadingPlaces ? '장소 불러오는 중…' : '등록된 장소 불러오기'}</button> : <div className="camera-live-start"><label htmlFor="camera-current-place">현재 장소</label><select id="camera-current-place" value={selectedPlaceId} onChange={event => setSelectedPlaceId(event.target.value)}>{serverPlaces.map(place => <option key={place.id} value={place.id}>{place.building} · {place.floor} · {place.room}</option>)}</select><button type="button" className="camera-primary" disabled={loadingRoute || !selectedPlaceId} onClick={loadRouteFromServer}>{loadingRoute ? '안전 경로 계산 중…' : '가장 가까운 비상계단 안내 시작'}</button></div>}
      <div className="camera-or"><span>시연·연결 오류 시</span></div>
      <button type="button" className="camera-secondary" disabled={loadingRoute} onClick={() => loadRoute()}>{loadingRoute ? '경로 준비 중…' : '가상 회사 예제로 시작'}</button>
      <div className="camera-file"><span>또는 저장한 관리자 경로 사용</span><label htmlFor="camera-route-file">경로 파일 선택</label><input id="camera-route-file" className="sr-only" type="file" accept=".json,application/json" onChange={e => { const file = e.target.files?.[0]; if (file) void loadRoute(file); e.target.value = '' }} /></div>
      {routeError && <section className="camera-error-card" role="alert"><span className="error-symbol">!</span><div><strong>대피 경로를 준비하지 못했습니다</strong><p>{routeError}</p><button type="button" className="error-action" onClick={() => { setRouteError(''); void loadServerPlaces() }}>다시 불러오기</button></div></section>}
    </section>}
    {route && <section className="camera-route-bar" aria-label="현재 안내 경로"><div><span>{route.building} · {route.floor}</span><strong>{complete ? '비상계단 입구에 도착했습니다' : `${step?.toName ?? route.destination.room}까지 ${step?.distanceMeters ?? 0}m`}</strong></div><div className="route-actions"><span className="route-distance">총 {route.totalDistanceMeters}m</span><button type="button" onClick={() => setShowRouteChange(true)}>경로 변경</button></div></section>}
    {route && showRouteChange && <section className="route-change-confirm" role="alert"><strong>현재 안내를 중단하고 경로를 변경할까요?</strong><p>진행 중인 구간은 초기화되고 시작 화면으로 돌아갑니다.</p><div><button type="button" className="camera-secondary" onClick={() => setShowRouteChange(false)}>계속 안내받기</button><button type="button" className="camera-danger" onClick={chooseAnotherRoute}>경로 다시 선택</button></div></section>}
    {route && <ol className="camera-flow" aria-label="안내 진행 단계"><li className={phase === 'camera' ? 'is-active' : 'is-done'}><span>1</span>카메라</li><li className={phase === 'sign' ? 'is-active' : phase === 'move' || phase === 'complete' ? 'is-done' : ''}><span>2</span>표지판</li><li className={phase === 'move' ? 'is-active' : phase === 'complete' ? 'is-done' : ''}><span>3</span>이동</li></ol>}
    <section ref={stage} className="camera-stage" aria-label="카메라와 방향 화살표">
      <video ref={video} autoPlay playsInline muted aria-label="휴대폰 카메라 실시간 영상" />
      {state === 'live' && <div className="camera-ai-region" aria-hidden="true"><span>AI로 읽을 표지판 영역</span></div>}
      <div className={`camera-status status-${state}`} role="status">{state === 'live' ? '● 카메라 작동 중' : state === 'starting' ? '카메라 연결 중…' : '카메라를 켜 주세요'}</div>
      {state !== 'live' && <p className="camera-placeholder">{state === 'starting' ? '카메라 권한 요청을 확인해 주세요.' : '카메라를 켜면 이곳에 실제 주변 모습이 보여요.'}</p>}
      {showArrow && <div className={`camera-arrow arrow-${selected.id}`} role="img" aria-label={`${selected.label} 방향 화살표`}><svg viewBox="0 0 200 240" aria-hidden="true"><path className="arrow-shadow" d={selected.path} /><path className="arrow-outline" d={selected.path} /><path className="arrow-body" d={selected.path} /></svg></div>}
      <div className="camera-direction" aria-live="polite"><span>{complete ? '경로 안내가 끝났습니다' : step && !effectiveAligned ? `화면 중앙에 ‘${step.facingSignText ?? step.toName}’ 표지판을 맞추세요` : '이 방향으로 이동하세요'}</span><strong>{complete ? '안내 완료' : step && !effectiveAligned ? '표지판 확인 필요' : selected.label}</strong>{aiMatched && effectiveAligned && <span>AI가 기준 표지판을 확인했습니다</span>}</div>
    </section>
    <section className="camera-controls" aria-label="카메라 테스트 조작">
      {!complete && state !== 'live' && <button type="button" className="camera-toggle" onClick={state === 'off' ? startCamera : stopCamera}>{state === 'starting' ? '연결 취소' : '카메라 켜고 안내 시작'}</button>}
      {!complete && state === 'live' && <button type="button" className="camera-stop-link" onClick={stopCamera}>카메라 끄기</button>}
      {error && <section className="camera-error-card" role="alert"><span className="error-symbol">!</span><div><strong>{cameraErrorTitle}</strong><p>{error}</p><button type="button" className="error-action" onClick={startCamera}>다시 시도</button></div></section>}
      {step && state === 'live' && !effectiveAligned && <SignAiCheck key={`${route?.calculatedAt ?? ''}-${route?.source.id ?? ''}-${stepIndex}-${cameraSession}`} video={video} stage={stage} live expectedSign={step.facingSignText} onCheckStart={() => setAiMatched(false)} onCameraMatch={() => { if (step.facingSignText && generation.current === cameraSession && alignmentVersion.current === alignmentSession && stream.current?.getVideoTracks().some(track => track.readyState === 'live')) setAiMatched(true) }} />}
      {step && <section className="camera-step" aria-label="현재 구간 안내"><div className="step-title"><span>다음 목적지</span><h2>{step.toName}</h2><strong>{step.distanceMeters}m</strong></div><p className="step-instruction">{step.instruction}</p>{effectiveAligned && <div className="guidance-actions">{voiceGuide && <button type="button" className="camera-listen" onClick={() => speakGuidance()}>🔊 안내 다시 듣기</button>}<button type="button" className="camera-arrival" onClick={() => { const isLast = stepIndex + 1 >= route!.steps.length; setStepIndex(i => i + 1); if (isLast) stopCamera(); else resetAlignment() }}>{step.toName}에 도착했습니다</button></div>}{voiceError && <p className="voice-error" role="alert">{voiceError}</p>}{state === 'live' && !effectiveAligned && <details className="camera-fallback"><summary>AI 인식이 안 될 때</summary><p>{step.facingHint}</p><label><input type="checkbox" checked={aligned} onChange={e => { alignmentVersion.current++; setAligned(e.target.checked); setAiMatched(false) }} />기준 방향을 직접 확인했습니다</label></details>}</section>}
      {complete && <section className="camera-complete" role="status"><span>✓</span><h2>비상계단 입구 안내 완료</h2><p>계단을 이용해 건물 밖 안전한 장소까지 계속 대피하세요.</p></section>}
      {!route && <fieldset><legend>화살표 모양 미리보기</legend><div className="camera-direction-buttons">{directions.map(item => <button key={item.id} type="button" aria-pressed={direction === item.id} onClick={() => setDirection(item.id)}>{item.label}</button>)}</div></fieldset>}
      {route && <details className="camera-more"><summary>경로 정보와 다시 시작</summary><p>{route.source.room} → {route.destination.room} · {new Date(route.calculatedAt).toLocaleString('ko-KR')}</p><p>가져온 파일 기준이며 통행 상태가 실시간으로 갱신되지는 않습니다.</p>{stepIndex > 0 && !complete && <button type="button" className="camera-secondary" onClick={() => { setStepIndex(i => Math.max(0, i - 1)); resetAlignment() }}>이전 구간으로 돌아가기</button>}<button type="button" className="camera-secondary" onClick={() => { setStepIndex(0); resetAlignment() }}>같은 경로 처음부터 보기</button></details>}
      <details className="camera-more"><summary>시제품 안내 및 개인정보</summary><p>{route?.demo ? '가상 회사 예제 방향은 기능 시연용입니다. 현재 건물에서 따라 걷지 마세요. ' : ''}화살표는 등록된 기준 방향에 따른 화면 안내입니다. 현재 위치와 휴대폰 방향을 자동으로 측정하지 않습니다.</p><p>영상은 화면에만 표시하며 저장하거나 서버로 전송하지 않습니다.</p></details>
    </section>
    {showHelp && <div className="help-backdrop"><section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title"><div className="help-dialog-header"><div><span>30초 사용 안내</span><h2 id="help-title">이렇게 사용해 주세요</h2></div><button type="button" aria-label="사용 안내 닫기" onClick={() => setShowHelp(false)}>닫기</button></div><ol><li><span>1</span><div><strong>현재 장소의 경로를 선택해요</strong><p>시연에서는 예제 경로를 누르거나 관리자가 만든 경로 파일을 선택합니다.</p></div></li><li><span>2</span><div><strong>카메라로 표지판을 비춰요</strong><p>화면의 노란 상자 안에 안내된 표지판 글자가 크게 보이도록 맞춥니다.</p></div></li><li><span>3</span><div><strong>화살표를 따라 이동해요</strong><p>장소에 도착한 뒤 도착 버튼을 누르면 다음 구간 안내가 시작됩니다.</p></div></li></ol><p className="help-warning">위급한 상황에서는 현장 안내방송과 안전요원의 지시를 우선해 주세요.</p><button type="button" className="camera-primary" autoFocus onClick={() => setShowHelp(false)}>확인했습니다</button></section></div>}
    {showDisplay && <div className="help-backdrop"><section className="help-dialog display-dialog" role="dialog" aria-modal="true" aria-labelledby="display-title"><div className="help-dialog-header"><div><span>접근성 설정</span><h2 id="display-title">안내 방식을 바꾸기</h2></div><button type="button" aria-label="보기 설정 닫기" onClick={() => setShowDisplay(false)}>닫기</button></div><div className="display-options"><label className="display-row"><span><strong>큰 글씨</strong><small>주요 안내와 버튼 글자를 더 크게 표시합니다.</small></span><input type="checkbox" role="switch" checked={largeText} onChange={event => setLargeText(event.target.checked)} /></label><label className="display-row"><span><strong>고대비 화면</strong><small>검은 배경과 노란 버튼으로 구분을 선명하게 합니다.</small></span><input type="checkbox" role="switch" checked={highContrast} onChange={event => setHighContrast(event.target.checked)} /></label><label className="display-row"><span><strong>음성 안내</strong><small>이동 방향과 거리를 한국어 음성으로 읽어줍니다.</small></span><input type="checkbox" role="switch" checked={voiceGuide} onChange={event => { setVoiceGuide(event.target.checked); setVoiceError(''); if (!event.target.checked && 'speechSynthesis' in window) window.speechSynthesis.cancel() }} /></label><label className="display-row"><span><strong>진동 안내</strong><small>새 이동 방향이 준비되면 짧게 진동합니다.</small></span><input type="checkbox" role="switch" checked={vibrationGuide} onChange={event => setVibrationGuide(event.target.checked)} /></label></div><p className="display-preview">현재 설정은 이 휴대폰에 저장됩니다.</p><button type="button" className="camera-secondary" onClick={() => { setLargeText(false); setHighContrast(false); setVoiceGuide(true); setVibrationGuide(true); setVoiceError('') }}>기본 설정으로 되돌리기</button><button type="button" className="camera-primary" autoFocus onClick={() => setShowDisplay(false)}>적용 완료</button></section></div>}
  </main>
}
