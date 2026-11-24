import { useRef, useState, type ReactNode } from 'react'
import { compute, dday, fmtDays, hms, PHASE_LABEL, won, type View } from './calc'
import { SKINS, type Field, type StatusSettings } from './settings'
import EditPop from './EditPop'

export interface WidgetProps {
  s: StatusSettings
  update: (p: Partial<StatusSettings>) => void
  now: Date
  /** 📌 항상 위 작은 창 열기 (없으면 버튼 숨김) */
  onPin?: () => void
  onSettings?: () => void
  onNav?: (path: string) => void
  /** 한 줄 바 ↔ 펼친 상태창 */
  onBar?: () => void
}

export const MENU = [
  { icon: '🎮', label: '게임', path: '/games' },
  { icon: '🔮', label: '운세', path: '/fortune' },
  { icon: '🍱', label: '점심', path: '/lunch' },
]

type Ctx = WidgetProps & {
  v: View
  ed: (f: Field) => (e: React.MouseEvent) => void
  dflt: (f: Field) => ReactNode
  money: (n: number | null) => ReactNode
  tools: ReactNode
}

export default function Widget(props: WidgetProps) {
  const { s, update, now } = props
  const v = compute(s, now)
  const wrap = useRef<HTMLDivElement>(null)
  const [edit, setEdit] = useState<{ f: Field; x: number; y: number } | null>(null)

  const ed = (f: Field) => (e: React.MouseEvent) => {
    const w = wrap.current!.getBoundingClientRect()
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setEdit({ f, x: Math.max(4, Math.min(r.left - w.left, w.width - 266)), y: r.bottom - w.top + 8 })
  }
  const dflt = (f: Field) => (!s.set[f] ? <span className="st-dflt">기본값</span> : null)
  const money = (n: number | null) =>
    n == null ? <>{Math.floor(v.workedSec / 3600)}시간 {Math.floor((v.workedSec % 3600) / 60)}분째</>
      : s.hideMoney ? <span className="st-hid">₩ ••••••</span> : won(n)
  const skinIdx = SKINS.findIndex((k) => k.id === s.skin)

  const tools = (
    <span className="st-tools">
      {props.onPin && <button title="화면에 띄우기 (항상 위)" onClick={props.onPin}>📌</button>}
      {props.onBar && <button title="한 줄로 줄이기" onClick={props.onBar}>➖</button>}
      <button title="스킨 바꾸기" onClick={() => update({ skin: SKINS[(skinIdx + 1) % SKINS.length].id })}>🎨</button>
      {s.pay != null && (
        <button title={s.hideMoney ? '금액 보이기' : '금액 가리기'} onClick={() => update({ hideMoney: !s.hideMoney })}>
          {s.hideMoney ? '🙈' : '👁'}
        </button>
      )}
      {props.onSettings && <button title="설정" onClick={props.onSettings}>⚙</button>}
    </span>
  )

  const ctx: Ctx = { ...props, v, ed, dflt, money, tools }
  const Skin = { widget: Fluent, rpg: Rpg, stock: Stock, badge: Badge }[s.skin] ?? Fluent

  return (
    <div className="st-wrap" ref={wrap}>
      <Skin {...ctx} />
      {edit && (
        <EditPop field={edit.f} s={s} update={update} x={edit.x} y={edit.y} onClose={() => setEdit(null)} />
      )}
    </div>
  )
}

/** 퇴근까지 남은 시간 / 상태 문구 */
function remainText(v: View) {
  if (v.phase === 'after') return '퇴근 완료'
  if (v.phase === 'off') return '오늘은 쉬는 날'
  return hms(v.remainSec)
}

function Menu({ onNav, cls }: { onNav?: (p: string) => void; cls: string }) {
  return (
    <div className={cls}>
      {MENU.map((m) => (
        <button key={m.path} onClick={() => onNav?.(m.path)}><i>{m.icon}</i>{m.label}</button>
      ))}
    </div>
  )
}

