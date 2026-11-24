import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { track } from '../lib/analytics'
import { api, ApiError, type RoomFull } from '../lib/api'
import { COLORS as PEOPLE_COLORS } from '../lib/colors'
import type { ShvState } from '../lib/shapevs'
import { useShapeVs } from '../hooks/useShapeVs'
import { fmtMs } from '../puzzle/common'
import { LEVELS, battlePuzzles, cellCount, solved, type Puzzle } from './logic'
import { COLORS, HelpDialog, ICONS, filledOf, useShapePlay } from './Play'
import { SLIDE_TITLES } from './ShapesGame'
import './shapes.css'

const FILE_NAME = '4분기_조직개편안_공동작업.pptx'
const TEAMS = ['영업2팀', '마케팅팀', '재무팀', '인사팀']
const secLeft = (ms: number) => Math.max(0, Math.ceil(ms / 1000))

/** 지난 라운드 1등의 배치 (정답처럼 공개) */
function SolvedBoard({ puz, occ, cs = 34 }: { puz: Puzzle; occ: number[] | null; cs?: number }) {
  return (
    <div className="sp-board" style={{ width: puz.w * cs, height: puz.h * cs }}>
      {puz.mask.map((m, i) => m && (
        <i key={i} className="slot" style={{
          left: (i % puz.w) * cs, top: Math.floor(i / puz.w) * cs, width: cs, height: cs,
          ...(occ && occ[i] >= 0 ? { background: COLORS[puz.color[occ[i]] ?? 0], outline: '1px solid #fff' } : {}),
        }} />
      ))}
    </div>
  )
}

function Chat({ state, me, name, onSend }: { state: ShvState; me: string; name: (id: string | null) => string; onSend: (t: string) => void }) {
  const [text, setText] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight }, [state.chats.length])
  // 보내면 바로 게임으로 (Q·E·A·D 가 대화창에 들어가지 않게)
  const send = (e: FormEvent) => { e.preventDefault(); const t = text.trim(); if (t) { onSend(t); setText('') }; (e.currentTarget as HTMLFormElement).querySelector('input')?.blur() }
  return (
    <div className="sv-chat">
      <div className="h">대화</div>
      <div className="b" ref={box}>
        {state.chats.map((m) => <div key={m.id} className={m.userId === null ? 'sys' : m.userId === me ? 'me' : ''}>{m.userId !== null && <b>{name(m.userId)}</b>}{m.body}</div>)}
      </div>
      <form onSubmit={send}>
        <input className="sv-chat-in" value={text} maxLength={200} placeholder="Enter로 대화 · 빈 칸 Enter·Esc로 게임" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape' || (e.key === 'Enter' && !e.nativeEvent.isComposing && !text.trim())) { e.preventDefault(); (e.target as HTMLInputElement).blur() } }} />
      </form>
    </div>
  )
}

