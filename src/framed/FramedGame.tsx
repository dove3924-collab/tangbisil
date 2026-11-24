import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CHARGES, DESKTOP, ENDINGS, PROOFS, EVENTS, EVENT_TIMEOUT, EVIDENCE, EP_TITLE, FILES, GRADE_NAME, HINTS, HINT_LOGIN, HOW_TO, INTRO, LIMIT_MS, PATROL_MS, PHONE_PIN, PIN, PRINT_PIN, SUSPECTS,
  type EvId, type IntroLine,
} from './data'
import { introScene } from './intro_art'
import { cakePhoto, dogPhoto, familyPhoto, parkPhoto } from './art'
import {
  clearState, clock, compare, dueEvent, freshState, gradeOf, hintCount, leftText, loadRival, loadState, proved, rebutted, resultUrl, saveState, timeUp, type FrState,
} from './state'
import { GameCtx, useGame as useGameLocal, type Game } from './ctx'
import { Calc, Calendar, DocView, EvBanner, EvidenceView, Excel, Explorer, ImageView, KIND_ICO, Mail, Messenger, Notepad, Portal, Soum, Word, Zip, unreadOf } from './apps'
import { copyText, isAway } from '../puzzle/common'
import { fmtSec } from '../escape/share'
import { loadNickname, saveNickname } from '../lib/nickname'
import { track } from '../lib/analytics'
import './framed.css'

const BASE_W = 1280, BASE_H = 800, TASK_H = 44
/** 실제 화면 비율에 맞춰 늘어나는 작업 영역 크기 (최소 1280×800 기준으로 확대·축소) */
let SW = BASE_W, SH = BASE_H

/* ════════ 화면 크기 맞춤 ════════ */
function useFit() {
  const [k, setK] = useState(1)
  const [, setSize] = useState('')
  useLayoutEffect(() => {
    const f = () => {
      const kk = Math.min(window.innerWidth / BASE_W, window.innerHeight / BASE_H)
      SW = Math.round(window.innerWidth / kk); SH = Math.round(window.innerHeight / kk)
      setK(kk); setSize(`${SW}x${SH}`)
    }
    f(); window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])
  return k
}

/** 인트로 그림(960×540)을 화면에 꽉 차게 (넘치는 쪽은 잘림) */
function useCover() {
  const [c, setC] = useState(1)
  useLayoutEffect(() => {
    const f = () => setC(Math.max(window.innerWidth / 960, window.innerHeight / 540))
    f(); window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])
  return c
}

