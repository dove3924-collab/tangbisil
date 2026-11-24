import { useEffect, useRef, useState, type FormEvent, type PointerEvent as RPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, type RoomFull } from '../lib/api'
import { useAlkkagi } from '../hooks/useAlkkagi'
import { EDGE_MAX, EDGE_MIN, MIN_GAP, R, Sim, VMAX, inZone, linePositions, randomPositions, round4, type Stone } from './physics'
import type { AlkShot, AlkState } from './types'
import { ICONS } from '../shapes/Play'
import '../shapes/shapes.css'
import './alkkagi.css'

const FILE_NAME = '3분기_실적보고_공동작업.pptx'
const TEAMS = ['영업2팀', '마케팅팀']
const SIDE_COLOR = ['#4472c4', '#ed7d31']
const SIDE_NAME = ['파랑', '주황']
const MAX_PULL = 4 // 끝까지 당기는 거리 (칸)
const SPAN = EDGE_MAX - EDGE_MIN
const secLeft = (ms: number) => Math.max(0, Math.ceil(ms / 1000))

function useBoardSize() {
  const pick = () => Math.max(280, Math.min(640, window.innerHeight - 250, window.innerWidth - (window.innerWidth > 1000 ? 640 : 40)))
  const [s, setS] = useState(pick)
  useEffect(() => { const f = () => setS(pick()); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])
  return s
}

function Chat({ state, me, name, onSend }: { state: AlkState; me: string; name: (id: string | null) => string; onSend: (t: string) => void }) {
  const [text, setText] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight }, [state.chats.length])
  const send = (e: FormEvent) => { e.preventDefault(); const t = text.trim(); if (t) { onSend(t); setText('') } }
  return (
    <div className="sv-chat">
      <div className="h">대화</div>
      <div className="b" ref={box}>
        {state.chats.map((m) => <div key={m.id} className={m.userId === null ? 'sys' : m.userId === me ? 'me' : ''}>{m.userId !== null && <b>{name(m.userId)}</b>}{m.body}</div>)}
      </div>
      <form onSubmit={send}>
        <input className="alk-chat-in" value={text} maxLength={200} placeholder="Enter로 대화 · 빈 칸 Enter·Esc로 게임" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape' || (e.key === 'Enter' && !e.nativeEvent.isComposing && !text.trim())) { e.preventDefault(); (e.target as HTMLInputElement).blur() } }} />
      </form>
    </div>
  )
}

interface Aim { stone: number; sx: number; sy: number; x: number; y: number }
interface PlaceDrag { idx: number | null; x: number; y: number } // idx null = 대기 칸에서 새 돌