export default function ShapesVsGame({ room }: { room: RoomFull }) {
  const nav = useNavigate()
  const me = room.me
  const isHost = room.hostId === me
  const active = new Set(room.players.map((p) => p.id))
  const { state, error, refresh, poke, serverNow } = useShapeVs(room.code, room.players.length)
  const [toast, setToast] = useState('')
  const [help, setHelp] = useState(false)
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? '' : t)), 2400) }

  // 이번 라운드 내 판 (새로고침해도 이어지게 세션에 보관)
  const roundKey = state && state.puzzle ? `wollu.shv.${room.code}.${state.roundNo}.${state.round}` : null
  const [local, setLocal] = useState<{ key: string; puz: Puzzle } | null>(null)
  useEffect(() => {
    if (!roundKey || !state?.puzzle || local?.key === roundKey) return
    let puz: Puzzle | null = null
    try { puz = JSON.parse(sessionStorage.getItem(roundKey) ?? 'null') } catch { /* 새로 */ }
    setLocal({ key: roundKey, puz: puz ?? { ...state.puzzle, sol: [], pieces: state.puzzle.pieces.map((p) => ({ ...p, at: null })) } })
  }, [roundKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const puz = local && local.key === roundKey ? local.puz : null
  const setPuz = useCallback((fn: (p: Puzzle) => Puzzle) => setLocal((l) => {
    if (!l) return l
    const next = { ...l, puz: fn(l.puz) }
    try { sessionStorage.setItem(l.key, JSON.stringify(next.puz)) } catch { /* 무시 */ }
    return next
  }), [])

  const started = !!state && serverNow >= new Date(state.startedAt).getTime()
  const playing = !!state && state.phase === 'play' && started
  const locked = !playing || !state?.inGame || !active.has(me)
  const play = useShapePlay(puz, setPuz, locked)

  // 진행 보내기 (놓을 때마다, 살짝 모아서)
  const sentRef = useRef('')
  useEffect(() => {
    if (!state || !puz || !playing) return
    const occ = filledOf(puz)
    const filled = occ.flatMap((v, i) => (v !== null ? [i] : []))
    const sig = `${roundKey}|${filled.join(',')}`
    if (sig === sentRef.current) return
    const t = window.setTimeout(async () => {
      sentRef.current = sig
      try { await api.shvProgress(room.code, state.round, filled, puz.pieces.filter((p) => p.at).length); poke() } catch { /* 다음에 */ }
    }, 200)
    return () => window.clearTimeout(t)
  }, [puz, playing]) // eslint-disable-line react-hooks/exhaustive-deps

  // 다 채우면 서버에 완료
  const doneRef = useRef('')
  useEffect(() => {
    if (!state || !puz || !playing || play.dragging || !solved(puz) || doneRef.current === roundKey) return
    doneRef.current = roundKey ?? ''
    const occ = filledOf(puz).map((v) => (v === null ? -1 : v))
    api.shvDone(room.code, state.round, occ)
      .then(async (r) => { if (r.ok) track('puzzle_clear', { game_id: 'shapevs', level: state.level, result: 'win', seconds: Math.round((r.ms ?? 0) / 1000) }); await refresh(); poke() })
      .catch((e) => { doneRef.current = ''; flash(e instanceof ApiError ? e.message : '전송하지 못했어요') })
  }, [puz, playing, play.dragging]) // eslint-disable-line react-hooks/exhaustive-deps

  // Enter = 대화 입력, 빈 칸 Enter·Esc = 게임으로
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.key === 'Enter') { e.preventDefault(); document.querySelector<HTMLInputElement>('.sv-chat-in')?.focus() }
      if (e.key === 'Escape') setHelp(false)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const leave = async () => {
    if (state?.phase === 'play' && !window.confirm('대결 중에 나가면 이번 대결에는 다시 들어올 수 없어요. 나갈까요?')) return
    try { await api.leaveRoom(room.code) } catch { /* 무시 */ }
    nav('/games')
  }
  const restart = async () => {
    try { await api.shvStart(room.code, battlePuzzles(state?.level ?? 'normal')); await refresh(); poke() } catch (e) { flash(e instanceof ApiError ? e.message : '시작하지 못했어요') }
  }
  const skip = async (vote: boolean) => {
    if (!state) return
    try { await api.shvSkip(room.code, state.round, vote); await refresh(); poke() } catch (e) { flash(e instanceof ApiError ? e.message : '실패했어요') }
  }
  const toWaiting = async () => { try { await api.shvToWaiting(room.code) } catch (e) { flash(e instanceof ApiError ? e.message : '실패했어요') } }

  if (!state) return <div className="pptg"><p style={{ margin: 'auto' }}>{error || '슬라이드 불러오는 중…'}</p></div>

  const name = (id: string | null) => (id && state.people[id]?.nickname) || '?'
  const color = (id: string) => PEOPLE_COLORS[(state.people[id]?.color ?? 0) % PEOPLE_COLORS.length]
  const L = LEVELS[state.level]
  const last = state.last
  const startIn = serverNow < new Date(state.startedAt).getTime() ? new Date(state.startedAt).getTime() - serverNow : 0
  const showLast = !!last && state.phase === 'play' && startIn > 0 && last.round === state.round - 1 // 라운드 사이
  // 마지막 라운드도 완성본을 5초 보여준 뒤 결과 슬라이드로
  const lastAt = last ? new Date(last.at).getTime() : 0
  const finalReveal = state.phase === 'result' && !!last && last.round === (state.result?.rounds ?? state.round) && serverNow < lastAt + 5000
  const reveal = showLast || finalReveal
  const revealLeft = showLast ? startIn : lastAt + 5000 - serverNow
  const nextLabel = finalReveal ? '최종 결과' : `${state.round}라운드`
  const title = SLIDE_TITLES[(state.round - 1) % SLIDE_TITLES.length]

  // 위 알림 줄
  const bar = (() => {
    if (reveal) {
      const msg = last!.winner ? (last!.reason === 'done' ? `${name(last!.winner)} 님 배치 완료! +1점` : `시간 종료 · ${name(last!.winner)} 님 +1점 (가장 많이 채움)`) : last!.reason === 'skip' ? '넘기기 · 정답 공개 (점수 없음)' : '시간 종료 · 무승부'
      return <div className={'sp-bar' + (last!.winner === me ? ' done' : ' race')}><span>{last!.winner ? '✔' : '－'}</span><b>{msg}</b><span className="sub">{secLeft(revealLeft)}초 뒤 {nextLabel}</span>{last!.ms !== null && <span className="tm">{fmtMs(last!.ms)}</span>}</div>
    }
    if (state.phase === 'result') return <div className="sp-bar done"><span>■</span><b>대결 종료</b><span className="sub">{state.winner ? `${name(state.winner)} 님 1위` : '승자 없음'} · {state.result?.rounds ?? state.round}라운드</span></div>
    if (startIn > 0) return <div className="sp-bar race"><span>👥</span><b>{state.round}라운드 준비</b><span className="sub">{L.label} · 도형 {L.pieces}개 · {state.target}점 먼저 승리</span><span className="tm">{secLeft(startIn)}</span></div>
    // 넘기기 제안 중
    const votes = state.skipVotes ?? []
    const liveIds = state.playerIds.filter((id) => active.has(id))
    if (votes.length > 0 && state.inGame) {
      const mine = votes.includes(me)
      return <div className="sp-bar skip"><span>🏳</span><b>{name(votes[0])} 님이 이 판 넘기기를 제안했어요</b>
        <span className="sub">동의 {votes.filter((v) => active.has(v)).length}/{liveIds.length} · 모두 동의하면 정답 공개 후 다음 판</span>
        {mine ? <><span className="wait">다른 사람 동의 기다리는 중…</span><button onClick={() => skip(false)}>취소</button></>
          : <><button className="ok" onClick={() => skip(true)}>동의</button><button onClick={() => skip(false)}>계속 할래요</button></>}</div>
    }
    return <div className="sp-bar race"><span>👥</span><b>{state.round}라운드</b><span className="sub">같은 슬라이드를 먼저 다 채우면 1점 · {state.target}점 먼저 승리 · 못 풀겠으면 [넘기기]</span>
      <span className="tm">⏱ {fmtMs(serverNow - new Date(state.startedAt).getTime())}</span></div>
  })()

  const deselect = (e: React.PointerEvent) => { if (e.target === e.currentTarget) play.setSel(null) }

  return (
    <div className="pptg sv" onPointerDown={deselect}>
      <div className="sp-title"><span className="sp-logo">P</span><span className="sp-tmid">{FILE_NAME} — 공동 작업 중</span>
        <span className="sv-avs">{state.playerIds.map((id) => <i key={id} className={active.has(id) ? '' : 'off'} style={{ background: color(id) }}>{[...name(id)][0]}</i>)}</span>
        <button className="sp-leave" onClick={leave}>나가기</button></div>
      <div className="sp-tabs">{['파일', '홈', '삽입', '디자인', '검토', '보기'].map((t) => <span key={t}>{t}</span>)}<span className="on">도형 서식</span></div>
      <div className="sp-ribbon">
        <div className="grp"><div className="bs">{play.rotateTools}</div><b>정렬 · 회전</b></div>
        <div className="grp"><div className="bs">
          <button className="tb" disabled={!playing || !state.inGame || (state.skipVotes ?? []).includes(me)} onClick={() => skip(true)}><span className="ic">{ICONS.skip}</span>넘기기 제안</button>
          <button className="tb" onClick={() => setHelp(true)}><span className="ic">{ICONS.help}</span>조작법</button>
        </div><b>진행</b></div>
      </div>
      {bar}

      <div className="sp-main">
        <div className="sp-thumbs sv-thumbs">
          <div className="thl">공동 작업자 슬라이드</div>
          {state.playerIds.map((id, i) => {
            const pr = state.progress[id]
            const n = Math.min(pr?.placed ?? 0, L.pieces)
            const fin = reveal && last?.winner === id && last.reason === 'done'
            return (
              <div key={id} className={'th' + (id === me ? ' on' : '') + (active.has(id) ? '' : ' gone')}>
                <i>{i + 1}</i>
                <div className={'svb' + (fin ? ' fin' : '')}>
                  <div className="nm"><span>{name(id)}{id === me ? ' (나)' : ''}</span><em>{state.points[id] ?? 0}점</em></div>
                  {(state.phase === 'play' || reveal) && <div className="row">
                    <div className="pg"><i style={{ width: `${reveal ? (fin ? 100 : 0) : Math.round((n / L.pieces) * 100)}%` }} /></div>
                    <span className="pc">{!active.has(id) ? '나감' : fin ? '완성' : reveal ? '' : `도형 ${n}/${L.pieces}`}</span>
                  </div>}
                </div>
              </div>
            )
          })}
        </div>

        <div className="sp-stage" onPointerDown={deselect}>
          {reveal ? (
            <div className="sp-slide" onPointerDown={deselect}>
              <h1>{SLIDE_TITLES[(last!.round - 1) % SLIDE_TITLES.length]}</h1>
              <p className="lead">{last!.winner ? `${name(last!.winner)} 님의 완성본${last!.reason === 'done' ? '' : ' (가장 많이 채움)'}` : last!.reason === 'skip' ? '정답 — 모두 동의해서 넘어갔어요' : '이번 라운드는 아무도 다 채우지 못했어요'}</p>
              <div className="rule" />
              <div className="sv-last">
                <SolvedBoard puz={last!.puzzle} occ={last!.occ} cs={40} />
                <table>
                  <tbody>
                    {[...last!.ranks].sort((a, b) => (b.id === last!.winner ? 1 : 0) - (a.id === last!.winner ? 1 : 0) || b.cells - a.cells).map((r, k) => (
                      <tr key={r.id} className={r.id === me ? 'me' : ''}>
                        <td>{k === 0 && last!.winner ? <span className="medal g1">1</span> : k + 1}</td>
                        <td>{name(r.id)}{r.id === me ? ' (나)' : ''}</td>
                        <td className="t">{r.id === last!.winner && last!.reason === 'done' ? `${fmtMs(last!.ms ?? 0)} · +1점` : `${r.placed}/${L.pieces} 배치${r.id === last!.winner ? ' · +1점' : ''}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="sv-next">{nextLabel} {secLeft(revealLeft)}초 뒤{finalReveal ? '' : ' 시작'}</div>
              <div className="ft"><span>○○주식회사 · 대외비</span><span>{last!.round}</span></div>
            </div>
          ) : state.phase === 'result' ? (
            <div className="sp-slide sv-res">
              <h1>{state.winner ? `${TEAMS[state.playerIds.indexOf(state.winner)] ?? ''}(${name(state.winner)}), 조직 개편 배치 1위` : '조직 개편 배치 결과'}</h1>
              <p className="lead">{L.label} · {state.result?.rounds ?? state.round}라운드 · {state.target}점 먼저</p>
              <div className="rule" />
              <table>
                <thead><tr><th>순위</th><th className="l">부서</th><th>점수</th><th>최고 기록</th><th>평균 완료</th><th>누적 우승</th></tr></thead>
                <tbody>
                  {[...state.playerIds].sort((a, b) => (state.result?.players[b]?.points ?? 0) - (state.result?.players[a]?.points ?? 0) || (state.result?.players[a]?.best ?? 1e9) - (state.result?.players[b]?.best ?? 1e9)).map((id, k) => {
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
              <div className="sv-btns">
                {isHost ? <><button className="o" onClick={toWaiting}>대기실로</button><button onClick={restart}>다시 하기</button></> : <span className="dim">방장이 다음 대결을 정할 때까지 기다려 주세요</span>}
              </div>
              <div className="ft"><span>○○주식회사 · 대외비</span><span>{state.round}</span></div>
            </div>
          ) : (
            <div className="sp-slide" onPointerDown={deselect}>
              <h1>{title}</h1>
              <p className="lead">남은 공간에 부서 도형을 빈틈없이 배치하세요 · 먼저 채우면 1점</p>
              <div className="rule" />
              {puz && (
                <div className={'sp-area' + (startIn > 0 ? ' sv-hide' : '')}>
                  <div><div className="cap">배치 영역 ({cellCount(puz)}칸)</div>{play.board}</div>
                  <div className="sp-tray"><div className="cap">사용할 도형 · 끌어서 놓기</div>{play.tray}</div>
                </div>
              )}
              {startIn > 0 && <div className="sv-count">{secLeft(startIn)}</div>}
              {!state.inGame && <div className="sv-count small">이번 대결은 구경 중이에요</div>}
              <div className="ft"><span>○○주식회사 · 대외비</span><span>{state.round}</span></div>
            </div>
          )}
        </div>

        <div className="sv-side">
          <div className="sv-kpi">
            <small>{state.phase === 'result' ? '최종 점수' : `${state.round}라운드 · ${state.target}점 먼저 승리`}</small>
            <div className="big">{state.playerIds.map((id) => state.points[id] ?? 0).join(' : ')}</div>
            <div className="sc">{state.playerIds.map((id, i) => <div key={id} className={id === me ? 'me' : ''}><span>{TEAMS[i]} {name(id)}</span><b>{state.points[id] ?? 0}점</b></div>)}</div>
          </div>
          <Chat state={state} me={me} name={name} onSend={(t) => { void api.shvChat(room.code, t).then(() => { void refresh(); poke() }).catch(() => flash('보내지 못했어요')) }} />
        </div>
      </div>
      <div className="sp-status"><span>슬라이드 {state.round}</span><span>한국어</span><span className="sp-sp" /><span className="hide-sm">Q·E 회전 · A·D 대칭 · 끌어서 놓기 · Enter 대화</span></div>
      {play.ghost}
      {help && <HelpDialog onClose={() => setHelp(false)} extra={<tr><th>대화</th><td><kbd>Enter</kbd>로 열고 보내기 · 빈 칸에서 Enter나 Esc면 게임으로</td></tr>} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

// 대기실 [시작]에서 쓰는 판 만들기 (방장 브라우저)
export const startShapeVs = (code: string, level: 'easy' | 'normal' | 'hard') => api.shvStart(code, battlePuzzles(level))
