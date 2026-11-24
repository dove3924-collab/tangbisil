import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { track } from '../lib/analytics'
import { api, ApiError, type RoomFull } from '../lib/api'
import { COLORS as PEOPLE_COLORS } from '../lib/colors'
import { useCableVs } from '../hooks/useCableVs'
import { fmtMs } from '../puzzle/common'
import { ICONS } from '../shapes/Play'
import { LEVELS, battleBoards, connected, isPc, rotCCW, rotCW, solved, type Board } from './logic'
import type { CbvPuzzle, CbvState } from './vs'
import { Tile } from './CableGame'
import '../shapes/shapes.css'
import { useCableKeys } from './keys'
import './cable.css'

const FILE_NAME = '본사_네트워크_구성도_공동편집.vsdx'
const TEAMS = ['영업2팀', '마케팅팀', '재무팀', '인사팀']
const TITLES = ['본사 3층 네트워크 구성도', '신사옥 4층 랜 배선도', '회의실 무선 AP 연결안', '재택 VPN 우회 경로 (안)', '전산실 랙 재배선 계획']
const secLeft = (ms: number) => Math.max(0, Math.ceil(ms / 1000))
const toBoard = (p: CbvPuzzle, cells?: number[]): Board => ({ ...p, cells: cells ?? p.cells, locked: Array(p.cells.length).fill(false), turns: 0, sol: [] })

function useCellSize(w: number, h: number) {
  const pick = () => Math.max(28, Math.min(60, Math.floor(Math.min((window.innerWidth - (window.innerWidth > 1000 ? 580 : 70)) / w, (window.innerHeight - 300) / h))))
  const [cs, setCs] = useState(pick)
  useEffect(() => { const f = () => setCs(pick()); f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [w, h]) // eslint-disable-line react-hooks/exhaustive-deps
  return cs
}

function BoardSvg({ b, cs, onTurn, onLock, spins, cursor, onPick }: { b: Board; cs: number; onTurn?: (i: number, dir: 'cw' | 'ccw') => void; onLock?: (i: number) => void; spins?: Record<number, { n: number; dir: 'cw' | 'ccw' }>; cursor?: number | null; onPick?: (i: number) => void }) {
  const on = connected(b)
  return (
    <svg className="cb-board" width={b.w * cs} height={b.h * cs} onContextMenu={(e) => e.preventDefault()}>
      {b.cells.map((m, i) => {
        const sp = spins?.[i]
        return (
          <g key={`${i}-${sp?.n ?? 0}`} className={onTurn ? 'cb-cell' + (b.locked[i] ? ' locked' : '') : ''}
            onClick={onTurn ? (e) => { onPick?.(i); if (e.shiftKey) onLock?.(i); else onTurn(i, 'cw') } : undefined}
            onContextMenu={onTurn ? (e) => { e.preventDefault(); onPick?.(i); onTurn(i, 'ccw') } : undefined}>
            <Tile m={m} x={(i % b.w) * cs} y={Math.floor(i / b.w) * cs} cs={cs} lit={on[i]} server={i === b.server} pc={isPc(b, i)} locked={b.locked[i]} spin={sp ? `spin-${sp.dir}` : ''} />
          </g>
        )
      })}
      {cursor != null && <rect pointerEvents="none" x={(cursor % b.w) * cs + 2} y={Math.floor(cursor / b.w) * cs + 2} width={cs - 4} height={cs - 4} rx={4} fill="none" stroke="#f0a500" strokeWidth={3} />}
    </svg>
  )
}

function Chat({ state, me, name, onSend }: { state: CbvState; me: string; name: (id: string | null) => string; onSend: (t: string) => void }) {
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
        <input className="cbv-chat-in" value={text} maxLength={200} placeholder="Enter로 대화 · 빈 칸 Enter·Esc로 게임" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape' || (e.key === 'Enter' && !e.nativeEvent.isComposing && !text.trim())) { e.preventDefault(); (e.target as HTMLInputElement).blur() } }} />
      </form>
    </div>
  )
}