/* ── 1. 윈도우 위젯 ── */
function Fluent({ s, v, ed, dflt, money, tools, onNav }: Ctx) {
  return (
    <div className="st-fl">
      <div className="st-t">🕒 <button className="st-ed" onClick={ed('name')}>{s.set.name ? `${s.name}님의 오늘` : '오늘 근무'}</button><span className="st-sp" />{tools}</div>
      <div className="st-big">
        <b className="st-num">{remainText(v)}</b>
        <button className="st-ed" onClick={ed('end')}><small>{v.phase === 'work' || v.phase === 'lunch' || v.phase === 'before' ? '남음 · ' : ''}{s.end}{dflt('end')}</small></button>
      </div>
      <div className="st-prog"><i style={{ width: `${v.progress * 100}%` }} /></div>
      <div className="st-tiles">
        <button className="st-tile st-w st-ed" onClick={ed('pay')}>
          <span><small>{s.pay == null ? '오늘 근무' : '오늘 번 돈'} {dflt('pay')}</small><b className="st-num">{money(v.earned)}</b></span>
          {v.perSec != null && !s.hideMoney && <small>초당 +{v.perSec.toFixed(1)}원</small>}
        </button>
        <button className="st-tile st-ed" onClick={ed('payday')}><small>월급날 {dflt('payday')}</small><b>{dday(v.paydayD)}{v.paydayD <= 1 ? ' 🎉' : ''}</b></button>
        <div className="st-tile"><small>주말까지</small><b>{v.weekendD === 0 ? '주말 🎉' : `${v.weekendD}일`}</b></div>
        <button className="st-tile st-ed" onClick={ed('leave')}><small>남은 연차 {dflt('leave')}</small><b>{fmtDays(v.leaveLeft)}</b></button>
        <div className="st-tile"><small>지금</small><b>{PHASE_LABEL[v.phase]}</b></div>
      </div>
      <Menu onNav={onNav} cls="st-mn" />
    </div>
  )
}

/* ── 2. 픽셀 RPG ── */
function rpgMsg(v: View) {
  if (v.phase === 'before') return '출근 전. 아직 자유의 몸이다.'
  if (v.phase === 'lunch') return '점심시간. HP가 회복된다.'
  if (v.phase === 'after') return '퇴근 완료! 오늘도 살아남았다.'
  if (v.phase === 'off') return '휴식 중. 오늘은 전투가 없다.'
  if (v.remainSec < 1800) return '곧 퇴근! 짐을 챙겨라.'
  return v.progress < 0.5 ? '야생의 업무가 나타났다!' : '퇴근의 기운이 느껴진다…'
}
function Rpg({ s, v, ed, dflt, money, tools, onNav }: Ctx) {
  const lv = v.joinDays ? Math.floor(v.joinDays / 365) + 1 : 1
  return (
    <div className="st-px">
      <div className="st-t"><span>STATUS</span>{tools}</div>
      <div className="st-b">
        <div className="st-ln"><button className="st-ed" onClick={ed('name')}>{s.name}{dflt('name')}</button><b>Lv.{lv}</b></div>
        <div className="st-ln"><span>HP 체력</span><b>{Math.round((1 - v.progress) * 100)}%</b></div>
        <div className="st-bar st-r"><i style={{ width: `${(1 - v.progress) * 100}%` }} /></div>
        <div className="st-ln"><span>EXP 퇴근 게이지</span><b>{Math.round(v.progress * 100)}%</b></div>
        <div className="st-bar"><i style={{ width: `${v.progress * 100}%` }} /></div>
        <button className="st-gold st-ed" onClick={ed('pay')}>
          <small>{s.pay == null ? '오늘 근무' : '오늘 획득 골드'} {dflt('pay')}</small><br /><b className="st-num">{money(v.earned)}</b>
        </button>
        <div className="st-st">
          <button className="st-ed" onClick={ed('end')}>퇴근 <b>{remainText(v)}</b>{dflt('end')}</button>
          <button className="st-ed" onClick={ed('payday')}>월급날 <b>{dday(v.paydayD)}</b>{dflt('payday')}</button>
          <span>주말 <b>{v.weekendD === 0 ? 'NOW' : `${v.weekendD}일`}</b></span>
          <button className="st-ed" onClick={ed('leave')}>연차 <b>{fmtDays(v.leaveLeft)}</b>{dflt('leave')}</button>
        </div>
        <div className="st-msg">▶ {rpgMsg(v)}</div>
      </div>
      <Menu onNav={onNav} cls="st-mn" />
    </div>
  )
}

