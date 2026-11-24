import { useState } from 'react'
import { DEFAULTS, SKINS, type StatusSettings } from './settings'

const DAYS = ['일', '월', '화', '수', '목', '금', '토']

export default function SettingsPanel({ s, update, onClose }: { s: StatusSettings; update: (p: Partial<StatusSettings>) => void; onClose: () => void }) {
  const [f, setF] = useState({ ...s, payMan: s.pay == null ? '' : String(Math.round(s.pay / 10000)), noPay: s.pay == null })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((o) => ({ ...o, [k]: v }))
  const bad = f.start >= f.end ? '퇴근이 출근보다 늦어야 해요' : f.workDays.length === 0 ? '근무 요일을 하나 이상 골라 주세요' : ''

  const save = () => {
    if (bad) return
    const n = Number(f.payMan)
    const t = Math.max(0, Number(f.leaveTotal) || 0)
    update({
      name: f.name.trim().slice(0, 12) || DEFAULTS.name,
      start: f.start, end: f.end, lunchStart: f.lunchStart, lunchEnd: f.lunchEnd,
      workDays: [...f.workDays].sort(),
      pay: f.noPay || !(n > 0) ? null : Math.round(n * 10000),
      hideMoney: f.hideMoney,
      payday: f.payday,
      leaveTotal: t, leaveUsed: Math.min(t, Math.max(0, Number(f.leaveUsed) || 0)),
      joinDate: f.joinDate, skin: f.skin,
      set: { ...s.set, end: true, pay: true, payday: true, leave: true, ...(f.name.trim() && f.name.trim() !== DEFAULTS.name ? { name: true } : {}) },
      onboard: s.onboard === 'done' ? 'done' : 'closed',
    })
    onClose()
  }

  return (
    <div className="st-modal-bg" onClick={onClose}>
      <form className="st-modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); save() }}>
        <h3>⚙ 상태창 설정</h3>
        <label>이름 <input value={f.name} maxLength={12} onChange={(e) => set('name', e.target.value)} /></label>
        <label>근무 시간 <span><input type="time" value={f.start} onChange={(e) => set('start', e.target.value)} /> ~ <input type="time" value={f.end} onChange={(e) => set('end', e.target.value)} /></span></label>
        <label>점심 시간 <span><input type="time" value={f.lunchStart} onChange={(e) => set('lunchStart', e.target.value)} /> ~ <input type="time" value={f.lunchEnd} onChange={(e) => set('lunchEnd', e.target.value)} /></span></label>
        <div className="st-f">근무 요일 <span className="st-days">{DAYS.map((d, i) => (
          <button type="button" key={d} className={f.workDays.includes(i) ? 'on' : ''} onClick={() => set('workDays', f.workDays.includes(i) ? f.workDays.filter((x) => x !== i) : [...f.workDays, i])}>{d}</button>
        ))}</span></div>
        <label>월급 (실수령) <span><input type="number" min={1} value={f.payMan} disabled={f.noPay} onChange={(e) => set('payMan', e.target.value)} style={{ width: 90 }} /> 만 원</span></label>
        <label className="st-chk"><input type="checkbox" checked={f.noPay} onChange={(e) => set('noPay', e.target.checked)} /> 월급 안 알려줄래요 (근무 시간만 보기)</label>
        <label className="st-chk"><input type="checkbox" checked={f.hideMoney} onChange={(e) => set('hideMoney', e.target.checked)} /> 화면에서 금액 가리기</label>
        <label>월급날 <select value={f.payday} onChange={(e) => set('payday', Number(e.target.value))}>
          {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}일</option>)}<option value={0}>말일</option>
        </select></label>
        <label>올해 연차 <span>총 <input type="number" step="0.5" min={0} value={f.leaveTotal} onChange={(e) => set('leaveTotal', Number(e.target.value))} style={{ width: 60 }} /> 일 · 사용 <input type="number" step="0.5" min={0} value={f.leaveUsed} onChange={(e) => set('leaveUsed', Number(e.target.value))} style={{ width: 60 }} /> 일</span></label>
        <label>입사일 <input type="date" value={f.joinDate} onChange={(e) => set('joinDate', e.target.value)} /></label>
        <label>스킨 <select value={f.skin} onChange={(e) => set('skin', e.target.value as StatusSettings['skin'])}>
          {SKINS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select></label>
        <div className="st-lock">🔒 모든 값은 이 브라우저에만 저장돼요. 서버로 보내지 않아요.</div>
        {bad && <div className="st-err">{bad}</div>}
        <div className="st-r">
          <button type="button" className="st-btn st-o st-reset" onClick={() => { if (confirm('상태창 설정을 처음 상태로 되돌릴까요?')) { update({ ...DEFAULTS }); onClose() } }}>초기화</button>
          <span className="st-sp" />
          <button type="button" className="st-btn st-o" onClick={onClose}>취소</button>
          <button className="st-btn" disabled={!!bad}>저장</button>
        </div>
      </form>
    </div>
  )
}
