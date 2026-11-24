import { useEffect, useRef, useState } from 'react'
import type { Worker } from 'tesseract.js'
import type { Place } from './types'
import RoutePreview from './RoutePreview'
import './OcrTest.css'

const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

export default function OcrTest({ places, disabled, connectionRevision }: { places: Place[]; disabled: boolean; connectionRevision: number }) {
  const [selectedId, setSelectedId] = useState('')
  const [image, setImage] = useState<Blob | null>(null)
  const [preview, setPreview] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [area, setArea] = useState('')
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 100, h: 100 })
  const worker = useRef<Worker | null>(null)
  const alive = useRef(true)
  const running = useRef(false)
  const areas = [...new Set(places.filter(p => !p.deletedAt).map(p => JSON.stringify([p.building, p.floor])))]
  const candidates = area && text ? places.filter(p => !p.deletedAt && JSON.stringify([p.building, p.floor]) === area && normalize(p.room).length >= 2 && (normalize(text).includes(normalize(p.room)) || p.room.split(/\s+/).some(word => normalize(word).length >= 2 && normalize(text).includes(normalize(word))))) : []

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; void worker.current?.terminate() }
  }, [])
  useEffect(() => {
    if (!image) { setPreview(''); return }
    const url = URL.createObjectURL(image)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [image])

  function selectPhoto(file?: File) {
    if (!file || running.current) return
    setError(''); setText(''); setSelectedId('')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) {
      setImage(null); setError('15MB 이하 JPG, PNG, WebP 사진을 선택해 주세요.'); return
    }
    setImage(file); setCrop({ x: 0, y: 0, w: 100, h: 100 })
  }

  async function recognize() {
    if (!image || running.current) return
    running.current = true; setBusy(true); setText(''); setSelectedId(''); setError(''); setProgress(0)
    let current: Worker | undefined
    try {
      const { createWorker, PSM } = await import('tesseract.js')
      current = await createWorker('kor+eng', 1, {
        workerPath: '/ocr/worker.min.js', corePath: '/ocr/core', langPath: '/ocr/lang',
        workerBlobURL: false,
        logger: message => { if (alive.current && message.status === 'recognizing text') setProgress(Math.round(message.progress * 100)) },
      })
      worker.current = current
      if (!alive.current) return
      const bitmap = await createImageBitmap(image)
      const rectangle = { left: Math.floor(bitmap.width * crop.x / 100), top: Math.floor(bitmap.height * crop.y / 100), width: Math.max(1, Math.floor(bitmap.width * Math.min(crop.w, 100 - crop.x) / 100)), height: Math.max(1, Math.floor(bitmap.height * Math.min(crop.h, 100 - crop.y) / 100)) }
      bitmap.close()
      await current.setParameters({ tessedit_pageseg_mode: crop.w < 100 || crop.h < 100 ? PSM.SINGLE_LINE : PSM.AUTO })
      const result = await current.recognize(image, { rectangle })
      if (alive.current) { setText(result.data.text); if (!result.data.text.trim()) setError('읽힌 글자가 없어요. 표지판을 더 크게 촬영해 주세요.') }
    } catch {
      if (alive.current) setError('사진을 인식하지 못했어요. 서버 연결과 사진 형식을 확인한 뒤 다시 시도해 주세요.')
    } finally {
      await current?.terminate().catch(() => {})
      worker.current = null; running.current = false
      if (alive.current) setBusy(false)
    }
  }

  async function sample() {
    if (running.current) return
    setError(''); setText(''); setSelectedId('')
    try {
      const response = await fetch('/ocr/sample.png')
      if (!response.ok) throw new Error('sample')
      const blob = await response.blob()
      if (!alive.current || running.current) return
      setImage(blob)
      setCrop({ x: 34, y: 5, w: 35, h: 14 })
      const demo = areas.find(value => (JSON.parse(value) as string[])[0] === '[테스트] 가상 회사')
      if (demo) setArea(demo)
    } catch { if (alive.current) setError('예제 사진을 열지 못했어요. 웹을 다시 실행해 주세요.') }
  }

  return <section className="panel ocr-panel" aria-labelledby="ocr-title">
    <div className="eyebrow">첫 번째 AI 기능 테스트</div>
    <h2 id="ocr-title">표지판 사진에서 장소 찾기</h2>
    <p className="panel-description">사진 속 글씨를 읽고, 같은 건물·층의 등록 장소와 비교해요.</p>
    <div className="ocr-grid"><div>
      <label htmlFor="ocr-photo">1. 표지판 사진 선택</label>
      <input id="ocr-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => selectPhoto(e.target.files?.[0])} />
      <button className="place-cancel" type="button" disabled={busy} onClick={sample}>예제 사진 사용</button>
      <p className="input-hint">JPG · PNG · WebP / 최대 15MB. 표지판 글씨가 크게 보이게 찍어 주세요.</p>
      {preview && <><div className="ocr-preview-wrap"><img className="ocr-preview" src={preview} alt="글자를 인식할 표지판 사진" /><span className="ocr-region" style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${Math.min(crop.w, 100 - crop.x)}%`, height: `${Math.min(crop.h, 100 - crop.y)}%` }} /></div><details><summary>인식할 표지판 영역 조절</summary><p className="input-hint">초록색 상자 안의 글자 한 줄을 인식해요. 예제는 표지판 영역이 미리 선택돼 있어요.</p>{([['x', '왼쪽 위치', 99], ['y', '위쪽 위치', 99], ['w', '너비', 100], ['h', '높이', 100]] as const).map(([key, label, max]) => <label key={key}>{label} {crop[key]}%<input type="range" min={key === 'x' || key === 'y' ? 0 : 1} max={max} value={crop[key]} disabled={busy} onChange={e => { setCrop(c => ({ ...c, [key]: Number(e.target.value) })); setText(''); setSelectedId('') }} /></label>)}</details></>}
      <button className="register-button" type="button" disabled={!image || busy} onClick={recognize}>{busy ? `인식 중… ${progress}%` : '글자 인식 시작'}</button>
      <p className="input-hint" role="status">{busy ? '처음에는 인식 모델을 불러와 시간이 걸릴 수 있어요.' : '사진은 업로드하지 않고 이 브라우저에서 인식해요.'}</p>
      {busy && <progress max="100" value={progress} aria-label="글자 인식 진행률" />}
      {error && <p className="feedback error" role="alert">{error}</p>}
    </div><div>
      <label htmlFor="ocr-area">2. 현재 건물·층 선택</label>
      <select id="ocr-area" value={area} onChange={e => { setArea(e.target.value); setSelectedId('') }}><option value="">건물·층을 선택하세요</option>{areas.map(value => <option key={value} value={value}>{(JSON.parse(value) as string[]).join(' · ')}</option>)}</select>
      <h3>읽힌 글자</h3><pre className="ocr-text" aria-live="polite">{text || '사진을 선택하고 인식을 시작하세요.'}</pre>
      <h3>등록 장소 후보</h3>
      {!area ? <p>건물·층을 먼저 골라 주세요.</p> : !text ? <p>글자를 인식하면 후보를 보여줘요.</p> : candidates.length ? <ul className="ocr-candidates">{candidates.map(p => <li key={p.id}><strong>{p.room}</strong><p className="input-hint">{normalize(text).includes(normalize(p.room)) ? '이름 일치 · 사진과 직접 비교해 주세요.' : '일부 글자 일치 · 잘못된 후보일 수 있으니 직접 확인해 주세요.'}</p><button className="register-button" type="button" disabled={busy || disabled} aria-pressed={selectedId === p.id} onClick={() => setSelectedId(p.id)}>{p.room}에서 대피 경로 보기</button></li>)}</ul> : <p>일치하는 장소가 없어요. 읽힌 글자와 등록된 이름을 비교해 주세요.</p>}
      <p className="input-hint">실제 표지판과 맞는 후보를 선택해 주세요. 선택한 장소를 출발점으로 경로를 계산해요.</p>
      {disabled && <p className="feedback error">서버 연결을 확인한 뒤 경로를 조회해 주세요.</p>}
    </div></div>
    {candidates.some(p => p.id === selectedId) && <div className="ocr-route"><RoutePreview key={selectedId} places={places} confirmedSource={candidates.find(p => p.id === selectedId)!} disabled={disabled || busy} connectionRevision={connectionRevision} /></div>}
  </section>
}