export default function CableVsGame({ room }: { room: RoomFull }) {
  const nav = useNavigate()
  const me = room.me
  const isHost = room.hostId === me
  const active = new Set(room.players.map((p) => p.id))
  const { state, error, refresh, poke, serverNow } = useCableVs(room.code, room.players.length)
  const [toast, setToast] = useState('')
  const [help, setHelp] = useState(false)
  const [spins, setSpins] = useState<Record<number, { n: number; dir: 'cw' | 'ccw' }>>({})
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? '' : t)), 2400) }

  // 이번 라운드 내 판 (새로고침해도 이어지게 세션에 보관)
  const roundKey = state && state.puzzle ? `wollu.cbv.${room.code}.${state.roundNo}.${state.round}` : null
  const [local, setLocal] = useState<{ key: string; b: Board } | null>(null)
  useEffect(() => {
    if (!roundKey || !state?.puzzle || local?.key === roundKey) return
    let b: Board | null = null
    try { b = JSON.parse(sessionStorage.getItem(roundKey) ?? 'null') } catch { /* 새로 */ }
    setLocal({ key: roundKey, b: b ?? toBoard(state.puzzle) })
    setSpins({})
  }, [roundKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const b = local && local.key === roundKey ? local.b : null
  const setB = (fn: (b: Board) => Board) => setLocal((l) => {
    if (!l) return l
    const next = { ...l, b: fn(l.b) }
    try { sessionStorage.setItem(l.key, JSON.stringify(next.b)) } catch { /* 무시 */ }
    return next
  })
  const cs = useCellSize(state?.puzzle?.w ?? b?.w ?? 7, state?.puzzle?.h ?? b?.h ?? 6)

  const started = !!state && serverNow >= new Date(state.startedAt).getTime()
  const playing = !!state && state.phase === 'play' && started
  const locked = !playing || !state?.inGame || !active.has(me)
  const turn = (i: number, dir: 'cw' | 'ccw') => {
    if (locked || !b || b.locked[i]) return
    setB((x) => ({ ...x, turns: x.turns + 1, cells: x.cells.map((m, k) => (k === i ? (dir === 'cw' ? rotCW(m) : rotCCW(m)) : m)) }))
    setSpins((s) => ({ ...s, [i]: { n: (s[i]?.n ?? 0) + 1, dir } }))
  }
  const toggleLock = (i: number) => { if (!locked) setB((x) => ({ ...x, locked: x.locked.map((l, k) => (k === i ? !l : l)) })) }
  const keys = useCableKeys({ w: b?.w ?? 1, h: b?.h ?? 1, server: b?.server ?? 0, resetKey: roundKey ?? '', enabled: !locked && !!b, turn, lock: toggleLock })

  // 진행 보내기 (연결된 PC 수)
  const pcCount = (x: Board) => { const on = connected(x); return x.cells.filter((_, i) => isPc(x, i) && on[i]).length }
  const sentRef = useRef('')
  useEffect(() => {
    if (!state || !b || !playing) return
    const n = pcCount(b)
    const sig = `${roundKey}|${n}`
    if (sig === sentRef.current) return
    const t = window.setTimeout(async () => {
      sentRef.current = sig
      try { await api.cbvProgress(room.code, state.round, n); poke() } catch { /* 다음에 */ }
    }, 250)
    return () => window.clearTimeout(t)
  }, [b, playing]) // eslint-disable-line react-hooks/exhaustive-deps

  // 다 이으면 서버에 완료
  const doneRef = useRef('')
  useEffect(() => {
    if (!state || !b || !playing || !solved(b) || doneRef.current === roundKey) return
    doneRef.current = roundKey ?? ''
    api.cbvDone(room.code, state.round, b.cells)
      .then(async (r) => { if (r.ok) track('puzzle_clear', { game_id: 'cablevs', level: state.level, result: 'win', seconds: Math.round((r.ms ?? 0) / 1000) }); await refresh(); poke() })
      .catch((e) => { doneRef.current = ''; flash(e instanceof ApiError ? e.message : '전송하지 못했어요') })
  }, [b, playing]) // eslint-disable-line react-hooks/exhaustive-deps

  // Enter = 대화
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.key === 'Enter') { e.preventDefault(); document.querySelector<HTMLInputElement>('.cbv-chat-in')?.focus() }
      if (e.key === 'Escape') setHelp(false)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const leave = async () => {
    if (state?.phase === 'play' && !window.confirm('대결 중에 나가면 이번 대결에는 다시 들어올 수 없어요. 나갈까요?')) return
    try { await api.leaveRoom(room.code) } catch { /* 무시 */ }
    nav('/')
  }
  const restart = async () => { try { await api.cbvStart(room.code, battleBoards(state?.level ?? 'normal')); await refresh(); poke() } catch (e) { flash(e instanceof ApiError ? e.message : '시작하지 못했어요') } }
  const skip = async (vote: boolean) => { if (!state) return; try { await api.cbvSkip(room.code, state.round, vote); await refresh(); poke() } catch (e) { flash(e instanceof ApiError ? e.message : '실패했어요') } }
  const toWaiting = async () => { try { await api.cbvToWaiting(room.code) } catch (e) { flash(e instanceof ApiError ? e.message : '실패했어요') } }

  if (!state) return <div className="pptg cb"><p style={{ margin: 'auto' }}>{error || '구성도 불러오는 중…'}</p></div>

  const name = (id: string | null) => (id && state.people[id]?.nickname) || '?'
  const color = (id: string) => PEOPLE_COLORS[(state.people[id]?.color ?? 0) % PEOPLE_COLORS.length]
  const L = LEVELS[state.level]
  const total = state.puzzle ? state.puzzle.cells.filter((_, i) => isPc(toBoard(state.puzzle!), i)).length : 1
  const last = state.last
  const startIn = serverNow < new Date(state.startedAt).getTime() ? new Date(state.startedAt).getTime() - serverNow : 0
  const showLast = !!last && state.phase === 'play' && startIn > 0 && last.round === state.round - 1
  const lastAt = last ? new Date(last.at).getTime() : 0
  const finalReveal = state.phase === 'result' && !!last && last.round === (state.result?.rounds ?? state.round) && serverNow < lastAt + 5000
  const reveal = showLast || finalReveal
  const revealLeft = showLast ? startIn : lastAt + 5000 - serverNow
  const nextLabel = finalReveal ? '최종 결과' : `${state.round}라운드`
  const title = TITLES[(state.round - 1) % TITLES.length]
  const myPcs = b ? pcCount(b) : 0

  const bar = (() => {
    if (reveal) {
      const msg = last!.winner ? `${name(last!.winner)} 님 연결 완료! +1점` : last!.reason === 'skip' ? '넘기기 · 정답 공개 (점수 없음)' : '무승부'
      return <div className={'sp-bar' + (last!.winner === me ? ' done' : ' cb-bar')}><span>{last!.winner ? '✔' : '－'}</span><b>{msg}</b><span className="sub">{secLeft(revealLeft)}초 뒤 {nextLabel}</span>{last!.ms !== null && <span className="tm">{fmtMs(last!.ms)}</span>}</div>
    }
    if (state.phase === 'result') return <div className="sp-bar done"><span>■</span><b>대결 종료</b><span className="sub">{state.winner ? `${name(state.winner)} 님 1위` : '승자 없음'} · {state.result?.rounds ?? state.round}라운드</span></div>
    if (startIn > 0) return <div className="sp-bar cb-bar"><span>👥</span><b>{state.round}라운드 준비</b><span className="sub">{L.label} {L.w}×{L.h} · {state.target}점 먼저 승리</span><span className="tm">{secLeft(startIn)}</span></div>
    const votes = state.skipVotes ?? []
    const liveIds = state.playerIds.filter((id) => active.has(id))
    if (votes.length > 0 && state.inGame) {
      const mine = votes.includes(me)
      return <div className="sp-bar skip"><span>🏳</span><b>{name(votes[0])} 님이 이 판 넘기기를 제안했어요</b>
        <span className="sub">동의 {votes.filter((v) => active.has(v)).length}/{liveIds.length} · 모두 동의하면 정답 공개 후 다음 판</span>
        {mine ? <><span className="wait">다른 사람 동의 기다리는 중…</span><button onClick={() => skip(false)}>취소</button></>
          : <><button className="ok" onClick={() => skip(true)}>동의</button><button onClick={() => skip(false)}>계속 할래요</button></>}</div>
    }
    return <div className="sp-bar cb-bar"><span>🔌</span><b>{state.round}라운드</b><span className="sub">같은 구성도를 먼저 다 이으면 1점 · 연결된 PC {myPcs} / {total} · 못 풀겠으면 [넘기기]</span>
      <span className="tm">⏱ {fmtMs(serverNow - new Date(state.startedAt).getTime())}</span></div>
  })()

  return (
    <div className="pptg sv cb">
      <div className="sp-title"><span className="sp-logo">V</span><span className="sp-tmid">{FILE_NAME} — 공동 편집 중</span>
        <span className="sv-avs">{state.playerIds.map((id) => <i key={id} className={active.has(id) ? '' : 'off'} style={{ background: color(id) }}>{[...name(id)][0]}</i>)}</span>
        <button className="sp-leave" onClick={leave}>나가기</button></div>
      <div className="sp-tabs">{['파일', '홈', '삽입', '디자인', '검토'].map((t) => <span key={t}>{t}</span>)}<span className="on">연결선</span><span>보기</span></div>
      <div className="sp-ribbon">
        <div className="grp"><div className="bs">
          <button className="tb" disabled={!playing || !state.inGame || (state.skipVotes ?? []).includes(me)} onClick={() => skip(true)}><span className="ic">{ICONS.skip}</span>넘기기 제안</button>
          <button className="tb" disabled={locked || !b?.locked.some(Boolean)} onClick={() => setB((x) => ({ ...x, locked: x.locked.map(() => false) }))}><span className="ic">🔓</span>잠금 모두 해제</button>
          <button className="tb" onClick={() => setHelp(true)}><span className="ic">{ICONS.help}</span>조작법</button>
        </div><b>진행</b></div>
        <div className="grp hide-sm"><div className="bs cb-legend"><span>클릭·E = 시계 90° · 우클릭·Q = 반시계</span><span>방향키·WASD = 칸 옮기기</span><span>Shift+클릭·Space = 잠그기</span></div><b>조작</b></div>
      </div>
      {bar}

      <div className="sp-main">
        <div className="sp-thumbs sv-thumbs">
          <div className="thl">공동 편집자</div>
          {state.playerIds.map((id, i) => {
            const n = Math.min(state.progress[id]?.placed ?? 0, total)
            const fin = reveal && last?.winner === id && last.reason === 'done'
            return (
              <div key={id} className={'th' + (id === me ? ' on' : '') + (active.has(id) ? '' : ' gone')}>
                <i>{i + 1}</i>
                <div className={'svb' + (fin ? ' fin' : '')}>
                  <div className="nm"><span>{name(id)}{id === me ? ' (나)' : ''}</span><em>{state.points[id] ?? 0}점</em></div>
                  {(state.phase === 'play' || reveal) && <div className="row">
                    <div className="pg"><i style={{ width: `${reveal ? (fin ? 100 : 0) : Math.round((n / total) * 100)}%` }} /></div>
                    <span className="pc">{!active.has(id) ? '나감' : fin ? '완성' : reveal ? '' : `PC ${n}/${total}`}</span>
                  </div>}
                </div>
              </div>
            )
          })}
        </div>

        <div className="sp-stage">
          {reveal ? (
            <div className="sp-slide cb-page">
              <h1>{TITLES[(last!.round - 1) % TITLES.length]}</h1>
              <p className="lead">{last!.winner ? `${name(last!.winner)} 님의 완성본` : last!.reason === 'skip' ? '정답 — 모두 동의해서 넘어갔어요' : '이번 라운드는 아무도 다 잇지 못했어요'}</p>
              <div className="rule" />
              <div className="sv-last">
                <BoardSvg b={toBoard(last!.puzzle, last!.occ ?? undefined)} cs={Math.min(cs, 44)} />
                <table><tbody>
                  {[...last!.ranks].sort((x, y) => (y.id === last!.winner ? 1 : 0) - (x.id === last!.winner ? 1 : 0) || y.placed - x.placed).map((r, k) => (
                    <tr key={r.id} className={r.id === me ? 'me' : ''}>
                      <td>{k === 0 && last!.winner ? <span className="medal g1">1</span> : k + 1}</td>
                      <td>{name(r.id)}{r.id === me ? ' (나)' : ''}</td>
                      <td className="t">{r.id === last!.winner ? `${fmtMs(last!.ms ?? 0)} · +1점` : `PC ${Math.min(r.placed, 999)}대 연결`}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
              <div className="sv-next">{nextLabel} {secLeft(revealLeft)}초 뒤{finalReveal ? '' : ' 시작'}</div>
              <div className="ft"><span>○○주식회사 · IT운영팀</span><span>{last!.round}</span></div>
            </div>
          ) : state.phase === 'result' ? (
            <div className="sp-slide sv-res">
              <h1>{state.winner ? `${TEAMS[state.playerIds.indexOf(state.winner)] ?? ''}(${name(state.winner)}), 네트워크 재배선 1위` : '네트워크 재배선 결과'}</h1>
              <p className="lead">{L.label} {L.w}×{L.h} · {state.result?.rounds ?? state.round}라운드 · {state.target}점 먼저</p>
              <div className="rule" />
              <table>
                <thead><tr><th>순위</th><th className="l">부서</th><th>점수</th><th>최고 기록</th><th>평균 완료</th><th>누적 우승</th></tr></thead>
                <tbody>
                  {[...state.playerIds].sort((x, y) => (state.result?.players[y]?.points ?? 0) - (state.result?.players[x]?.points ?? 0) || (state.result?.players[x]?.best ?? 1e9) - (state.result?.players[y]?.best ?? 1e9)).map((id, k) => {
                    const r = state.result?.players[id]
                    return (
                      <tr key={id} className={(id === state.winner ? 'w ' : '') + (id === me ? 'me' : '')}>
                        <td>{k < 3 ? <span className={'medal g' + (k + 1)}>{k + 1}</span> : k + 1}</td>
                        <td className="l"><b>{TEAMS[state.playerIds.indexOf(id)]} {name(id)}</b>{id === me && ' (나)'}{!active.has(id) && <small> · 나감</small>}</td>
                        <td>{r?.points ?? 0}점</td><td>{r?.best != null ? fmtMs(r.best) : '-'}</td><td>{r?.avg != null ? fmtMs(r.avg) : '-'}</td><td>{state.scores[id] ?? 0}회</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="sv-btns">{isHost ? <><button className="o" onClick={toWaiting}>대기실로</button><button onClick={restart}>다시 하기</button></> : <span className="dim">방장이 다음 대결을 정할 때까지 기다려 주세요</span>}</div>
              <div className="ft"><span>○○주식회사 · IT운영팀</span><span>{state.round}</span></div>
            </div>
          ) : (
            <div className="sp-slide cb-page">
              <h1>{title}</h1>
              <p className="lead">IT운영팀 · 케이블 재배선 계획 (안) · 먼저 다 이으면 1점</p>
              <div className="rule" />
              {b && <div className={startIn > 0 ? 'sv-hide' : ''}><BoardSvg b={b} cs={cs} onTurn={turn} onLock={toggleLock} spins={spins} cursor={keys.show ? keys.cursor : null} onPick={keys.setCursor} /></div>}
              {startIn > 0 && <div className="sv-count">{secLeft(startIn)}</div>}
              {!state.inGame && <div className="sv-count small">이번 대결은 구경 중이에요</div>}
              <div className="ft"><span>○○주식회사 · IT운영팀</span><span>{state.round}</span></div>
            </div>
          )}
        </div>

        <div className="sv-side">
          <div className="sv-kpi cb-kpi2">
            <small>{state.phase === 'result' ? '최종 점수' : `${state.round}라운드 · ${state.target}점 먼저 승리`}</small>
            <div className="big">{state.playerIds.map((id) => state.points[id] ?? 0).join(' : ')}</div>
            <div className="sc">{state.playerIds.map((id, i) => <div key={id} className={id === me ? 'me' : ''}><span>{TEAMS[i]} {name(id)}</span><b>{state.points[id] ?? 0}점</b></div>)}</div>
          </div>
          <Chat state={state} me={me} name={name} onSend={(t) => { void api.cbvChat(room.code, t).then(() => { void refresh(); poke() }).catch(() => flash('보내지 못했어요')) }} />
        </div>
      </div>
      <div className="sp-status"><span>페이지 {state.round}</span><span>한국어</span><span className="sp-sp" /><span className="hide-sm">방향키·WASD 이동 · Q·E 회전 · Space 잠그기 · Enter 대화</span></div>
      {help && (
        <div className="sp-dlg-wrap" onPointerDown={() => setHelp(false)}>
          <div className="sp-dlg" onPointerDown={(e) => e.stopPropagation()}>
            <div className="hd">조작법<button onClick={() => setHelp(false)}>✕</button></div>
            <table><tbody>
              <tr><th>목표</th><td>모두 같은 구성도를 받아요. 칸을 돌려서 서버와 모든 PC를 먼저 다 이으면 1점.</td></tr>
              <tr><th>돌리기</th><td>클릭 또는 <kbd>E</kbd> = 시계방향 90° · 우클릭 또는 <kbd>Q</kbd> = 반시계</td></tr>
              <tr><th>칸 옮기기</th><td>방향키 또는 <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> · 잠그기는 Shift+클릭 또는 <kbd>Space</kbd></td></tr>
              <tr><th>넘기기</th><td>못 풀겠으면 [넘기기 제안] → 모두 동의하면 정답을 보여주고 점수 없이 다음 판</td></tr>
              <tr><th>대화</th><td><kbd>Enter</kbd>로 열고 보내기 · 빈 칸에서 Enter나 Esc면 게임으로</td></tr>
            </tbody></table>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