/* ── 3. 주식 앱 ── */
function Stock({ s, v, ed, dflt, money, tools, onNav }: Ctx) {
  const pts: string[] = []
  const n = 40
  for (let i = 0; i <= n; i++) {
    const t = i / n
    if (t > v.progress + 1e-9) break
    const y = 50 - t * 38 - Math.sin(i * 1.7) * 4 - Math.sin(i * 0.6) * 3
    pts.push(`${(t * 276).toFixed(1)},${y.toFixed(1)}`)
  }
  return (
    <div className="st-tr">
      <div className="st-t"><button className="st-ed" onClick={ed('name')}><b>{s.name}</b> <span>근무 {dflt('name')}</span></button>{tools}</div>
      <div className="st-px2">
        <button className="st-ed" onClick={ed('pay')}><small>오늘 번 돈 {dflt('pay')}</small><div className="st-v st-num">{money(v.earned)}</div></button>
        {v.perSec != null && !s.hideMoney && <div className="st-c">▲ +{v.perSec.toFixed(1)}원/초 · {Math.round(v.progress * 100)}%</div>}
      </div>
      <svg width="300" height="56" viewBox="-12 0 300 56">
        <line x1="0" y1="50" x2="276" y2="50" stroke="#1f2a36" />
        {pts.length > 1 && <polyline points={pts.join(' ')} fill="none" stroke="#ff4d5e" strokeWidth="2" />}
      </svg>
      <div className="st-qg">
        <button className="st-ed" onClick={ed('end')}><span>퇴근 {dflt('end')}</span><b>{s.end}</b></button>
        <div><span>남은 시간</span><b className="st-num">{remainText(v)}</b></div>
        <button className="st-ed" onClick={ed('payday')}><span>월급날 {dflt('payday')}</span><b className="st-up">{dday(v.paydayD)}</b></button>
        <div><span>주말</span><b>{v.weekendD === 0 ? '휴장' : `${v.weekendD}일`}</b></div>
        <button className="st-ed" onClick={ed('leave')}><span>연차 {dflt('leave')}</span><b className="st-dn">{fmtDays(v.leaveLeft)}</b></button>
        <div><span>이번 달</span><b className="st-num">{v.monthEarned == null ? '-' : s.hideMoney ? '•••' : `${Math.floor(v.monthEarned / 10000)}만`}</b></div>
      </div>
      <div className="st-news"><b>속보</b> {v.phase === 'after' ? '오늘 장 마감. 퇴근 성공' : v.phase === 'off' ? '오늘은 휴장일' : v.phase === 'lunch' ? '점심 휴장 중' : '퇴근 게이지 상승세 지속'}</div>
      <Menu onNav={onNav} cls="st-mn" />
    </div>
  )
}

/* ── 4. 사원증 ── */
function Badge({ s, v, ed, dflt, money, tools, onNav }: Ctx) {
  return (
    <div className="st-bd">
      <div className="st-strap" /><div className="st-clip" />
      <div className="st-card">
        <div className="st-top"><span>TANGBISIL CORP.</span>{tools}</div>
        <div className="st-who">
          <div className="st-ph">🧑‍💼</div>
          <button className="st-ed" onClick={ed('name')}><b>{s.name}{dflt('name')}</b><small>{v.joinDays ? `입사 ${v.joinDays.toLocaleString()}일째` : PHASE_LABEL[v.phase]}</small></button>
        </div>
        <button className="st-ln st-ed" onClick={ed('end')}><span>퇴근까지 {dflt('end')}</span><b className="st-num">{remainText(v)}</b></button>
        <button className="st-ln st-ed" onClick={ed('payday')}><span>월급날 {dflt('payday')}</span><b>{dday(v.paydayD)}</b></button>
        <div className="st-ln"><span>주말까지</span><b>{v.weekendD === 0 ? '주말' : `${v.weekendD}일`}</b></div>
        <button className="st-ln st-ed" onClick={ed('leave')}><span>남은 연차 {dflt('leave')}</span><b>{fmtDays(v.leaveLeft)}</b></button>
        <button className="st-earn st-ed" onClick={ed('pay')}><small>{s.pay == null ? '오늘 근무' : '오늘 번 돈'} {dflt('pay')}</small><br /><b className="st-num">{money(v.earned)}</b></button>
        <div className="st-bc" />
        <Menu onNav={onNav} cls="st-mn" />
      </div>
    </div>
  )
}

/** 한 줄 미니 바 */
export function MiniBar({ s, update, now, onExpand }: { s: StatusSettings; update: WidgetProps['update']; now: Date; onExpand?: () => void }) {
  const v = compute(s, now)
  const money = s.pay == null ? null : s.hideMoney ? '₩ ••••' : won(v.earned ?? 0)
  return (
    <div className="st-bar1">
      <span>⏱ <b className="st-num">{remainText(v)}</b></span>
      {money && <span>💰 <b className="st-num">{money}</b></span>}
      <span>월급 <b>{dday(v.paydayD)}</b></span>
      <span>주말 <b>{v.weekendD === 0 ? '🎉' : `${v.weekendD}일`}</b></span>
      <span className="st-sp" />
      {s.pay != null && <button title={s.hideMoney ? '금액 보이기' : '금액 가리기'} onClick={() => update({ hideMoney: !s.hideMoney })}>{s.hideMoney ? '🙈' : '👁'}</button>}
      {onExpand && <button title="펼치기" onClick={onExpand}>⤢</button>}
    </div>
  )
}
