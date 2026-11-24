import { Link } from 'react-router-dom'
import { useStatus } from './settings'
import { useNow } from './pip'
import { compute, dday, hms, won } from './calc'
import './status.css'

/** 홈 맨 위 한 줄 상태창 띠 → /status */
export default function StatusStrip() {
  const [s, update] = useStatus()
  const v = compute(s, useNow())
  const left = v.phase === 'after' ? '퇴근 완료 🎉' : v.phase === 'off' ? '오늘은 쉬는 날' : `퇴근까지 ${hms(v.remainSec)}`
  return (
    <div className="st-strip">
      <div className="wrap st-strip-in">
        <span>⏱ <b className="st-num">{left}</b></span>
        {s.pay != null && (
          <span>💰 오늘 <b className="st-num">{s.hideMoney ? '₩ ••••••' : won(v.earned ?? 0)}</b>
            <button title={s.hideMoney ? '금액 보이기' : '금액 가리기'} onClick={() => update({ hideMoney: !s.hideMoney })}>{s.hideMoney ? '🙈' : '👁'}</button>
          </span>
        )}
        <span className="st-hide-sm">월급 <b>{dday(v.paydayD)}</b></span>
        <span className="st-hide-sm">주말 <b>{v.weekendD === 0 ? '🎉' : `${v.weekendD}일`}</b></span>
        <span className="st-sp" />
        <Link to="/status" className="st-strip-go">{s.onboard === 1 ? '내 상태창 만들기 ›' : '상태창 열기 ›'}</Link>
      </div>
    </div>
  )
}
