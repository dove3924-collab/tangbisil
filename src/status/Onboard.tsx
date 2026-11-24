import { useState } from 'react'
import type { StatusSettings } from './settings'

interface Props {
  s: StatusSettings
  update: (p: Partial<StatusSettings>) => void
  onPin: () => void
  onSkins: () => void
}

const ENDS = ['17:00', '17:30', '18:00', '18:30', '19:00']
const PAYS: { label: string; v: number | null }[] = [
  { label: '200만대', v: 2_500_000 }, { label: '300만대', v: 3_500_000 }, { label: '400만대', v: 4_500_000 },
  { label: '500만대', v: 5_500_000 }, { label: '600만+', v: 6_500_000 }, { label: '안 알려줄래요', v: null },
]
const PAYDAYS = [10, 15, 20, 25, 0]
const label = (t: string) => (t.endsWith(':00') ? `${Number(t.slice(0, 2))}시` : t)

/** 첫 방문 질문 카드 3장 → 완성 카드 */
export default function Onboard({ s, update, onPin, onSkins }: Props) {
  const [custom, setCustom] = useState(false)
  const [val, setVal] = useState('')
  const step = s.onboard
  if (step === 'closed') return null

  const next = (p: Partial<StatusSettings>, n: StatusSettings['onboard']) => { setCustom(false); setVal(''); update({ ...p, onboard: n }) }
  const skip = <button className="st-skip" onClick={() => update({ onboard: 'closed' })}>나중에 할게요 ›</button>
  const dots = (n: number) => <div className="st-dots">{[1, 2, 3].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}</div>
  const head = (n: number) => <div className="st-qt"><span>내 상태창 만들기</span><b>{n} / 3</b></div>

  if (step === 'done') {
    return (
      <div className="st-q st-cta">
        <button className="st-x" aria-label="닫기" onClick={() => update({ onboard: 'closed' })}>×</button>
        <b>✔ 내 상태창 완성!</b>
        <small>업무 화면 구석에 띄워 두면<br />퇴근까지 남은 시간이 계속 보여요</small>
        <div><button className="st-btn" onClick={onPin}>📌 화면에 띄우기</button> <button className="st-btn st-o" onClick={onSkins}>🎨 스킨 고르기</button></div>
        <div className="st-hint">💡 숫자를 누르면 바로 고칠 수 있어요 (나머지는 ⚙)</div>
      </div>
    )
  }

  if (step === 1) {
    const pick = (end: string) => next({ end, set: { ...s.set, end: true } }, 2)
    return (
      <div className="st-q">
        {head(1)}<h5>보통 몇 시에 퇴근해요?</h5>
        <div className="st-ch">
          {ENDS.map((t) => <button key={t} onClick={() => pick(t)}>{label(t)}</button>)}
          <button className="ghost" onClick={() => setCustom(true)}>직접 입력</button>
        </div>
        {custom && <form className="st-row" onSubmit={(e) => { e.preventDefault(); if (val > s.start) pick(val) }}><input type="time" value={val} onChange={(e) => setVal(e.target.value)} autoFocus /> <button className="st-btn">확인</button></form>}
        {dots(1)}{skip}
      </div>
    )
  }

  if (step === 2) {
    return (
      <div className="st-q">
        {head(2)}<h5>한 달 월급(실수령)은 어느 정도예요?</h5>
        <div className="st-ch">
          {PAYS.map((p) => <button key={p.label} className={p.v == null ? 'ghost' : ''} onClick={() => next({ pay: p.v, set: { ...s.set, pay: true } }, 3)}>{p.label}</button>)}
        </div>
        <label className="st-chk"><input type="checkbox" checked={s.hideMoney} onChange={(e) => update({ hideMoney: e.target.checked })} /> 화면에서는 금액 가려 두기 (👁 로 언제든 켜고 끄기)</label>
        <div className="st-lock">🔒 이 브라우저에만 저장돼요. 서버로 보내지 않아요.</div>
        {dots(2)}{skip}
      </div>
    )
  }

  const pick = (d: number) => next({ payday: d, set: { ...s.set, payday: true } }, 'done')
  return (
    <div className="st-q">
      {head(3)}<h5>월급날은 며칠이에요?</h5>
      <div className="st-ch">
        {PAYDAYS.map((d) => <button key={d} onClick={() => pick(d)}>{d === 0 ? '말일' : `${d}일`}</button>)}
        <button className="ghost" onClick={() => setCustom(true)}>직접 입력</button>
      </div>
      {custom && <form className="st-row" onSubmit={(e) => { e.preventDefault(); const n = Number(val); if (n >= 1 && n <= 31) pick(n) }}>매달 <input type="number" min={1} max={31} value={val} onChange={(e) => setVal(e.target.value)} style={{ width: 60 }} autoFocus /> 일 <button className="st-btn">확인</button></form>}
      <div className="st-lock">주말이면 그 전 금요일로 계산해요</div>
      {dots(3)}{skip}
    </div>
  )
}