export default function AlkkagiGame({ room }: { room: RoomFull }) {
  const nav = useNavigate()
  const me = room.me
  const isHost = room.hostId === me
  const active = new Set(room.players.map((p) => p.id))
  const { state, error, refresh, poke, serverNow } = useAlkkagi(room.code, room.players.length)
  const S = useBoardSize()
  const u = S / SPAN
  const [toast, setToast] = useState('')
  const [help, setHelp] = useState(false)
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? '' : t)), 2400) }
  const svgRef = useRef<SVGSVGElement>(null)

  const side = state?.me ?? 0 // 내 진영 (구경꾼은 0쪽에서 봄)
  const flip = side === 1
  // 판 좌표 ↔ 화면 (내 진영이 항상 아래)
  const toPx = (x: number, y: number): [number, number] => { const vx = flip ? 18 - x : x, vy = flip ? 18 - y : y; return [(vx - EDGE_MIN) * u, (vy - EDGE_MIN) * u] }
  const fromClient = (cx: number, cy: number): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect()
    const vx = (cx - r.left) / u + EDGE_MIN, vy = (cy - r.top) / u + EDGE_MIN
    return flip ? [18 - vx, 18 - vy] : [vx, vy]
  }

  // ── 애니메이션 (발사 결과를 모두가 같은 계산으로 굴림) ──
  const [anim, setAnim] = useState<{ seq: number; stones: Stone[]; outs: { id: number; x: number; y: number }[] } | null>(null)
  const animSeq = useRef<number | null>(null)
  const [shotMsg, setShotMsg] = useState<{ seq: number; until: number; text: string; good: boolean } | null>(null)
  const play = (seq: number, before: Stone[], shot: { stone: number; vx: number; vy: number }, msg?: { text: string; good: boolean }) => {
    animSeq.current = seq
    const sim = new Sim(before, shot)
    let last = performance.now()
    let acc = 0
    const tick = (now: number) => {
      acc += Math.min(0.1, (now - last) / 1000); last = now
      while (acc >= 1 / 240 && sim.moving) { sim.step(); acc -= 1 / 240 }
      setAnim({ seq, stones: sim.result(), outs: sim.outAt })
      if (sim.moving) requestAnimationFrame(tick)
      else window.setTimeout(() => { setAnim((a) => (a && a.seq === seq ? null : a)); if (msg) setShotMsg({ seq, until: Date.now() + 2500, ...msg }) }, 500)
    }
    requestAnimationFrame(tick)
  }
  const animating = !!anim
  // 다른 사람이 쏜 것 (또는 새로고침) → 굴리기
  useEffect(() => {
    if (!state) return
    if (animSeq.current === null) { animSeq.current = state.seq; return } // 처음 열었을 때 지난 발사는 다시 안 굴림
    const l = state.last
    if (!l || l.skip || l.seq <= animSeq.current) { if (state.seq > (animSeq.current ?? 0)) animSeq.current = state.seq; return }
    const shot = l as AlkShot
    play(shot.seq, shot.before, shot, shotText(shot))
  }, [state?.seq, state?.gameNo]) // eslint-disable-line react-hooks/exhaustive-deps

  const name = (id: string | null) => (id && state?.people[id]?.nickname) || '?'
  const shotText = (shot: AlkShot) => {
    const mine = shot.by === me
    if (shot.knocked && shot.lost) return { text: `${name(shot.by)} 님 · 상대 ${shot.knocked}개 OUT, 자기 ${shot.lost}개 OUT`, good: mine }
    if (shot.knocked) return { text: `${name(shot.by)} 님 명중! 상대 도형 ${shot.knocked}개 OUT`, good: mine }
    if (shot.lost) return { text: `${name(shot.by)} 님 자기 도형 ${shot.lost}개 OUT`, good: !mine }
    return { text: `${name(shot.by)} 님 · 빗나감`, good: !mine }
  }

  // ── 조준·발사 ──
  const [aim, setAim] = useState<Aim | null>(null)
  const myTurn = !!state && state.phase === 'play' && state.me !== null && state.turn === state.me && !animating
  const pull = (a: Aim) => {
    let dx = (a.sx - a.x) / u, dy = (a.sy - a.y) / u // 당긴 반대 방향 = 날아가는 방향 (화면 기준)
    const len = Math.sqrt(dx * dx + dy * dy)
    const k = len > MAX_PULL ? MAX_PULL / len : 1
    dx *= k; dy *= k
    const power = Math.min(1, len / MAX_PULL)
    return { dx, dy, power, vx: flip ? -dx : dx, vy: flip ? -dy : dy }
  }
  const onStoneDown = (s: Stone) => (e: RPointerEvent) => {
    if (!myTurn || s.owner !== state!.me || s.out) return
    e.preventDefault()
    const a = document.activeElement as HTMLElement | null
    if (a && a.matches('input, textarea')) a.blur()
    setAim({ stone: s.id, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY })
  }
  const aimRef = useRef(aim)
  aimRef.current = aim
  useEffect(() => {
    if (!aim) return
    const move = (e: PointerEvent) => setAim((a) => a && { ...a, x: e.clientX, y: e.clientY })
    const up = () => {
      const a = aimRef.current
      setAim(null)
      if (!a || !state) return
      const p = pull(a)
      if (p.power < 0.08) return
      const len = Math.sqrt(p.vx * p.vx + p.vy * p.vy)
      const vx = round4((p.vx / len) * p.power * VMAX), vy = round4((p.vy / len) * p.power * VMAX)
      const before = state.stones
      const after = new Sim(before, { stone: a.stone, vx, vy }).run()
      const seq = state.seq + 1
      const knocked = after.filter((s, i) => s.out && !before[i].out && s.owner !== state.me).length
      const lost = after.filter((s, i) => s.out && !before[i].out && s.owner === state.me).length
      play(seq, before, { stone: a.stone, vx, vy }, shotText({ seq, by: me, stone: a.stone, vx, vy, before, after, knocked, lost }))
      api.alkShoot(room.code, state.seq, a.stone, vx, vy, after)
        .then(async (r) => { if (!r.ok) flash('이미 차례가 넘어갔어요'); await refresh(); poke() })
        .catch((e) => { flash(e instanceof ApiError ? e.message : '발사하지 못했어요'); void refresh() })
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setAim(null) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('keydown', key) }
  }, [!!aim]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 배치 ──
  const [pl, setPl] = useState<[number, number][]>([])
  const plRound = useRef('')
  const placing = !!state && state.phase === 'place' && state.me !== null
  const iDone = !!state && !!state.placeDone[me]
  useEffect(() => {
    if (!state || state.phase !== 'place') return
    const k = `${state.gameNo}.${state.round}`
    if (plRound.current === k) return
    plRound.current = k
    setPl(state.myPlace ?? [])
  }, [state?.phase, state?.round, state?.gameNo]) // eslint-disable-line react-hooks/exhaustive-deps
  // 놓을 때마다 저장 (시간이 끝나도 놓은 자리는 남게)
  const doneSent = useRef('') // 배치 완료를 보낸 판 (그 뒤엔 '진행 중' 저장을 안 보냄)
  useEffect(() => {
    if (!placing || iDone || !state || doneSent.current === plRound.current) return
    const t = window.setTimeout(() => { if (doneSent.current !== plRound.current) void api.alkPlace(room.code, state.round, pl, false).catch(() => {}) }, 300)
    return () => window.clearTimeout(t)
  }, [pl]) // eslint-disable-line react-hooks/exhaustive-deps
  const okSpot = (list: [number, number][], x: number, y: number, skip: number | null) =>
    inZone(side as 0 | 1, x, y) && list.every(([a, b], i) => i === skip || Math.hypot(a - x, b - y) >= MIN_GAP)
  const [pd, setPd] = useState<PlaceDrag | null>(null)
  const pdRef = useRef(pd)
  pdRef.current = pd
  const startPlaceDrag = (idx: number | null) => (e: RPointerEvent) => {
    if (!placing || iDone) return
    e.preventDefault()
    setPd({ idx, x: e.clientX, y: e.clientY })
  }
  useEffect(() => {
    if (!pd) return
    const move = (e: PointerEvent) => setPd((d) => d && { ...d, x: e.clientX, y: e.clientY })
    const up = () => {
      const d = pdRef.current
      setPd(null)
      if (!d || !svgRef.current) return
      const r = svgRef.current.getBoundingClientRect()
      const inside = d.x >= r.left && d.x <= r.right && d.y >= r.top && d.y <= r.bottom
      const [x, y] = fromClient(d.x, d.y).map(round4) as [number, number]
      setPl((list) => {
        if (!inside) return d.idx === null ? list : list.filter((_, i) => i !== d.idx) // 판 밖으로 = 빼기
        if (!okSpot(list, x, y, d.idx)) { flash('파란 영역 안, 다른 도형과 겹치지 않게 놓아 주세요'); return list }
        if (d.idx === null) return list.length < state!.n ? [...list, [x, y]] : list
        return list.map((p, i) => (i === d.idx ? [x, y] : p))
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [!!pd]) // eslint-disable-line react-hooks/exhaustive-deps
  const placeDone = async () => {
    if (!state) return
    let list = pl.slice()
    for (const [x, y] of linePositions(state.n, side as 0 | 1)) if (list.length < state.n && okSpot(list, x, y, null)) list.push([x, y])
    if (list.length < state.n) list = linePositions(state.n, side as 0 | 1)
    doneSent.current = plRound.current
    setPl(list)
    try { await api.alkPlace(room.code, state.round, list, true); await refresh(); poke() } catch (e) { doneSent.current = ''; flash(e instanceof ApiError ? e.message : '저장하지 못했어요') }
  }

  // Enter = 대화
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.key === 'Enter') { e.preventDefault(); document.querySelector<HTMLInputElement>('.alk-chat-in')?.focus() }
      if (e.key === 'Escape') setHelp(false)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const leave = async () => {
    if (state && state.phase !== 'result' && !window.confirm('대결 중에 나가면 상대가 이겨요. 나갈까요?')) return
    try { await api.leaveRoom(room.code) } catch { /* 무시 */ }
    nav('/games')
  }
  const resign = async () => {
    if (!window.confirm('항복할까요? 상대가 이번 대결에서 이겨요.')) return
    try { await api.alkResign(room.code); await refresh(); poke() } catch (e) { flash(e instanceof ApiError ? e.message : '실패했어요') }
  }
  const restart = async () => { try { await api.alkStart(room.code); await refresh(); poke() } catch (e) { flash(e instanceof ApiError ? e.message : '시작하지 못했어요') } }
  const toWaiting = async () => { try { await api.alkToWaiting(room.code) } catch (e) { flash(e instanceof ApiError ? e.message : '실패했어요') } }

  if (!state) return <div className="pptg"><p style={{ margin: 'auto' }}>{error || '슬라이드 불러오는 중…'}</p></div>

  const shown: Stone[] = anim ? anim.stones : state.phase === 'place' ? [] : state.stones
  const placeStones: Stone[] = placing ? pl.map(([x, y], i) => ({ id: 100 + i, owner: side as 0 | 1, x, y, out: false })) : []
  const left = state.deadline ? new Date(state.deadline).getTime() - serverNow : null
  const meIdx = state.me
  const oppId = meIdx === null ? state.playerIds[1] : state.playerIds[1 - meIdx]
  const alive = (k: number) => (state.phase === 'place' ? state.n : shown.filter((s) => s.owner === k && !s.out).length)
  const a = aim ? pull(aim) : null
  const aimStone = aim ? shown.find((s) => s.id === aim.stone) : null
  const showResult = state.phase === 'result' && !animating
  const msg = shotMsg && shotMsg.until > Date.now() && !animating ? shotMsg : null

  // 위 알림 줄
  const bar = (() => {
    if (showResult) return <div className="sp-bar done"><span>■</span><b>대결 종료</b><span className="sub">{state.winner ? `${name(state.winner)} 님 승리` : '무승부'} · {state.result?.reason === 'resign' ? '항복' : state.result?.reason === 'alone' ? '상대가 나감' : `${state.result?.rounds ?? state.round}판`}</span></div>
    if (animating) return <div className="sp-bar race"><span>↻</span><b>굴러가는 중…</b></div>
    if (state.phase === 'between' && state.roundEnd) return <div className="sp-bar done"><span>✔</span><b>{state.roundEnd.round}판 · {state.roundEnd.winner ? `${name(state.roundEnd.winner)} 님 승리` : '무승부'}</b><span className="sub">{left !== null ? `${secLeft(left)}초 뒤 ${state.round + 1}판` : ''}</span></div>
    if (msg) return <div className={'sp-bar ' + (msg.good ? 'done' : 'skip')}><span>{msg.good ? '✔' : '✕'}</span><b>{msg.text}</b><span className="sub">{state.phase === 'play' ? (myTurn ? '이제 내 차례' : `${name(state.playerIds[state.turn])} 님 차례`) : ''}</span></div>
    if (state.phase === 'place') {
      if (meIdx === null) return <div className="sp-bar race"><span>✎</span><b>배치 시간</b><span className="sub">두 사람이 도형을 놓는 중</span>{left !== null && <span className="tm">{secLeft(left)}초</span>}</div>
      if (iDone) return <div className="sp-bar race"><span>✔</span><b>배치 완료</b><span className="sub">{name(oppId)} 님 배치를 기다리는 중 · 둘 다 끝나면 동시에 공개</span>{left !== null && <span className="tm">{secLeft(left)}초</span>}</div>
      return <div className="sp-bar skip"><span>✎</span><b>배치 시간</b><span className="sub">내 진영(파란 영역)에 도형 {state.n}개를 놓으세요 ({pl.length}/{state.n}) · 상대 배치는 시작할 때 공개</span>
        {left !== null && <span className="tm">{secLeft(left)}초</span>}
        <button onClick={() => setPl(linePositions(state.n, side as 0 | 1))}>기본 배치</button><button onClick={() => setPl(randomPositions(state.n, side as 0 | 1))}>무작위</button><button className="ok" onClick={placeDone}>배치 완료</button></div>
    }
    if (state.phase === 'play') {
      const pct = left !== null && state.turnSec ? Math.max(0, Math.min(100, (left / (state.turnSec * 1000)) * 100)) : null
      const timer = left !== null && <span className="tm">{secLeft(left)}초{pct !== null && <span className="alk-tbar"><i style={{ width: `${pct}%` }} /></span>}</span>
      if (myTurn) return <div className={'sp-bar mine' + (left !== null && left < 5000 ? ' urgent' : '')}><span>●</span><b>내 차례예요</b><span className="sub">{SIDE_NAME[side]} 도형을 잡고 뒤로 당겼다 놓으세요 · Esc 취소</span>{timer}</div>
      return <div className="sp-bar race"><span>○</span><b>{name(state.playerIds[state.turn])} 님 차례</b><span className="sub">조준하는 중…</span>{timer}</div>
    }
    return <div className="sp-bar race"><span>…</span><b>잠시만요</b></div>
  })()

  const stoneEl = (s: Stone, opts: { me?: boolean; drag?: () => (e: RPointerEvent) => void; faded?: boolean } = {}) => {
    const [px, py] = toPx(s.x, s.y)
    const sel = aim?.stone === s.id
    const can = opts.drag || (myTurn && s.owner === meIdx && !s.out)
    return (
      <g key={s.id} className={'alk-stone' + (can ? ' can' : '')} onPointerDown={opts.drag ? opts.drag() : onStoneDown(s)} opacity={opts.faded ? 0.35 : 1}>
        <circle cx={px} cy={py} r={R * u} fill={`url(#alk-g${s.owner})`} stroke="#fff" strokeWidth={1.5} />
        {sel && <rect x={px - R * u - 5} y={py - R * u - 5} width={2 * R * u + 10} height={2 * R * u + 10} fill="none" stroke="#555" />}
      </g>
    )
  }

  return (
    <div className="pptg alk">
      <div className="sp-title"><span className="sp-logo">P</span><span className="sp-tmid">{FILE_NAME} — 공동 작업 중</span>
        <span className="sv-avs">{state.playerIds.map((id, k) => <i key={id} className={active.has(id) ? '' : 'off'} style={{ background: SIDE_COLOR[k] }}>{[...name(id)][0]}</i>)}</span>
        <button className="sp-leave" onClick={leave}>나가기</button></div>
      <div className="sp-tabs">{['파일', '홈', '삽입', '디자인', '애니메이션', '보기'].map((t) => <span key={t}>{t}</span>)}<span className="on">도형 서식</span></div>
      <div className="sp-ribbon">
        <div className="grp"><div className="bs">
          <button className="tb" disabled={meIdx === null || state.phase === 'result'} onClick={resign}><span className="ic">{ICONS.skip}</span>항복</button>
          <button className="tb" onClick={() => setHelp(true)}><span className="ic">{ICONS.help}</span>조작법</button>
        </div><b>진행</b></div>
      </div>
      {bar}

      <div className="sp-main">
        <div className="sp-thumbs sv-thumbs">
          <div className="thl">공동 작업자</div>
          {state.playerIds.map((id, k) => (
            <div key={id} className={'th' + (k === meIdx ? ' on' : '') + (active.has(id) ? '' : ' gone')}>
              <i>{k + 1}</i>
              <div className="svb">
                <div className="nm"><span>{name(id)}{k === meIdx ? ' (나)' : ''}</span><em>{state.wins[id] ?? 0}승</em></div>
                <div className="alk-dots">{Array.from({ length: state.n }, (_, i) => <i key={i} className={i < alive(k) ? '' : 'x'} style={{ background: i < alive(k) ? SIDE_COLOR[k] : undefined }} />)}</div>
                <div className="alk-st">{state.phase === 'place' ? (state.placeDone[id] ? '배치 완료 ✔' : '배치 중') : state.phase === 'play' && state.turn === k && !animating ? '차례' : SIDE_NAME[k]}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="sp-stage">
          {showResult ? (
            <div className="sp-slide sv-res">
              <h1>{state.winner ? `${TEAMS[state.playerIds.indexOf(state.winner)]}(${name(state.winner)}), 조직도 정리 승리` : '조직도 정리 결과'}</h1>
              <p className="lead">{state.target === 1 ? '단판' : `${state.target * 2 - 1}판 ${state.target}선승`} · 도형 {state.n}개{state.result?.reason === 'resign' ? ' · 항복' : ''}</p>
              <div className="rule" />
              <table>
                <thead><tr><th>순위</th><th className="l">부서</th><th>판 승리</th><th>떨어뜨린 도형</th><th>잃은 도형</th><th>명중률</th><th>누적 우승</th></tr></thead>
                <tbody>
                  {[...state.playerIds].sort((x, y) => (x === state.winner ? -1 : y === state.winner ? 1 : 0)).map((id, k) => {
                    const r = state.result?.players[id]
                    return (
                      <tr key={id} className={(id === state.winner ? 'w ' : '') + (id === me ? 'me' : '')}>
                        <td>{k === 0 && state.winner ? <span className="medal g1">1</span> : k + 1}</td>
                        <td className="l"><b>{TEAMS[state.playerIds.indexOf(id)]} {name(id)}</b>{id === me && ' (나)'}</td>
                        <td>{r?.wins ?? 0}승</td><td>{r?.knocked ?? 0}개</td><td>{(r?.lost ?? 0) + 0}개</td>
                        <td>{r?.shots ? `${Math.round(((r.hits ?? 0) / r.shots) * 100)}%` : '-'}</td><td>{state.scores[id] ?? 0}회</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="sv-btns">{isHost ? <><button className="o" onClick={toWaiting}>대기실로</button><button onClick={restart}>다시 하기</button></> : <span className="dim">방장이 다음 대결을 정할 때까지 기다려 주세요</span>}</div>
              <div className="ft"><span>○○주식회사 · 대외비</span><span>{state.round}</span></div>
            </div>
          ) : (
            <div className="sp-slide alk-slide">
              <div className="alk-info">
                <h1>3분기 실적 보고</h1>
                <p className="lead">조직도 정리안{state.phase === 'place' ? ' — 배치' : ''}</p>
                <div className="rule" />
                {state.playerIds.map((id, k) => <div key={id} className="alk-lg"><i style={{ background: SIDE_COLOR[k] }} />{TEAMS[k]} {name(id)}{k === meIdx ? ' (나)' : ''}</div>)}
                {placing && !iDone ? (
                  <>
                    <p className="alk-note">파란 영역 안 아무 곳에나 놓으세요.<br />놓은 도형을 다시 끌면 옮겨지고, 판 밖으로 끌면 빠져요.</p>
                    <div className="alk-tray"><b>놓을 도형 {state.n - pl.length}개</b>
                      <div className="st">{Array.from({ length: state.n - pl.length }, (_, i) => <i key={i} style={{ background: SIDE_COLOR[side] }} onPointerDown={startPlaceDrag(null)} />)}</div>
                    </div>
                    <p className="alk-note dim">시간이 지나면 남은 도형은 기본 위치에 놓여요.</p>
                  </>
                ) : (
                  <>
                    <p className="alk-note">영역 밖으로 나간 도형은 삭제됩니다. 상대 도형을 모두 정리하면 이번 판 승리.</p>
                    <div className="alk-pow"><b>힘 {a ? Math.round(a.power * 100) : 0}%</b><div><i style={{ width: `${a ? a.power * 100 : 0}%` }} /></div>
                      <small>당긴 거리만큼 세게 · 끝까지 당겨도 판 길이의 1.5배까지만 굴러가요</small></div>
                    <p className="alk-note dim">{state.round}판 · {state.target === 1 ? '단판' : `${state.target}선승`}</p>
                  </>
                )}
              </div>
              <svg ref={svgRef} width={S} height={S} className="alk-board" onContextMenu={(e) => e.preventDefault()}>
                <defs>
                  <radialGradient id="alk-g0" cx=".35" cy=".35"><stop offset="0" stopColor="#8fb0e8" /><stop offset="1" stopColor="#4472c4" /></radialGradient>
                  <radialGradient id="alk-g1" cx=".35" cy=".35"><stop offset="0" stopColor="#f6b37a" /><stop offset="1" stopColor="#ed7d31" /></radialGradient>
                </defs>
                <rect x={1} y={1} width={S - 2} height={S - 2} fill="#fafbfd" stroke="#9fb0cc" strokeWidth={2} strokeDasharray="7 4" />
                {Array.from({ length: 19 }, (_, i) => {
                  const p = (i - EDGE_MIN) * u, a0 = (0 - EDGE_MIN) * u, a1 = (18 - EDGE_MIN) * u
                  return <g key={i}><line x1={p} y1={a0} x2={p} y2={a1} stroke="#e3e7ef" /><line x1={a0} y1={p} x2={a1} y2={p} stroke="#e3e7ef" /></g>
                })}
                {[3, 9, 15].flatMap((x) => [3, 9, 15].map((y) => <circle key={`${x},${y}`} cx={(x - EDGE_MIN) * u} cy={(y - EDGE_MIN) * u} r={2.5} fill="#c9d1e0" />))}
                {state.phase === 'place' && <>
                  {meIdx !== null && <rect x={2} y={(9.5 - EDGE_MIN) * u} width={S - 4} height={S - (9.5 - EDGE_MIN) * u - 2} fill={SIDE_COLOR[side]} opacity={0.08} />}
                  {meIdx !== null && <line x1={2} y1={(9.5 - EDGE_MIN) * u} x2={S - 2} y2={(9.5 - EDGE_MIN) * u} stroke={SIDE_COLOR[side]} strokeWidth={2} strokeDasharray="6 4" />}
                  <rect x={2} y={2} width={S - 4} height={(9.5 - EDGE_MIN) * u - 4} fill="#eef0f4" opacity={0.9} />
                  <text x={S / 2} y={(4 - EDGE_MIN) * u} textAnchor="middle" fontSize={15} fill="#8a93a8" fontWeight={700}>상대 진영 · 배치 중 (비공개)</text>
                  <text x={S / 2} y={(4 - EDGE_MIN) * u + 22} textAnchor="middle" fontSize={12} fill="#a0a8b8">{state.placeDone[oppId] ? `${name(oppId)} 님 배치 완료` : `${name(oppId)} 님 배치 중`} · 시작할 때 공개돼요</text>
                </>}
                {shown.filter((s) => !s.out).map((s) => stoneEl(s))}
                {placeStones.map((s, i) => (pd?.idx === i ? null : stoneEl(s, { drag: () => startPlaceDrag(i), faded: iDone })))}
                {anim?.outs.map((o) => { const [px, py] = toPx(Math.max(EDGE_MIN + 0.3, Math.min(EDGE_MAX - 0.3, o.x)), Math.max(EDGE_MIN + 0.6, Math.min(EDGE_MAX - 0.3, o.y))); return <text key={`o${o.id}`} x={px} y={py} textAnchor="middle" fontSize={12} fontWeight={700} fill="#c4302b">OUT</text> })}
                {a && aimStone && (() => {
                  const [px, py] = toPx(aimStone.x, aimStone.y)
                  const len = Math.sqrt(a.dx * a.dx + a.dy * a.dy) || 1
                  const ax = px + (a.dx / len) * a.power * 6 * u, ay = py + (a.dy / len) * a.power * 6 * u
                  return <g pointerEvents="none">
                    <line x1={px} y1={py} x2={px - a.dx * u} y2={py - a.dy * u} stroke="#555" strokeWidth={2} strokeDasharray="4 3" />
                    <circle cx={px - a.dx * u} cy={py - a.dy * u} r={4} fill="#555" />
                    <line x1={px} y1={py} x2={ax} y2={ay} stroke={SIDE_COLOR[side]} strokeWidth={3} />
                    <circle cx={ax} cy={ay} r={4} fill={SIDE_COLOR[side]} />
                  </g>
                })()}
              </svg>
              {state.phase === 'between' && state.roundEnd && !animating && (
                <div className="alk-over"><b>{state.roundEnd.round}판 · {state.roundEnd.winner ? `${name(state.roundEnd.winner)} 님 승리` : '무승부'}</b><span>{state.playerIds.map((id) => `${name(id)} ${state.wins[id] ?? 0}승`).join(' · ')}</span></div>
              )}
              <div className="ft"><span>○○주식회사 · 대외비</span><span>{state.round}</span></div>
            </div>
          )}
        </div>

        <div className="sv-side">
          <div className="sv-kpi">
            <small>{state.phase === 'result' ? '최종' : `${state.round}판 · ${state.target === 1 ? '단판' : `${state.target}선승`}`}</small>
            <div className="big">{state.playerIds.map((id) => state.wins[id] ?? 0).join(' : ')}</div>
            <div className="sc">{state.playerIds.map((id, k) => <div key={id} className={k === meIdx ? 'me' : ''}><span>{TEAMS[k]} {name(id)}</span><b>{state.wins[id] ?? 0}승</b></div>)}</div>
          </div>
          <Chat state={state} me={me} name={name} onSend={(t) => { void api.alkChat(room.code, t).then(() => { void refresh(); poke() }).catch(() => flash('보내지 못했어요')) }} />
        </div>
      </div>
      <div className="sp-status"><span>슬라이드 {state.round}</span><span>한국어</span><span className="sp-sp" /><span className="hide-sm">{state.phase === 'place' ? '끌어서 놓기 · 다시 끌어 옮기기' : '잡고 당겼다 놓기 · Esc 조준 취소'} · Enter 대화</span></div>
      {pd && <div className="alk-ghost" style={{ left: pd.x - R * u, top: pd.y - R * u, width: 2 * R * u, height: 2 * R * u, background: SIDE_COLOR[side] }} />}
      {help && (
        <div className="sp-dlg-wrap" onPointerDown={() => setHelp(false)}>
          <div className="sp-dlg" onPointerDown={(e) => e.stopPropagation()}>
            <div className="hd">조작법<button onClick={() => setHelp(false)}>✕</button></div>
            <table><tbody>
              <tr><th>배치</th><td>판마다 30초. 대기 칸의 도형을 끌어서 내 진영(파란 영역)에 놓기 · 다시 끌어 옮기기 · 판 밖으로 끌면 빼기 · [기본 배치] [무작위] [배치 완료]</td></tr>
              <tr><th>발사</th><td>내 도형을 잡고 뒤로 당겼다 놓기. 당긴 반대 방향으로, 당긴 만큼 세게 날아가요 · Esc 취소</td></tr>
              <tr><th>승부</th><td>영역 밖으로 나간 도형은 삭제 · 상대 도형을 모두 떨어뜨리면 그 판 승리 · 내 도형이 나가도 차례는 넘어가요</td></tr>
              <tr><th>대화</th><td><kbd>Enter</kbd>로 열고 보내기 · 빈 칸에서 Enter나 Esc면 게임으로</td></tr>
            </tbody></table>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
