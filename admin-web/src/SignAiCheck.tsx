import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Worker } from 'tesseract.js'
import { cameraSignMatches, normalizeSign as normalize } from './ai-sign-match'

type Result = { expected: string; text: string; matched: boolean; ms: number; source: 'camera' | 'sample'; preview: string }

function cameraSnapshot(video: HTMLVideoElement | null, box: HTMLElement | null) {
  if (!video || !box || !video.videoWidth || !video.videoHeight || video.readyState < 2 || !video.srcObject || !(video.srcObject as MediaStream).getVideoTracks().some(track => track.readyState === 'live') || document.hidden) throw new Error('카메라 영상이 준비되지 않았어요. 카메라를 다시 켜 주세요.')
  const scale = Math.max(box.clientWidth / video.videoWidth, box.clientHeight / video.videoHeight)
  const visibleW = box.clientWidth / scale, visibleH = box.clientHeight / scale
  const x = (video.videoWidth - visibleW) / 2 + visibleW * .12
  const y = (video.videoHeight - visibleH) / 2 + visibleH * .35
  const w = visibleW * .76, h = visibleH * .22
  const canvas = document.createElement('canvas')
  canvas.width = Math.min(1600, Math.max(800, Math.round(w * 2))); canvas.height = Math.max(1, Math.round(canvas.width * h / w))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('이 브라우저에서 화면을 읽을 수 없어요.')
  context.drawImage(video, x, y, w, h, 0, 0, canvas.width, canvas.height)
  return canvas
}

