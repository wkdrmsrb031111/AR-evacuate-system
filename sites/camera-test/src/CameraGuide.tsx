import { useEffect, useRef, useState } from 'react'
import './CameraGuide.css'
import { parseCameraRoute } from './camera-route'
import type { CameraRoute } from './camera-route'
import SignAiCheck from './SignAiCheck'

const directions = [
  { id: 'left', label: '왼쪽', path: 'M132 180V110H53M53 110L86 77M53 110L86 143' },
  { id: 'straight', label: '직진', path: 'M100 185V55M100 55L56 99M100 55L144 99' },
  { id: 'right', label: '오른쪽', path: 'M68 180V110H147M147 110L114 77M147 110L114 143' },
] as const

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
  const loadVersion = useRef(0)
  const step = route?.steps[stepIndex]
  const complete = Boolean(route && stepIndex >= route.steps.length)
  const selected = directions.find(item => item.id === (step?.direction ?? direction))!
  const effectiveAligned = aligned || Boolean(step?.facingSignText && aiMatched && state === 'live')
  const showArrow = !route || Boolean(step && effectiveAligned)
  const cameraSession = generation.current
  const alignmentSession = alignmentVersion.current

  function resetAlignment() { alignmentVersion.current++; setAligned(false); setAiMatched(false) }

  async function loadRoute(file?: File) {
    const version = ++loadVersion.current
    setRoute(null); resetAlignment(); setStepIndex(0); setRouteError(''); setLoadingRoute(true)
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

  function stopCamera() {
    generation.current++
    resetAlignment()
    starting.current = false
    stream.current?.getTracks().forEach(track => { track.onended = null; track.stop() })
    stream.current = null
    if (video.current) video.current.srcObject = null
    setState('off')
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
    <header className="camera-header"><div><span>AR Evacuate · 총알받이</span><h1>카메라 경로 안내</h1></div><span className="camera-badge">{route ? route.demo ? '가상 경로 시연' : '가져온 경로 안내' : '화살표 미리보기'}</span></header>
    <section className="camera-route-picker" aria-label="안내 경로 선택"><label htmlFor="camera-route-file">관리자 웹에서 저장한 안내 파일 가져오기</label><input id="camera-route-file" type="file" accept=".json,application/json" onChange={e => { const file = e.target.files?.[0]; if (file) void loadRoute(file); e.target.value = '' }} /><button type="button" className="camera-secondary" disabled={loadingRoute} onClick={() => loadRoute()}>가상 회사 예제로 시작</button>{loadingRoute && <p role="status">경로를 불러오는 중…</p>}{routeError && <p className="camera-error" role="alert">{routeError}</p>}</section>
    {route && <section className="camera-route-info" aria-label="현재 안내 경로"><strong>{route.building} · {route.floor}</strong><p>{route.source.room} → {route.destination.room} · 총 {route.totalDistanceMeters}m</p><p>경로 계산: {new Date(route.calculatedAt).toLocaleString('ko-KR')}</p><p>가져온 파일 기준 · 통행 상태 실시간 갱신 아님</p></section>}
    <section ref={stage} className="camera-stage" aria-label="카메라와 방향 화살표">
      <video ref={video} autoPlay playsInline muted aria-label="휴대폰 카메라 실시간 영상" />
      {state === 'live' && <div className="camera-ai-region" aria-hidden="true"><span>AI로 읽을 표지판 영역</span></div>}
      <div className="camera-status" role="status">{state === 'live' ? '카메라 켜짐' : state === 'starting' ? '카메라 연결 중…' : '카메라 꺼짐 · 화살표 미리보기'}</div>
      {state !== 'live' && <p className="camera-placeholder">{state === 'starting' ? '카메라 권한 요청을 확인해 주세요.' : '카메라를 켜면 이곳에 실제 주변 모습이 보여요.'}</p>}
      {showArrow && <div className={`camera-arrow arrow-${selected.id}`} role="img" aria-label={`${selected.label} 방향 화살표`}><svg viewBox="0 0 200 240" aria-hidden="true"><path className="arrow-shadow" d={selected.path} /><path className="arrow-outline" d={selected.path} /><path className="arrow-body" d={selected.path} /></svg></div>}
      <div className="camera-direction" aria-live="polite"><span>{complete ? '사용자가 도착을 확인했어요' : step ? `${stepIndex + 1}/${route!.steps.length} 구간 · 다음 장소: ${step.toName}` : '선택한 화살표 모양'}</span><strong>{complete ? '비상계단 입구 도착' : step && !effectiveAligned ? '바라볼 기준을 확인하세요' : selected.label}</strong>{aiMatched && effectiveAligned && <span>AI 기준 표지판 일치 · 방향 측정 아님</span>}</div>
    </section>
    <section className="camera-controls" aria-label="카메라 테스트 조작">
      <button type="button" className="camera-toggle" onClick={state === 'off' ? startCamera : stopCamera}>{state === 'live' ? '카메라 끄기' : state === 'starting' ? '연결 취소' : '카메라 켜기'}</button>
      {error && <p className="camera-error" role="alert">{error}</p>}
      <SignAiCheck key={`${route?.calculatedAt ?? ''}-${route?.source.id ?? ''}-${stepIndex}-${cameraSession}`} video={video} stage={stage} live={state === 'live'} expectedSign={step?.facingSignText} onCheckStart={() => setAiMatched(false)} onCameraMatch={() => { if (step?.facingSignText && generation.current === cameraSession && alignmentVersion.current === alignmentSession && stream.current?.getVideoTracks().some(track => track.readyState === 'live')) setAiMatched(true) }} />
      {step && <section className="camera-step" aria-label="현재 구간 안내"><h2>{step.toName}까지 {step.distanceMeters}m</h2><p>{step.instruction}</p><div className="camera-facing"><strong>출발점에서 바라볼 기준</strong><p>{step.facingHint}</p>{step.facingSignText ? <p>AI 기준 표지판: <strong>{step.facingSignText}</strong> · 카메라로 비추고 위의 AI 확인 버튼을 눌러 주세요. 이름이 2회 일치하면 수동 체크 없이 화살표가 나와요.</p> : <p>AI 기준 표지판이 등록되지 않아 수동 확인을 사용해요. 관리자 웹에서 기준 표지판 이름을 넣은 새 안내 파일을 가져오세요.</p>}<label><input type="checkbox" checked={aligned} onChange={e => { alignmentVersion.current++; setAligned(e.target.checked); setAiMatched(false) }} />기준 방향을 바라보고 있어요 (수동 확인)</label></div><button type="button" className="camera-toggle" disabled={!effectiveAligned} onClick={() => { setStepIndex(i => i + 1); resetAlignment() }}>{step.toName} 도착 확인</button><p>자동 도착 감지는 없어요. 해당 장소에 도착한 뒤 눌러 주세요.</p></section>}
      {complete && <p className="camera-note" role="status">비상계단 입구까지의 안내가 끝났어요. 건물 밖 대피 완료를 뜻하지 않아요.</p>}
      {!route && <fieldset><legend>화살표 모양 미리보기</legend><div className="camera-direction-buttons">{directions.map(item => <button key={item.id} type="button" aria-pressed={direction === item.id} onClick={() => setDirection(item.id)}>{item.label}</button>)}</div></fieldset>}
      {route && <button type="button" className="camera-secondary" onClick={() => { setStepIndex(0); resetAlignment() }}>같은 경로 처음부터 보기</button>}
      <p className="camera-note">{route?.demo ? '가상 회사 예제의 방향은 시연용으로 지정했어요. 지금 있는 건물에서 따라 걷지 마세요. ' : ''}화살표는 등록된 기준 방향에 따른 화면 안내예요. 위치와 휴대폰 방향을 자동 추적하거나 복도 바닥에 고정하지 않아요.</p>
      <p className="camera-privacy">영상은 화면에만 표시하며 저장하거나 서버로 전송하지 않아요. 다른 앱으로 이동하면 카메라가 꺼져요.</p>
    </section>
  </main>
}
