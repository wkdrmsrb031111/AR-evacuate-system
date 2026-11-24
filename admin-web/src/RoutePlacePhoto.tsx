import { useState } from 'react'

/** Read-only photo component shared by route previews and future app screens. */
export default function RoutePlacePhoto({ placeId, name }: { placeId: string; name: string }) {
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  return <figure className="route-place-photo">
    <figcaption>다음에 찾아갈 장소 · <strong>{name}</strong></figcaption>
    {failed ? <div className="route-photo-fallback"><p>사진을 불러오지 못했어요. 위의 장소 이름과 이동 설명을 확인해 주세요.</p><button type="button" className="place-cancel" onClick={() => { setFailed(false); setAttempt(value => value + 1) }}>사진 다시 불러오기</button></div> : <>
      <img key={attempt} src={`/api/app/places/${encodeURIComponent(placeId)}/photo?attempt=${attempt}`} alt={`${name}의 등록된 안내 사진`} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      <p className="input-hint">등록된 참고 사진이에요. 현재 현장을 실시간으로 보여주는 화면은 아니에요.</p>
    </>}
  </figure>
}