/* ════════ 인트로·엔딩 장면 ════════ */
function Story({ scenes, onDone, skipLabel = '건너뛰기 ⏭' }: { scenes: { scene: string; time: string; lines: IntroLine[] }[]; onDone: () => void; skipLabel?: string }) {
  const [si, setSi] = useState(0)
  const [li, setLi] = useState(0)
  const sc = scenes[si]
  const art = useMemo(() => introScene(sc.scene), [sc.scene])
  const next = useCallback(() => {
    if (li < sc.lines.length - 1) setLi(li + 1)
    else if (si < scenes.length - 1) { setSi(si + 1); setLi(0) }
    else onDone()
  }, [li, si, sc.lines.length, scenes.length, onDone])
  const first = si === 0 && li === 0
  const prev = useCallback(() => {
    if (li > 0) setLi(li - 1)
    else if (si > 0) { setSi(si - 1); setLi(scenes[si - 1].lines.length - 1) }
  }, [li, si, scenes])
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); next() }
      if (e.key === 'ArrowLeft' || e.key === 'Backspace') { e.preventDefault(); prev() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [next, prev])
  const ln = sc.lines[li]
  const dotOf = (i: number) => scenes.findIndex((x) => x.scene === scenes[i].scene)
  const cover = useCover()
  return (
    <div className="fr-story" onClick={next}>
      <div className="stage" style={{ transform: `translate(-50%, -50%) scale(${cover})` }}>
        <div dangerouslySetInnerHTML={{ __html: art.svg }} />
        {art.ov.map((o, i) => <div key={i} className="ov" style={{ left: o.x, top: o.y, ...cssText(o.extra) }} dangerouslySetInnerHTML={{ __html: o.html }} />)}
      </div>
      <button className="skip" onClick={(e) => { e.stopPropagation(); onDone() }}>{skipLabel}</button>
      <div className="cap">
        <div className="who">{sc.time}</div>
        <div className={'line' + (ln.think ? ' think' : '')} key={si + '-' + li}>{ln.who && <b>{ln.who}　</b>}{ln.think ? `(${ln.text})` : ln.who ? `"${ln.text}"` : ln.text}</div>
        {scenes.length > 1 && <div className="dots">{scenes.map((_, i) => dotOf(i) === i && <i key={i} className={dotOf(si) === i ? 'on' : i < si ? 'done' : ''} />)}</div>}
        <div className="next"><button disabled={first} onClick={(e) => { e.stopPropagation(); prev() }}>◀ 이전</button><span>클릭 또는 Space ▶</span></div>
      </div>
    </div>
  )
}
function cssText(t: string): React.CSSProperties {
  const o: Record<string, string> = {}
  t.split(';').forEach((p) => { const [k, v] = p.split(':'); if (k && v) o[k.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v.trim() })
  return o
}

/* ════════ 창 ════════ */
interface Win { key: string; title: string; ico: string; x: number; y: number; w: number; h: number; z: number; max: boolean; min: boolean }
const WIN_SIZE: Record<string, [number, number]> = {
  explorer: [760, 470], excel: [900, 540], word: [820, 600], notepad: [640, 420], image: [640, 540], zip: [460, 300], doc: [620, 520], ev: [420, 300],
  mail: [1000, 580], messenger: [820, 560], portal: [940, 580], calendar: [940, 520], calc: [300, 420], ctrl: [460, 260], phonelink: [420, 600], printer: [720, 520], soum: [1180, 700],
}
function winMeta(key: string): { title: string; ico: string; kind: string; arg: string } {
  const [kind, arg = ''] = key.split(':')
  if (kind === 'file') {
    const f = FILES[arg]
    const k = f.kind === 'xlsx' ? 'excel' : f.kind === 'docx' ? (arg === 'soum' ? 'soum' : 'word') : f.kind === 'txt' ? 'notepad' : f.kind === 'img' ? 'image' : f.kind === 'zip' ? 'zip' : 'doc'
    const app = k === 'excel' ? ' - Excel' : k === 'word' || k === 'soum' ? ' - Word' : k === 'notepad' ? ' - 메모장' : k === 'image' ? ' - 사진' : ''
    return { title: f.name + app, ico: KIND_ICO[f.kind], kind: k, arg }
  }
  if (kind === 'explorer') return { title: arg === 'trash' ? '휴지통' : FILES[arg]?.name ?? '파일 탐색기', ico: arg === 'trash' ? '🗑️' : '📁', kind, arg }
  if (kind === 'ev') return { title: EVIDENCE.find((e) => e.id === arg)?.file ?? '', ico: '🔎', kind, arg }
  const T: Record<string, [string, string]> = { mail: ['메일 — 박○○ (감사팀)', '✉️'], messenger: ['사내메신저', '💬'], portal: ['사내 포털 — 브라우저', '🌐'], calendar: ['일정', '📅'], calc: ['계산기', '🧮'], ctrl: ['제어판', '⚙️'], phonelink: ['깨깨오톡', 'KK'], printer: ['인쇄 대기열 — 3층 복합기', '🖨️'] }
  return { title: T[kind]?.[0] ?? kind, ico: T[kind]?.[1] ?? '🪟', kind, arg }
}

function WinFrame({ w, k, focus, onFocus, onClose, onMin, onMax, onMove, children }: {
  w: Win; k: number; focus: boolean; onFocus: () => void; onClose: () => void; onMin: () => void; onMax: () => void; onMove: (x: number, y: number) => void; children: React.ReactNode
}) {
  const drag = (e: React.PointerEvent) => {
    if (w.max || (e.target as HTMLElement).closest('button')) return
    const sx = e.clientX, sy = e.clientY, ox = w.x, oy = w.y
    const mv = (ev: PointerEvent) => onMove(Math.max(-w.w + 80, Math.min(SW - 80, ox + (ev.clientX - sx) / k)), Math.max(0, Math.min(SH - TASK_H - 30, oy + (ev.clientY - sy) / k)))
    const upf = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', upf) }
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', upf)
  }
  const st: React.CSSProperties = w.max ? { left: 0, top: 0, width: SW, height: SH - TASK_H, zIndex: w.z } : { left: w.x, top: w.y, width: w.w, height: w.h, zIndex: w.z }
  if (w.min) st.display = 'none'
  return (
    <div className={'fr-win' + (focus ? ' focus' : '')} style={st} onPointerDown={onFocus}>
      <div className="fr-tbar" onPointerDown={drag} onDoubleClick={onMax}>
        <span className="ti"><Ico g={w.ico} /> {w.title}</span>
        <button onClick={onMin} aria-label="최소화">─</button><button onClick={onMax} aria-label="최대화">☐</button><button className="cl" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="fr-wb">{children}</div>
    </div>
  )
}

/* ════════ 깨깨오톡 PC (잠금모드) ════════ */
function PhoneLink() {
  const g = useGameLocal()
  const { s, up } = g
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<'chat' | 'friends'>('chat')
  const [thread, setThread] = useState<string | null>(null)
  const locked = s.patLockUntil !== undefined && s.ms < s.patLockUntil
  const submit = (p = pin) => {
    if (locked || p.length < 4) return
    if (p === PHONE_PIN) { up((d) => { d.phone = true; d.phoneTaken = true }); return }
    up((d) => { d.patFails += 1; if (d.patFails >= 5) { d.patFails = 0; d.patLockUntil = d.ms + 30000 } })
    setErr('잠금모드 비밀번호가 일치하지 않습니다.'); setPin('')
  }
  type Th = { name: string; ico: string; col: string; biz?: boolean; unread?: number; msgs: { me?: boolean; who?: string; t: string; text: string }[]; ev?: EvId }
  const T: Record<string, Th> = {
    wife: { name: '여보 ❤️', ico: '👩', col: '#f7c8d0', unread: 2, msgs: [{ t: '11/06 23:10', text: '콩이 미용 10시. 잊지 마' }, { t: '11/06 23:11', text: '요즘 왜 이렇게 늦어? 무슨 일 있어?' }, { me: true, t: '11/06 23:40', text: '일 때문에. 먼저 자.' }] },
    golf: { name: '주말 골프 모임', ico: '⛳', col: '#cfe8c4', msgs: [{ who: '최○○ 상무님', t: '11/04 16:40', text: '일요일 7시 12분. 늦는 사람 그늘집 쏘기' }, { me: true, t: '11/04 16:42', text: '네. 일찍 가겠습니다.' }] },
    hotel: { name: '○○호텔 강남', ico: '🏨', col: '#d9d2c4', biz: true, ev: 'hotel', msgs: [{ t: '11/03 14:05', text: '[알림톡] 박○○ 고객님, 11/03 14:05 체크인 감사합니다.\n객실: 1204호 (DAYUSE ~17:00)\n결제 카드: ****-7730' }, { t: '11/03 16:48', text: '[알림톡] 체크아웃이 완료되었습니다. 다음에 또 뵙겠습니다.' }] },
    bank: { name: '○○은행', ico: '🏦', col: '#cfe0f5', biz: true, unread: 1, msgs: [{ t: '10/28 15:31', text: '[알림톡] 입금 19,400,000원 · 잔액 *****' }, { t: '11/06 23:48', text: '[알림톡] 거래확인서 출력 요청이 접수되었습니다.' }] },
    salon: { name: '멍멍살롱', ico: '🐶', col: '#f5e3c6', biz: true, msgs: [{ t: '11/02 10:00', text: '[알림톡] 콩이 보호자님, 11/7(토) 10:00 전체 미용 예약이 확정되었습니다.' }] },
    ...(s.code ? { code: { name: '사내메일 인증', ico: '✉️', col: '#e4e4e4', biz: true, unread: 1, msgs: [{ t: clock(s.ms), text: `[알림톡] 예약 메일 발송 취소 인증번호 [${s.code}]\n타인에게 절대 알려주지 마세요.` }] } } : {}),
  }
  const order = [...(s.code ? ['code'] : []), 'wife', 'golf', 'salon', 'hotel', 'bank']
  if (!s.phone) {
    return (
      <div className="fr-kk lock">
        <svg className="logo" viewBox="4 8 40 36" width="104" height="94"><path d="M14 35 C9 35 6 31.5 6 27.5 C6 23.8 8.6 21 12 20.4 C12.2 15.2 16.3 11 21.5 11 C25.4 11 28.7 13.3 30.1 16.6 C31 16.2 32 16 33 16 C37.8 16 41.5 19.8 41.5 24.5 C41.5 29.5 37.8 35 33 35 Z" fill="#3c1e1e"/><path d="M14 34 L11 41 L20 35z" fill="#3c1e1e"/><text x="24" y="28.5" font-size="7.6" font-weight="900" text-anchor="middle" fill="#fee500" font-family="Arial, sans-serif">TALK</text></svg>
        <h3>잠금모드</h3>
        <p>깨깨오톡이 잠금모드 상태입니다.<br />잠금모드 비밀번호 4자리를 입력해 주세요.</p>
        <div className="dots">{[0, 1, 2, 3].map((i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}</div>
        <input className="hidden-in" autoFocus type="password" inputMode="numeric" maxLength={4} disabled={locked} value={pin}
          onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 4); setPin(v); setErr(''); if (v.length === 4) submit(v) }} />
        <div className="pad">{['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => k ? <button key={i} disabled={locked} onClick={() => {
          if (k === '⌫') { setPin(pin.slice(0, -1)); return }
          const v = (pin + k).slice(0, 4); setPin(v); setErr(''); if (v.length === 4) submit(v)
        }}>{k}</button> : <span key={i} />)}</div>
        {locked ? <p className="err">여러 번 틀렸습니다. {Math.ceil(((s.patLockUntil ?? 0) - s.ms) / 1000)}초 후 다시 시도하세요.</p> : err ? <p className="err">{err}</p> : <p className="muted">{s.code ? '🔔 새 알림톡 1개' : '　'}</p>}
        <button className="lnk" onClick={() => g.alert('깨깨오톡', '비밀번호를 잊으셨나요?\n휴대폰 깨깨오톡에서 잠금모드를 해제할 수 있습니다.\n\n…그 휴대폰은 팀장이 들고 갔다.')}>비밀번호를 잊으셨나요?</button>
      </div>
    )
  }
  return (
    <div className="fr-kk">
      <aside>
        <button className={tab === 'friends' ? 'on' : ''} onClick={() => setTab('friends')} title="친구">👤</button>
        <button className={tab === 'chat' ? 'on' : ''} onClick={() => { setTab('chat'); setThread(null) }} title="채팅">💬</button>
        <button onClick={() => g.alert('더보기', '깨깨오페이 · 선물하기 · 쇼핑\n\n지금은 볼 일이 없다.')} title="더보기">⋯</button>
        <button className="lk" onClick={() => up((d) => { d.phone = false })} title="잠금모드">🔒</button>
      </aside>
      {tab === 'friends' ? (
        <div className="list">
          <div className="hd2">친구</div>
          {['박○○ (나) · 오늘도 화이팅', '여보 ❤️', '민준이', '서연이', '최○○ 상무님', '한○○', '골프 프로님'].map((n) => <div key={n} className="fr-row2">👤 {n}</div>)}
        </div>
      ) : thread ? (
        <div className="list room">
          <div className="hd2"><button onClick={() => setThread(null)}>‹</button><span className="pf" style={{ background: T[thread].col }}>{T[thread].ico}</span><b>{T[thread].name}</b>{thread === 'golf' && <small>4</small>}</div>
          <div className="th">
            <div className="day">2026년 11월</div>
            {T[thread].msgs.map((m, i) => m.me ? (
              <div key={i} className="b me"><time>{m.t.split(' ').pop()}</time><p className="pre">{m.text}</p></div>
            ) : (
              <div key={i} className="b">
                <span className="pf" style={{ background: T[thread].col }}>{T[thread].ico}</span>
                <div className="bw">
                  <small>{m.who ?? T[thread].name}</small>
                  <div className="row">
                    {T[thread].biz ? <div className="card"><div className="ch">알림톡 도착</div><p className="pre">{m.text.replace(/^\[알림톡\] /, '')}</p></div> : <p className="pre">{m.text}</p>}
                    <time>{m.t.split(' ').pop()}</time>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {T[thread].ev && <EvBanner id={T[thread].ev!} />}
          <div className="inp"><span>{T[thread].biz ? '알림톡에는 답장할 수 없습니다.' : '팀장 계정이다. 보내면 안 된다.'}</span><button disabled>전송</button></div>
        </div>
      ) : (
        <div className="list">
          <div className="hd2">채팅<span className="ic">🔍 ＋</span></div>
          {order.map((id) => (
            <button key={id} className="tr" onClick={() => setThread(id)}>
              <i style={{ background: T[id].col }}>{T[id].ico}</i>
              <b>{T[id].name}{T[id].biz && <small> 알림톡</small>}</b>
              <span>{T[id].msgs.slice(-1)[0].text.replace(/\[알림톡\] /, '').replace(/\n/g, ' ').slice(0, 40)}</span>
              <time>{T[id].msgs.slice(-1)[0].t.split(' ')[0]}</time>
              {T[id].unread ? <em>{T[id].unread}</em> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ════════ 프린터 인쇄 대기열 ════════ */
function Printer() {
  const g = useGameLocal()
  const { s, up } = g
  const [sel, setSel] = useState<number | null>(null)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const jobs = [
    { name: '상품권나라_매입확인서.pdf', who: '박○○', t: '11/06 23:47', size: '2페이지', st: '⚠️ 오류 - 용지 없음', secure: true },
    { name: '골프_스코어.xlsx', who: '박○○', t: '11/05 18:02', size: '1페이지', st: '인쇄됨', secure: false },
    { name: '징계위원회_자료(10부).docx', who: '한○○', t: '11/06 19:30', size: '12페이지', st: '인쇄됨', secure: false },
  ]
  const job = sel !== null ? jobs[sel] : null
  return (
    <div className="fr-prnw">
      <div className="fr-prn-st">🖨️ 3층 복합기 · <b>오프라인 (용지 없음)</b> · 대기 중인 문서 1개</div>
      <div className="fr-prn-list">
        <div className="lh"><span>문서 이름</span><span>상태</span><span>소유자</span><span>페이지</span><span>제출 시간</span></div>
        {jobs.map((j, i) => (
          <div key={j.name} className={'row' + (sel === i ? ' sel' : '')} onClick={() => { setSel(i); setErr('') }}>
            <span>{j.secure ? '🔒 ' : ''}{j.name}</span><span className={j.secure ? 'bad' : ''}>{j.st}</span><span>{j.who}</span><span>{j.size}</span><span>{j.t}</span>
          </div>
        ))}
      </div>
      <div className="fr-prn-view">
        {!job ? <p className="muted">문서를 선택하면 미리 볼 수 있어요.</p>
          : !job.secure ? <p className="muted">이미 인쇄된 문서는 미리보기가 지원되지 않습니다.</p>
            : !s.printOk ? (
              <form onSubmit={(e) => { e.preventDefault(); if (pin === PRINT_PIN) up((d) => { d.printOk = true }); else { setErr('PIN이 맞지 않습니다.'); setPin('') } }}>
                <p>🔒 <b>보안 인쇄 문서</b>입니다. 미리 보거나 인쇄하려면 보안 인쇄 PIN을 입력하세요.<br /><small className="muted">보안 인쇄 PIN = 본인 사무실 내선번호 4자리 (IT 헬프데스크 안내)</small></p>
                <input value={pin} maxLength={4} inputMode="numeric" placeholder="PIN" onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setErr('') }} />
                <button className="pri">미리 보기</button>
                {err && <p className="err">{err}</p>}
              </form>
            ) : (
              <>
                <div className="fr-page sm">
                  <h2>상품권 매입 확인서</h2>
                  <p className="pre">{'상품권나라 강남점 · 2026-10-28\n\n매도인: 박○○ (○○주식회사 감사팀)\n매입 품목: 백화점 상품권 50만 원권 × 40매\n액면 합계: 20,000,000원\n매입률: 97%\n매입 대금: 19,400,000원\n입금 계좌: ○○은행 박○○ (본인)\n\n위와 같이 매입하였음을 확인합니다.'}</p>
                </div>
                <EvBanner id="gift" />
              </>
            )}
      </div>
    </div>
  )
}

/* ════════ 잠금 화면 ════════ */
const SLIDES = [
  { file: 'IMG_20190809_141502.jpg', cap: '2019 여름 제주 · 오빠 민준이랑 동생 서연이', svg: familyPhoto },
  { file: 'IMG_20251121_193010.jpg', cap: '첫째 민준이 생일 🎂', svg: () => cakePhoto('민준아 생일 축하해', 13, '25 11 21') },
  { file: 'IMG_20220809_190344.jpg', cap: '서연이 생일 파티 🎂', svg: () => cakePhoto('서연아 생일 축하해', 7, '22 08 09') },
  { file: 'IMG_20210417_183244.jpg', cap: '우리집 막내 콩이 첫 생일 🐶', svg: dogPhoto },
]
function LockScreen() {
  const { s, up } = useGameLocal()
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [si, setSi] = useState(0)
  const [signin, setSignin] = useState(false)
  const bg = useMemo(() => parkPhoto(), [])
  const locked = s.pinLockUntil !== undefined && s.ms < s.pinLockUntil
  const submit = () => {
    if (locked || pin.length < 6) return
    if (pin === PIN) { up((d) => { d.login = true }); return }
    up((d) => { d.pinFails += 1; if (d.pinFails >= 5) { d.pinFails = 0; d.pinLockUntil = d.ms + 30000 } })
    setErr('PIN이 잘못되었습니다. 다시 시도하세요.'); setPin('')
  }
  const sl = SLIDES[si]
  return (
    <div className={'fr-lock' + (signin ? ' in' : '')}>
      <div className="fr-lockbg" dangerouslySetInnerHTML={{ __html: bg }} />
      {!signin ? (
        <div className="fr-lockfront" onClick={() => setSignin(true)}>
          <div className="tm">{clock(s.ms)}</div><div className="dt">11월 7일 토요일</div>
          <div className="tap">클릭하면 로그인 화면이 열려요</div>
        </div>
      ) : (
        <>
          <button className="fr-lockback" onClick={() => setSignin(false)}>← 잠금 화면으로</button>
          <div className="tm">{clock(s.ms)}</div><div className="dt">11월 7일 토요일</div>
          <div className="fr-box">
            <div className="fr-av">박</div><b>박○○</b><small>감사팀장</small>
            <form onSubmit={(e) => { e.preventDefault(); submit() }}>
              <input type="password" inputMode="numeric" maxLength={6} autoFocus disabled={locked} value={pin} placeholder="PIN (숫자 6자리)" onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr('') }} />
              <button disabled={locked || pin.length < 6}>→</button>
            </form>
            {locked ? <p className="err">PIN을 여러 번 잘못 입력했습니다. {Math.ceil(((s.pinLockUntil ?? 0) - s.ms) / 1000)}초 후 다시 시도하세요.</p> : err && <p className="err">{err}</p>}
            <p className="fr-hintbtn">암호 힌트: <b>둘째 생년월일 (YYMMDD) ♥</b></p>
            <button className="lnk" onClick={() => setErr('PIN을 잊으셨나요? IT 헬프데스크(내선 1004)로 문의하세요. — 새벽엔 아무도 안 받는다.')}>PIN을 잊으셨나요?</button>
          </div>
          <div className="fr-slide">
            <div className="sh">🖼️ 추억 사진 <span>{si + 1} / {SLIDES.length}</span></div>
            <div className="pic" dangerouslySetInnerHTML={{ __html: sl.svg() }} />
            <div className="cap"><b>{sl.cap}</b><small>{sl.file}</small></div>
            <div className="nv"><button onClick={() => setSi((si + SLIDES.length - 1) % SLIDES.length)}>◀</button><button onClick={() => setSi((si + 1) % SLIDES.length)}>▶</button></div>
          </div>
        </>
      )}
    </div>
  )
}

/* ════════ 아이콘 (이모지, 깨깨오톡만 그림) ════════ */
function Ico({ g, big }: { g: string; big?: boolean }) {
  if (g !== 'KK') return <>{g}</>
  const z = big ? 40 : 18
  return (
    <svg className="fr-kkico" width={z} height={z} viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" rx="12" fill="#fee500" />
      <path d="M14 35 C9 35 6 31.5 6 27.5 C6 23.8 8.6 21 12 20.4 C12.2 15.2 16.3 11 21.5 11 C25.4 11 28.7 13.3 30.1 16.6 C31 16.2 32 16 33 16 C37.8 16 41.5 19.8 41.5 24.5 C41.5 29.5 37.8 35 33 35 Z" fill="#3c1e1e" /><path d="M14 34 L11 41 L20 35z" fill="#3c1e1e" />
      <text x="24" y="28.5" fontSize="7.6" fontWeight="900" textAnchor="middle" fill="#fee500" fontFamily="Arial, sans-serif">TALK</text>
    </svg>
  )
}

/* ════════ 바탕 화면 ════════ */
const ICONS: Record<string, string> = { pc: '💻', trash: '🗑️', portal: '🌐', mail: '✉️', msg: '💬', cal: '📅', calc: '🧮', folder: '📁', docx: '📝', xlsx: '📊', txt: '📄', ctrl: '⚙️', phone: 'KK' }
function Desktop({ k, wins, setWins, focus, setFocus, open, onSend, onHint, onRestart }: {
  k: number; wins: Win[]; setWins: React.Dispatch<React.SetStateAction<Win[]>>; focus: string | null; setFocus: (k: string | null) => void; open: (w: string) => void; onSend: () => void; onHint: () => void; onRestart: () => void
}) {
  const g = useGameLocal()
  const { s } = g
  const [sel, setSel] = useState<string | null>(null)
  const [start, setStart] = useState(false)
  const unreadMsg = ['team', 'lee', 'jung', 'choi', 'jenny', 'wife'].reduce((a, id) => a + unreadOf(id, s), 0)
  const topZ = Math.max(0, ...wins.map((w) => w.z))
  const close = (key: string) => setWins((ws) => ws.filter((w) => w.key !== key))
  const patch = (key: string, p: Partial<Win>) => setWins((ws) => ws.map((w) => (w.key === key ? { ...w, ...p } : w)))
  const body = (w: Win) => {
    const m = winMeta(w.key)
    switch (m.kind) {
      case 'explorer': return <Explorer start={m.arg} />
      case 'excel': return <Excel id={m.arg} />
      case 'word': return <Word id={m.arg} />
      case 'notepad': return <Notepad id={m.arg} />
      case 'image': return <ImageView id={m.arg} />
      case 'zip': return <Zip id={m.arg} />
      case 'doc': return <DocView id={m.arg} />
      case 'ev': return <EvidenceView id={m.arg as EvId} />
      case 'mail': return <Mail />
      case 'messenger': return <Messenger start={m.arg} />
      case 'portal': return <Portal />
      case 'calendar': return <Calendar />
      case 'calc': return <Calc />
      case 'phonelink': return <PhoneLink />
      case 'printer': return <Printer />
      case 'soum': return <Soum onSend={onSend} />
      case 'ctrl': return <div className="fr-pad"><p>⚙️ 이 작업을 하려면 관리자 권한이 필요합니다.</p><p className="muted">관리자: IT 헬프데스크 (내선 1004)</p></div>
      default: return null
    }
  }
  const taskApps: [string, string, string][] = [['explorer:pc', '📁', '파일 탐색기'], ['mail', '✉️', '메일'], ['messenger', '💬', '사내메신저'], ['portal', '🌐', '사내 포털'], ['phonelink', 'KK', '깨깨오톡']]
  const clickTask = (key: string) => {
    const w = wins.find((x) => x.key === key)
    if (!w) { open(key); return }
    if (w.min) { patch(key, { min: false, z: topZ + 1 }); setFocus(key) } else if (focus === key) { patch(key, { min: true }); setFocus(null) } else { patch(key, { z: topZ + 1 }); setFocus(key) }
  }
  const left = LIMIT_MS - s.ms
  return (
    <div className="fr-desktop" onPointerDown={() => { setSel(null) }}>
      <div className="icons">
        {DESKTOP.map((ic) => (
          <button key={ic.id} className={'ic' + (sel === ic.id ? ' sel' : '')} onPointerDown={(e) => { e.stopPropagation(); setSel(ic.id); setStart(false) }} onDoubleClick={() => open(ic.open)}
            onKeyDown={(e) => { if (e.key === 'Enter') open(ic.open) }}>
            <span className="g"><Ico g={ICONS[ic.ico]} big /></span><span className="n">{ic.name}</span>
          </button>
        ))}
      </div>
      {wins.map((w) => (
        <WinFrame key={w.key} w={w} k={k} focus={focus === w.key} onFocus={() => { if (focus !== w.key) { patch(w.key, { z: topZ + 1 }); setFocus(w.key) } }}
          onClose={() => close(w.key)} onMin={() => { patch(w.key, { min: true }); setFocus(null) }} onMax={() => patch(w.key, { max: !w.max })} onMove={(x, y) => patch(w.key, { x, y })}>
          {body(w)}
        </WinFrame>
      ))}
      {start && (
        <div className="fr-start" onPointerDown={(e) => e.stopPropagation()}>
          <div className="u"><span className="fr-av">박</span>박○○ (감사팀)</div>
          {DESKTOP.slice(0, 7).map((ic) => <button key={ic.id} onClick={() => { setStart(false); open(ic.open) }}><Ico g={ICONS[ic.ico]} /> {ic.name}</button>)}
          <div className="pw">
            <button onClick={() => { setStart(false); g.alert('잠금', '잠그면 PIN을 다시 넣어야 한다. 굳이…') }}>🔒 잠금</button>
            <button onClick={() => { setStart(false); g.alert('시스템 종료', '끄면 예약 메일은 서버에서 그대로 나간다. 그리고 다시 켜면 부팅 기록이 남는다.') }}>⏻ 시스템 종료</button>
            <button onClick={() => { setStart(false); onRestart() }}>↺ 처음부터 다시 하기</button>
          </div>
        </div>
      )}
      <div className="fr-task" onPointerDown={(e) => e.stopPropagation()}>
        <button className="st" onClick={() => setStart(!start)}>⊞</button>
        {taskApps.map(([key, ico, t]) => {
          const w = wins.find((x) => x.key === key)
          return <button key={key} className={'tk' + (w ? ' open' : '') + (focus === key ? ' on' : '')} title={t} onClick={() => clickTask(key)}><Ico g={ico} />{key === 'messenger' && unreadMsg > 0 && <em>{unreadMsg}</em>}</button>
        })}
        {wins.filter((w) => !taskApps.some(([kk]) => kk === w.key)).map((w) => (
          <button key={w.key} className={'tk wide' + (focus === w.key ? ' on' : '')} onClick={() => clickTask(w.key)}><Ico g={w.ico} /> <span>{w.title}</span></button>
        ))}
        <div className="tray">
          <button className="fr-hintbtn" onClick={onHint}>💡 힌트{hintCount(s) ? ` (${hintCount(s)})` : ''}</button>
          <button className="fr-restart" title="처음부터 다시 하기" onClick={onRestart}>↺ 처음부터</button>
          <button className="fr-prn" title="프린터: 오류 1개" onClick={() => open('printer')}>🖨️<em>!</em></button>
          <button className="usb" onClick={() => open('explorer:usb')}>💾 내 USB · 증거 <b>{s.ev.length}</b>/7</button>
          <span className={'tmr' + (left < 5 * 60000 ? ' hot' : '')}>⏱ {s.cancelled ? '예약 취소됨 · 위원회 마감까지 ' : '03:00 위원회 마감까지 '}{leftText(s.ms)}</span>
          <span className="clk">{clock(s.ms)}<br />2026-11-07</span>
        </div>
      </div>
    </div>
  )
}

/* ════════ 본체 ════════ */
export default function FramedGame() {
  const nav = useNavigate()
  const k = useFit()
  const [s, setS] = useState<FrState>(() => loadState() ?? freshState())
  const [wins, setWins] = useState<Win[]>([])
  const [focus, setFocus] = useState<string | null>(null)
  const [toasts, setToasts] = useState<{ id: number; text: string; onClick?: () => void }[]>([])
  const [alertBox, setAlertBox] = useState<{ title: string; text: string } | null>(null)
  const [hints, setHints] = useState(false)
  const [patrolMsg, setPatrolMsg] = useState(false)
  const [howto, setHowto] = useState(false)
  const [endStory, setEndStory] = useState(false)
  const tid = useRef(0)
  const sRef = useRef(s)
  sRef.current = s

  useEffect(() => { saveState(s) }, [s])
  const up = useCallback((fn: (d: FrState) => void) => setS((p) => { const d = structuredClone(p); fn(d); return d }), [])
  const toast = useCallback((text: string, onClick?: () => void) => {
    const id = ++tid.current
    setToasts((t) => [...t.slice(-2), { id, text, onClick }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 7000)
  }, [])

  const open = useCallback((what: string) => {
    setWins((ws) => {
      const top = Math.max(0, ...ws.map((w) => w.z)) + 1
      const ex = ws.find((w) => w.key === what)
      if (ex) return ws.map((w) => (w.key === what ? { ...w, min: false, z: top } : w))
      const m = winMeta(what)
      const [w, h] = WIN_SIZE[m.kind] ?? [640, 460]
      const n = ws.length
      const x = Math.max(6, Math.min(SW - w - 6, (SW - w) / 2 - 120 + (n % 6) * 28))
      const y = Math.max(6, Math.min(SH - TASK_H - h - 6, (SH - TASK_H - h) / 2 - 40 + (n % 6) * 24))
      return [...ws, { key: what, title: m.title, ico: m.ico, x, y, w, h, z: top, max: m.kind === 'soum', min: false }]
    })
    setFocus(what)
  }, [])

  const saveEv = useCallback((id: EvId) => {
    if (sRef.current.ev.includes(id)) return
    const n = sRef.current.ev.length + 1
    up((d) => { if (!d.ev.includes(id)) d.ev.push(id) })
    const e = EVIDENCE.find((x) => x.id === id)!
    toast(`💾 내 USB에 저장 (${n}/7) — ${e.name}`)
  }, [up, toast])

  const game: Game = useMemo(() => ({
    s, up, open, saveEv, toast, alert: (title, text) => setAlertBox({ title, text }), openPhone: () => open('phonelink'),
  }), [s, up, open, saveEv, toast])

  const finish = useCallback((sent: boolean) => {
    const cur = sRef.current
    const g = gradeOf(cur, sent)
    up((d) => { d.finished = true; d.grade = g; if (sent) d.sentAt = d.ms })
    track('escape_clear', { game_id: 'framed', seconds: Math.round(Math.min(cur.ms, LIMIT_MS) / 1000), hints: hintCount(cur), result: g })
    setEndStory(true)
  }, [up])

  /* 시계: 화면을 보고 있을 때만 흐름 */
  const playing = s.introDone && !s.finished
  useEffect(() => {
    if (!playing) return
    const iv = window.setInterval(() => { if (!isAway()) setS((p) => (p.introDone && !p.finished ? { ...p, ms: p.ms + 1000 } : p)) }, 1000)
    return () => window.clearInterval(iv)
  }, [playing])

  /* 메신저 이벤트·의심·시간 초과 */
  useEffect(() => {
    if (!playing) return
    const e = dueEvent(s)
    if (e) {
      up((d) => { d.events[e.id] = { shown: true, at: d.ms } })
      const who = e.msgs[0].who
      toast(`💬 ${who}: ${e.msgs[e.msgs.length - 1].text.slice(0, 34)}…`, () => open('messenger:' + e.chat))
    }
    EVENTS.forEach((ev) => {
      const st = s.events[ev.id]
      if (st?.shown && st.replied === undefined && !st.timedOut && s.ms - (st.at ?? 0) >= EVENT_TIMEOUT) {
        up((d) => { d.events[ev.id].timedOut = true; d.sus += 1; if (ev.id === 'e3') d.sus = Math.max(d.sus, 3) })
      }
    })
    if (s.sus >= 3 && !s.patrol) {
      up((d) => { d.patrol = true; d.ms += PATROL_MS })
      setPatrolMsg(true)
    }
    if (timeUp(s)) finish(false)
  }, [s, playing, up, toast, open, finish])

  const [askRestart, setAskRestart] = useState(false)
  const restart = () => { setAskRestart(false); clearState(); setS(freshState()); setWins([]); setEndStory(false); setHowto(false) }

  if (!s.introDone) {
    if (!howto) return <Story scenes={INTRO} onDone={() => setHowto(true)} />
    return (
      <div className="fr-howto">
        <div className="card">
          <h2>{EP_TITLE}</h2>
          <p className="lead">새벽 2시 30분, 감사팀장 자리. <b>3시</b>에 본사 감사위원회 회의가 열린다. 보고서도, 소명서도 그때까지다.</p>
          <ul>{HOW_TO.map((t) => <li key={t}>{t}</li>)}</ul>
          <div className="fr-btns"><button onClick={() => setHowto(false)}>인트로 다시 보기</button><button className="pri" onClick={() => up((d) => { d.introDone = true })}>시작하기 (30분)</button></div>
        </div>
      </div>
    )
  }

  if (s.finished && endStory && s.grade) {
    return <Story scenes={ENDINGS[s.grade]} onDone={() => setEndStory(false)} skipLabel="결과 보기 ⏭" />
  }
  if (s.finished && s.grade) return <ResultCard s={s} onRestart={restart} onLobby={() => nav('/')} />

  return (
    <GameCtx.Provider value={game}>
      <div className="fr-root">
        <div className="fr-stage" style={{ width: SW, height: SH, transform: `scale(${k})` }}>
          {!s.login ? <LockScreen /> : (
            <Desktop k={k} wins={wins} setWins={setWins} focus={focus} setFocus={setFocus} open={open} onSend={() => finish(true)} onHint={() => setHints(true)} onRestart={() => setAskRestart(true)} />
          )}
          {!s.login && <div className="fr-locktimer">⏱ 03:00까지 {leftText(s.ms)} <button onClick={() => setHints(true)}>💡 힌트</button> <button onClick={() => setAskRestart(true)}>↺ 처음부터</button></div>}
          <div className="fr-toasts">{toasts.map((t) => <div key={t.id} className="fr-toast" onClick={() => { t.onClick?.(); setToasts((x) => x.filter((y) => y.id !== t.id)) }}>{t.text}</div>)}</div>
          {hints && <HintBox s={s} up={up} onClose={() => setHints(false)} />}
          {askRestart && (
            <div className="fr-modal" onClick={() => setAskRestart(false)}><div className="fr-dlg" onClick={(e) => e.stopPropagation()}>
              <div className="dt">처음부터 다시 하기</div>
              <p>찾은 증거와 남은 시간이 모두 사라지고 인트로부터 다시 시작해요.</p>
              <div className="fr-btns"><button onClick={() => setAskRestart(false)}>취소</button><button className="pri" onClick={restart}>다시 하기</button></div>
            </div></div>
          )}
          {patrolMsg && (
            <div className="fr-modal"><div className="fr-dlg dark">
              <div className="dt">🚨 순찰</div>
              <p>복도 끝에서 발소리가 들린다. 보안팀이다.<br />누군가 이상하다고 연락한 모양이다.<br /><br />책상 밑에 숨어 숨을 죽였다. 손전등 불빛이 지나간다…<br /><b>5분이 흘렀다.</b></p>
              <div className="fr-btns"><button className="pri" onClick={() => setPatrolMsg(false)}>다시 모니터 앞으로</button></div>
            </div></div>
          )}
          {alertBox && (
            <div className="fr-modal" onClick={() => setAlertBox(null)}><div className="fr-dlg" onClick={(e) => e.stopPropagation()}>
              <div className="dt">{alertBox.title}</div><p className="pre">{alertBox.text}</p>
              <div className="fr-btns"><button className="pri" autoFocus onClick={() => setAlertBox(null)}>확인</button></div>
            </div></div>
          )}
        </div>
      </div>
    </GameCtx.Provider>
  )
}

function HintBox({ s, up, onClose }: { s: FrState; up: (fn: (d: FrState) => void) => void; onClose: () => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const list = s.login ? HINTS : [HINT_LOGIN]
  return (
    <div className="fr-modal" onClick={onClose}>
      <div className="fr-dlg hints" onClick={(e) => e.stopPropagation()}>
        <div className="dt">💡 힌트 <small>처음 본 단계만 힌트 횟수에 들어가요 · 지금 {hintCount(s)}번</small><button onClick={onClose}>✕</button></div>
        {s.login && <p className="hsub">찾아야 할 증거 7개예요. 막힌 증거를 눌러 한 단계씩 보세요. <b>{s.ev.length} / 7</b> 찾음</p>}
        <div className="hl">
          {list.map((h) => {
            const seen = h.steps.filter((_, i) => s.hintsSeen[`${h.id}.${i}`]).length
            const found = 'ev' in h && s.ev.includes(h.ev as EvId)
            return (
              <div key={h.id} className={'hi' + (open === h.id ? ' on' : '') + (found ? ' found' : '')}>
                <button className="hh" onClick={() => setOpen(open === h.id ? null : h.id)}>{found ? '✔ ' : ''}{h.title}<span>{found ? '찾음' : seen ? `힌트 ${seen}/${h.steps.length}` : ''}</span></button>
                {open === h.id && (
                  <ol>
                    {h.steps.map((t, i) => (
                      s.hintsSeen[`${h.id}.${i}`] ? <li key={i}>{t}</li>
                        : i === seen ? <li key={i}><button onClick={() => up((d) => { d.hintsSeen[`${h.id}.${i}`] = true })}>{i + 1}단계 힌트 보기</button></li> : null
                    ))}
                  </ol>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ResultCard({ s, onRestart, onLobby }: { s: FrState; onRestart: () => void; onLobby: () => void }) {
  const g = s.grade!
  const sec = Math.round(Math.min(s.sentAt ?? s.ms, LIMIT_MS) / 1000)
  const [nick, setNick] = useState(loadNickname())
  const [copied, setCopied] = useState(false)
  const rival = loadRival()
  const cmp = rival ? compare({ t: sec, g }, rival) : 0
  const ok = g === 'S' || g === 'A'
  return (
    <div className="fr-result">
      <div className="card">
        <div className={'gr g' + g}>{g}</div>
        <h2>{GRADE_NAME[g]}</h2>
        <div className="stats">
          <div>걸린 시간<b>{s.sentAt !== undefined ? fmtSec(sec) : '시간 초과'}</b></div>
          <div>찾은 증거<b>{s.ev.length} / 7</b></div>
          <div>반박 · 근거<b>{s.sentAt !== undefined ? `${rebutted(s)}/5 · ${proved(s)}/2` : '-'}</b></div>
          <div>힌트<b>{hintCount(s) ? `${hintCount(s)}번` : '안 씀'}</b></div>
        </div>
        <p className="muted">{ok ? '진범 박 팀장, 예약 메일 ' + (s.cancelled ? '취소 성공' : '그대로 발송') : g === 'C' ? '진범을 잘못 지목했어요' : g === 'B' ? '반박하지 못한 사유가 남았어요' : '3시까지 소명서를 못 보냈어요'}</p>
        {s.sentAt !== undefined && (
          <div className="rb">
            {[...CHARGES, ...PROOFS].map((c) => {
              const e = s.slots[c.n]
              const okk = !!e && c.ok.includes(e)
              const ev = EVIDENCE.find((x) => x.id === e)
              return <div key={c.n}><b className={okk ? 'o' : 'x'}>{okk ? '✔' : '✕'}</b><span>{c.n > 5 ? `진범 ${c.basis}: ${c.title}` : `${c.n}. ${c.title}`}<small>{ev ? `${ev.ico} ${ev.name}${okk ? '' : ' — 이 증거로는 반박되지 않음'}` : '증거를 붙이지 않음'}</small></span></div>
            })}
            <div><b className={s.culprit === 'park' ? 'o' : 'x'}>{s.culprit === 'park' ? '✔' : '✕'}</b><span>지목한 진짜 사용자: {SUSPECTS.find((p) => p.id === s.culprit)?.name}<small>{s.culprit === 'park' ? '7730 카드 주인이자 보고서를 고친 사람' : '정답은 박○○ 팀장 (7730 카드 주인, 보고서를 고친 사람)'}</small></span></div>
          </div>
        )}
        {rival && <p className="cmp">{rival.n} 님 {GRADE_NAME[rival.g]} {fmtSec(rival.t)} vs 나 → {cmp > 0 ? '내가 이겼어요!' : cmp < 0 ? '아쉽게 졌어요' : '무승부'}</p>}
        <div className="share">
          <input value={nick} maxLength={10} placeholder="닉네임" onChange={(e) => { setNick(e.target.value); setCopied(false) }} />
          <button disabled={!nick.trim()} onClick={async () => {
            saveNickname(nick.trim())
            await copyText(`누명 탈출 ${g} 「${GRADE_NAME[g]}」 증거 ${s.ev.length}/7 · ${fmtSec(sec)}\n${resultUrl(nick, sec, hintCount(s), g, s.ev.length)}`)
            setCopied(true); track('share_result', { game_id: 'framed' })
          }}>{copied ? '✔ 복사했어요' : '자랑 링크 복사'}</button>
        </div>
        <div className="fr-btns"><button onClick={onLobby}>로비로</button><button className="pri" onClick={onRestart}>처음부터 다시 하기</button></div>
      </div>
    </div>
  )
}