export default function SignAiCheck({ video, stage, live, expectedSign, onCameraMatch, onCheckStart }: { video: RefObject<HTMLVideoElement | null>; stage: RefObject<HTMLElement | null>; live: boolean; expectedSign?: string; onCameraMatch?: () => void; onCheckStart?: () => void }) {
  const [expected, setExpected] = useState(expectedSign ?? '')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const active = useRef(true)
  const running = useRef(false)
  const worker = useRef<Worker | null>(null)
  useEffect(() => { active.current = true; return () => { active.current = false; void worker.current?.terminate().catch(() => {}) } }, [])

  async function test(sample = false) {
    if (running.current || (!sample && (!live || normalize(expected).length < 2))) return
    onCheckStart?.()
    running.current = true; setBusy(true); setError(''); setResult(null); setStatus('인식할 화면 준비 중…')
    const wanted = sample ? '복도 갈림길' : expected.trim()
    let current: Worker | undefined
    const started = performance.now()
    try {
      let canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      if (!context) throw new Error('이 브라우저에서 화면을 읽을 수 없어요.')
      if (sample) {
        const response = await fetch('/ai-sample.png', { signal: AbortSignal.timeout(15000) })
        if (!response.ok) throw new Error('예제 사진을 불러오지 못했어요.')
        const bitmap = await createImageBitmap(await response.blob())
        canvas.width = 960; canvas.height = 270
        context.drawImage(bitmap, 790, 440, 320, 90, 0, 0, 960, 270)
        bitmap.close()
      } else {
        canvas = cameraSnapshot(video.current, stage.current)
      }
      const { createWorker, PSM } = await import('tesseract.js')
      if (!active.current) return
      setStatus('한국어·영어 인식 모델을 불러오는 중… 처음에는 시간이 걸려요.')
      current = await createWorker('kor+eng', 1, { workerPath: '/ocr/worker.min.js', corePath: '/ocr/core', langPath: '/ocr/lang', workerBlobURL: false,
        logger: info => { if (active.current && info.status === 'recognizing text') setStatus(`글자 인식 중… ${Math.round(info.progress * 100)}%`) },
      })
      worker.current = current
      if (!active.current) return
      await current.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE })
      if (!sample) canvas = cameraSnapshot(video.current, stage.current)
      const firstFrameTime = video.current?.currentTime
      let { data } = await current.recognize(canvas)
      let autoMatch = false
      if (!sample && active.current && cameraSignMatches(expectedSign, data.text, 'camera')) {
        setStatus('기준 표지판 재확인 중… 표지판을 계속 비춰 주세요.')
        await new Promise(resolve => setTimeout(resolve, 300))
        if (!active.current) return
        if (video.current?.currentTime === firstFrameTime) throw new Error('카메라 영상이 갱신되지 않았어요. 표지판을 다시 비추고 AI 확인을 눌러 주세요.')
        canvas = cameraSnapshot(video.current, stage.current)
        const second = await current.recognize(canvas)
        data = second.data
        autoMatch = cameraSignMatches(expectedSign, data.text, 'camera')
      }
      if (active.current) {
        setResult({ expected: wanted, text: data.text.trim(), matched: normalize(data.text) === normalize(wanted), ms: Math.round(performance.now() - started), source: sample ? 'sample' : 'camera', preview: canvas.toDataURL('image/png') })
        if (autoMatch) onCameraMatch?.()
        setStatus(autoMatch ? '기준 표지판 글자 2회 일치 · 화살표 표시 요청' : '검증 완료')
      }
    } catch (cause) { if (active.current) { setError(cause instanceof Error ? cause.message : 'AI 인식에 실패했어요. 와이파이 연결을 확인하고 다시 시험해 주세요.'); setStatus('검증 실패') } }
    finally { await current?.terminate().catch(() => {}); worker.current = null; running.current = false; if (active.current) setBusy(false) }
  }

  return <section className="camera-ai" aria-label="표지판 AI 검증"><h2>표지판 AI 검증</h2><p>확인할 이름을 입력하고, 카메라의 중앙 상자 안에 표지판 글자 한 줄을 크게 맞춰 주세요.</p>
    <label htmlFor="ai-expected">{expectedSign ? '이 구간에 등록된 기준 표지판' : '표지판에 적힌 이름'}<input id="ai-expected" value={expected} maxLength={60} readOnly={Boolean(expectedSign)} disabled={busy} onChange={e => { setExpected(e.target.value); setResult(null) }} placeholder="예: 제3강의실" /></label>
    <button type="button" className="camera-toggle" disabled={busy || !live || normalize(expected).length < 2} onClick={() => test()}>{busy ? 'AI 확인 중…' : '현재 카메라 화면 AI 확인'}</button>
    <button type="button" className="camera-secondary" disabled={busy} onClick={() => test(true)}>예제 사진으로 AI 작동 확인</button>
    {!live && <p>실제 표지판 테스트는 카메라를 켠 뒤 진행해 주세요.</p>}
    <p role="status">{status}</p>{error && <p className="camera-error" role="alert">{error}</p>}
    {result && <div className="camera-ai-result"><strong>{result.matched ? '입력한 이름과 일치' : '입력한 이름을 확인하지 못함'}</strong><p>확인할 이름: {result.expected}</p><p>읽힌 글자: {result.text || '(읽힌 글자 없음)'}</p><p>총 소요 시간: {(result.ms / 1000).toFixed(1)}초 · 모델 준비 포함</p><p>{result.source === 'sample' ? '생성된 예제 사진의 미리 지정한 표지판 부분을 사용했어요. 실제 카메라 검증 결과가 아니에요.' : '버튼을 누른 순간의 중앙 영역 한 장을 인식했어요. 연속 영상 검증 결과가 아니에요.'}</p><img src={result.preview} alt="AI가 실제로 읽은 표지판 영역" /></div>}
    <p className="camera-note">{expectedSign ? '실제 카메라에서 등록된 기준 표지판 글자가 2회 일치하면 체크 없이 화살표를 표시하는 시험 기능이에요. 예제 사진은 작동 조건에서 제외해요. ' : ''}글자 일치는 현재 장소나 휴대폰 방향을 측정한 결과가 아니에요.</p>
  </section>
}
