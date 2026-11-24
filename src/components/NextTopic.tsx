import { useEffect, useState } from 'react'
import { api, type RoomFull } from '../lib/api'
import { LIAR_CATEGORIES } from '../lib/liar'

/** 결과 화면에서 다음 판 주제 고르기 (방장만 바꿀 수 있음, 대기실 설정과 같은 값) */
export default function NextTopic({ room, current, isHost }: { room: RoomFull; current: string; isHost: boolean }) {
  const [value, setValue] = useState<string>(room.settings.category ?? 'random')
  useEffect(() => { setValue(room.settings.category ?? 'random') }, [room.settings.category])
  const label = (v: string) => (v === 'random' ? '랜덤' : v)

  if (!isHost) return <p className="next-topic muted sm">다음 판 주제: <b>{label(value)}</b> · 방장이 바꿀 수 있어요</p>
  return (
    <div className="next-topic">
      <label>
        <span>다음 판 주제</span>
        <select value={value} onChange={(e) => {
          const v = e.target.value
          setValue(v)
          api.updateSettings(room.code, { category: v }).catch(() => setValue(room.settings.category ?? 'random'))
        }}>
          <option value="random">랜덤</option>
          {LIAR_CATEGORIES.map((c) => <option key={c} value={c}>{c}{c === current ? ' (지금 주제)' : ''}</option>)}
        </select>
      </label>
      <small>바꾸면 [다음 판]부터 적용돼요</small>
    </div>
  )
}
