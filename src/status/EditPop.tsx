import { useState } from 'react'
import type { Field, StatusSettings } from './settings'

interface Props {
  field: Field
  s: StatusSettings
  update: (p: Partial<StatusSettings>) => void
  x: number
  y: number
  onClose: () => void
}

const TITLE: Record<Field, string> = { end: '근무 시간', pay: '한 달 월급 (실수령)', payday: '월급날', leave: '올해 연차', name: '이름' }

/** 숫자를 눌렀을 때 뜨는 작은 말풍선 */
export default function EditPop({ field, s, update, x, y, onClose }: Props) {
  const [start, setStart] = useState(s.start)
  const [end, setEnd] = useState(s.end)
  const [pay, setPay] = useState(s.pay == null ? '' : String(Math.round(s.pay / 10000)))
  const [noPay, setNoPay] = useState(s.pay == null)
  const [payday, setPayday] = useState(s.payday)
  const [lt, setLt] = useState(String(s.leaveTotal))
  const [lu, setLu] = useState(String(s.leaveUsed))
  const [name, setName] = useState(s.name)

  const save = () => {
    const set = { ...s.set, [field]: true as const }
    if (field === 'end' && start < end) update({ start, end, set })
    if (field === 'pay') {
      const n = Number(pay)
      update({ pay: noPay || !(n > 0) ? null : Math.round(n * 10000), set })
    }
    if (field === 'payday') update({ payday, set })
    if (field === 'leave') {
      const t = Math.max(0, Number(lt) || 0), u = Math.max(0, Number(lu) || 0)
      update({ leaveTotal: t, leaveUsed: Math.min(u, t), set })
    }
    if (field === 'name' && name.trim()) update({ name: name.trim().slice(0, 12), set })
    onClose()
  }

  return (
    <>
      <div className="st-pop-bg" onClick={onClose} />
      <form className="st-pop" style={{ left: x, top: y }} onSubmit={(e) => { e.preventDefault(); save() }}>
        <b>{TITLE[field]}</b>
        {field === 'end' && (
          <div className="st-row"><input type="time" value={start} onChange={(e) => setStart(e.target.value)} /> ~ <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        )}
        {field === 'pay' && (
          <>
            <div className="st-row"><input type="number" inputMode="numeric" min={1} value={pay} disabled={noPay} onChange={(e) => setPay(e.target.value)} style={{ width: 90 }} autoFocus /> 만 원</div>
            <label className="st-chk"><input type="checkbox" checked={noPay} onChange={(e) => setNoPay(e.target.checked)} /> 안 알려줄래요 (근무 시간만 보기)</label>
            <label className="st-chk"><input type="checkbox" checked={s.hideMoney} onChange={(e) => update({ hideMoney: e.target.checked })} /> 화면에서 금액 가리기</label>
            <div className="st-lock">🔒 이 브라우저에만 저장돼요</div>
          </>
        )}
        {field === 'payday' && (
          <div className="st-row">
            매달 <select value={payday} onChange={(e) => setPayday(Number(e.target.value))}>
              {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}일</option>)}
              <option value={0}>말일</option>
            </select>
          </div>
        )}
        {field === 'leave' && (
          <div className="st-row">총 <input type="number" step="0.5" min={0} value={lt} onChange={(e) => setLt(e.target.value)} style={{ width: 54 }} /> 일 중 <input type="number" step="0.5" min={0} value={lu} onChange={(e) => setLu(e.target.value)} style={{ width: 54 }} /> 일 썼어요</div>
        )}
        {field === 'name' && (
          <div className="st-row"><input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} placeholder="예: 김대리" autoFocus /></div>
        )}
        {field === 'end' && start >= end && <div className="st-err">퇴근이 출근보다 늦어야 해요</div>}
        <div className="st-r"><button type="button" className="st-btn st-o" onClick={onClose}>취소</button><button className="st-btn">저장</button></div>
      </form>
    </>
  )
}
