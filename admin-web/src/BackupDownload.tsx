import { useState } from 'react'
import { errorMessage, getBackupFile } from './api'

export default function BackupDownload({ disabled }: { disabled: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function download() {
    if (busy || disabled) return
    setBusy(true); setError(''); setMessage('')
    try {
      const { filename, blob } = await getBackupFile()
      const url = URL.createObjectURL(blob)
      try {
        const link = document.createElement('a')
        link.href = url; link.download = filename
        document.body.appendChild(link); link.click(); link.remove()
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 30000)
      }
      setMessage('백업 파일을 만들었어요. 브라우저의 다운로드 목록에서 확인해 주세요.')
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  return <details className="backup-download">
    <summary>등록 정보 백업</summary>
    <div><h2>저장한 정보를 파일로 보관해요.</h2><p>장소·사진·길·통행 상태를 ZIP 파일 하나로 내려받아요. 삭제한 장소와 사진도 함께 들어가요.</p>
      <button type="button" className="place-cancel" onClick={download} disabled={disabled || busy}>{busy ? '백업 파일 만드는 중…' : '백업 파일 저장'}</button>
      {busy && <p className="feedback" role="status">저장된 정보를 모으고 있어요. 잠시 기다려 주세요.</p>}
      {error && <p className="feedback error" role="alert">{error}</p>}
      {message && <p className="feedback success" role="status">{message}</p>}
      <p className="backup-note">지금은 파일 저장만 지원해요. 백업 파일을 불러와 복원하는 기능은 다음 단계예요.</p>
    </div>
  </details>
}
