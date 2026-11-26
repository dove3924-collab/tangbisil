import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { track } from '../lib/analytics'
import { api, ApiError, type RoomFull } from '../lib/api'
import { COLORS as PEOPLE_COLORS } from '../lib/colors'
import { useLinkVs } from '../hooks/useLinkVs'
import ExcelFrame from '../puzzle/ExcelFrame'
import { fmtMs } from '../puzzle/common'
import { LEVELS, battleBoards, stats, type Paths, type Puzzle } from './logic'
import type { LkvState } from './vs'
import { LinkSvg, useCellSize, useLinkPlay } from './Board'
import { FILE_NAME, LinkSheet, cellInfo } from './LinkGame'
import './link.css'

const TEAMS = ['영업2팀', '마케팅팀', '재무팀', '인사팀']
const secLeft = (ms: number) => Math.max(0, Math.ceil(ms / 1000))

function Chat({ state, me, name, onSend }: { state: LkvState; me: string; name: (id: string | null) => string; onSend: (t: string) => void }) {
  const [text, setText] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight }, [state.chats.length])
  const send = (e: FormEvent) => { e.preventDefault(); const t = text.trim(); if (t) { onSend(t); setText('') } }
  return (
    <div className="lk-chat">
      <div className="h">메모 (대화)</div>
      <div className="b" ref={box}>
        {state.chats.map((m) => <div key={m.id} className={m.userId === null ? 'sys' : m.userId === me ? 'me' : ''}>{m.userId !== null && <b>{name(m.userId)}</b>}{m.body}</div>)}
      </div>
      <form onSubmit={send}>
        <input className="lkv-chat-in" value={text} maxLength={200} placeholder="Enter로 대화 · 빈 칸 Enter·Esc로 게임" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape' || (e.key === 'Enter' && !e.nativeEvent.isComposing && !text.trim())) { e.preventDefault(); (e.target as HTMLInputElement).blur() } }} />
      </form>
    </div>
  )
}

export default function LinkVsGame({ room }: { room: RoomFull }) {
  const nav = useNavigate()
  const me = room.me
  const isHost = room.hostId === me
  const active = new Set(room.players.map((p) => p.id))
  const { state, error, refresh, poke, serverNow } = useLinkVs(room.code, room.players.length)
  const [toast, setToast] = useState('')
  const [help, setHelp] = useState(false)
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? '' : t)), 2400) }

  // 이번 라운드 내 판 (새로고침해도 이어지게 세션에 보관)
  const roundKey = state && state.puzzle ? `wollu.lkv.${room.code}.${state.roundNo}.${state.round}` : null
  const [local, setLocal] = useState<{ key: string; paths: Paths } | null>(null)
  useEffect(() => {
    if (!roundKey || !state?.puzzle || local?.key === roundKey) return
    let paths: Paths | null = null
    try { paths = JSON.parse(sessionStorage.getItem(roundKey) ?? 'null') } catch { /* 새로 */ }
    setLocal({ key: roundKey, paths: paths ?? state.puzzle.ends.map(() => []) })
  }, [roundKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const p: Puzzle | null = state?.puzzle ?? null
  const paths = local && local.key === roundKey ? local.paths : []
  const setPaths = (fn: (x: Paths) => Paths) => setLocal((l) => {
    if (!l) return l
    const next = { ...l, paths: fn(l.paths) }
    try { sessionStorage.setItem(l.key, JSON.stringify(next.paths)) } catch { /* 무시 */ }
    return next
  })
  const cs = useCellSize(p?.n ?? LEVELS[state?.level ?? 'normal'].n, 300)

  const started = !!state && serverNow >= new Date(state.startedAt).getTime()
  const playing = !!state && state.phase === 'play' && started
  const locked = !playing || !state?.inGame || !active.has(me)
  const play = useLinkPlay({ p, paths, setPaths, cs, enabled: !locked && !!p, resetKey: roundKey ?? '' })
  const st = p ? stats(p, play.full) : null

  // 진행 보내기 (연결한 쌍 수 · 칸 채움 %)
  const sentRef = useRef('')
  useEffect(() => {
    if (!state || !st || !playing) return
    const pct = st.pct
    const sig = `${roundKey}|${st.linked}|${pct}`
    if (sig === sentRef.current) return
    const t = window.setTimeout(async () => {
      sentRef.current = sig
      try { await api.lkvProgress(room.code, state.round, st.linked, pct); poke() } catch { /* 다음에 */ }
    }, 300)
    return () => window.clearTimeout(t)
  }, [st?.linked, st?.filled, playing, roundKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // 다 채우면 서버에 완료 (서버가 경로를 다시 검사)
  const doneRef = useRef('')
  useEffect(() => {
    if (!state || !st?.solved || !playing || doneRef.current === roundKey) return
    doneRef.current = roundKey ?? ''
    api.lkvDone(room.code, state.round, play.full)
      .then(async (r) => { if (r.ok) track('puzzle_clear', { game_id: 'linkvs', level: state.level, result: 'win', seconds: Math.round((r.ms ?? 0) / 1000) }); await refresh(); poke() })
      .catch((e) => { doneRef.current = ''; flash(e instanceof ApiError ? e.message : '전송하지 못했어요') })
  }, [st?.solved, playing]) // eslint-disable-line react-hooks/exhaustive-deps

  // Enter = 대화 (키보드로 긋는 중이 아닐 때)
  const cursorRef = useRef<number | null>(null)
  cursorRef.current = play.cursor
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.key === 'Enter' && cursorRef.current === null) { e.preventDefault(); document.querySelector<HTMLInputElement>('.lkv-chat-in')?.focus() }
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
  const restart = async () => { try { await api.lkvStart(room.code, battleBoards(state?.level ?? 'normal')); await refresh(); poke() } catch (e) { flash(e instanceof ApiError ? e.message : '시작하지 못했어요') } }
  const skip = async (vote: boolean) => { if (!state) return; try { await api.lkvSkip(room.code, state.round, vote); await refresh(); poke() } catch (e) { flash(e instanceof ApiError ? e.message : '실패했어요') } }
  const toWaiting = async () => { try { await api.lkvToWaiting(room.code) } catch (e) { flash(e instanceof ApiError ? e.message : '실패했어요') } }

  if (!state) return <div className="wb"><p style={{ margin: 'auto' }}>{error || '시트 불러오는 중…'}</p></div>

  const name = (id: string | null) => (id && state.people[id]?.nickname) || '?'
  const color = (id: string) => PEOPLE_COLORS[(state.people[id]?.color ?? 0) % PEOPLE_COLORS.length]
  const L = LEVELS[state.level]
  const last = state.last
  const startIn = serverNow < new Date(state.startedAt).getTime() ? new Date(state.startedAt).getTime() - serverNow : 0
  const showLast = !!last && state.phase === 'play' && startIn > 0 && last.round === state.round - 1
  const lastAt = last ? new Date(last.at).getTime() : 0
  const finalReveal = state.phase === 'result' && !!last && last.round === (state.result?.rounds ?? state.round) && serverNow < lastAt + 5000
  const reveal = showLast || finalReveal
  const revealLeft = showLast ? startIn : lastAt + 5000 - serverNow
  const nextLabel = finalReveal ? '최종 결과' : `${state.round}라운드`
  const pairs = p?.ends.length ?? last?.puzzle.ends.length ?? 1
  const focus = play.cursor ?? play.hover
  const info = p ? cellInfo(p, play.full, focus) : { nameBox: 'A1', formula: '' }
  const votes = state.skipVotes ?? []

  const bar = (() => {
    if (reveal) {
      const msg = last!.winner ? `${name(last!.winner)} 님 링크 완료! +1점` : last!.reason === 'skip' ? '넘기기 · 정답 공개 (점수 없음)' : '무승부'
      return <div className={'lk-bar' + (last!.winner === me ? ' ok' : '')}><b>{msg}</b><span>{secLeft(revealLeft)}초 뒤 {nextLabel}</span>{last!.ms !== null && <em>{fmtMs(last!.ms)}</em>}</div>
    }
    if (state.phase === 'result') return <div className="lk-bar ok"><b>대결 종료</b><span>{state.winner ? `${name(state.winner)} 님 1위` : '승자 없음'} · {state.result?.rounds ?? state.round}라운드</span></div>
    if (startIn > 0) return <div className="lk-bar"><b>{state.round}라운드 준비</b><span>{L.label} {L.n}×{L.n} · {state.target}점 먼저 승리</span><em>{secLeft(startIn)}</em></div>
    const liveIds = state.playerIds.filter((id) => active.has(id))
    if (votes.length > 0 && state.inGame) {
      const mine = votes.includes(me)
      return <div className="lk-bar skip"><b>{name(votes[0])} 님이 이 판 넘기기를 제안했어요</b>
        <span>동의 {votes.filter((v) => active.has(v)).length}/{liveIds.length} · 모두 동의하면 정답 공개 후 다음 판</span>
        {mine ? <><span>다른 사람 기다리는 중…</span><button onClick={() => skip(false)}>취소</button></>
          : <><button className="ok" onClick={() => skip(true)}>동의</button><button onClick={() => skip(false)}>계속 할래요</button></>}</div>
    }
    return <div className="lk-bar"><b>{state.round}라운드</b><span>같은 판을 먼저 빈칸 없이 채우면 1점 · 연결 {st?.linked ?? 0}/{pairs} · 못 풀겠으면 [넘기기]</span>
      <em>⏱ {fmtMs(serverNow - new Date(state.startedAt).getTime())}</em></div>
  })()

  const sheet = (() => {
    if (reveal) {
      const lp = last!.puzzle as Puzzle
      return (
        <>
          <LinkSheet n={lp.n} cs={Math.min(cs, 44)} focus={null} title={`${last!.round}라운드 · ${last!.winner ? `${name(last!.winner)} 님의 완성본` : last!.reason === 'skip' ? '정답 — 모두 동의해서 넘어갔어요' : '아무도 다 채우지 못했어요'}`} sub={`${nextLabel} ${secLeft(revealLeft)}초 뒤${finalReveal ? '' : ' 시작'}`}>
            <LinkSvg p={lp} paths={last!.paths ?? []} cs={Math.min(cs, 44)} done />
          </LinkSheet>
          <table className="lk-rank"><tbody>
            {[...last!.ranks].sort((x, y) => (y.id === last!.winner ? 1 : 0) - (x.id === last!.winner ? 1 : 0) || y.pct - x.pct).map((r, k) => (
              <tr key={r.id} className={r.id === me ? 'me' : ''}>
                <td>{k + 1}</td><td>{name(r.id)}{r.id === me ? ' (나)' : ''}</td>
                <td className="t">{r.id === last!.winner ? `${fmtMs(last!.ms ?? 0)} · +1점` : `연결 ${Math.min(r.placed, pairs)}/${pairs} · ${r.pct}%`}</td>
              </tr>
            ))}
          </tbody></table>
        </>
      )
    }
    if (state.phase === 'result') {
      return (
        <div className="lk-res">
          <h2>{state.winner ? `${TEAMS[state.playerIds.indexOf(state.winner)] ?? ''}(${name(state.winner)}), 셀 링크 1위` : '셀 링크 대결 결과'}</h2>
          <p className="muted">{L.label} {L.n}×{L.n} · {state.result?.rounds ?? state.round}라운드 · {state.target}점 먼저</p>
          <table className="lk-rank big">
            <thead><tr><th>순위</th><th className="l">부서</th><th>점수</th><th>최고 기록</th><th>평균 완료</th><th>누적 우승</th></tr></thead>
            <tbody>
              {[...state.playerIds].sort((x, y) => (state.result?.players[y]?.points ?? 0) - (state.result?.players[x]?.points ?? 0) || (state.result?.players[x]?.best ?? 1e9) - (state.result?.players[y]?.best ?? 1e9)).map((id, k) => {
                const r = state.result?.players[id]
                return (
                  <tr key={id} className={(id === state.winner ? 'w ' : '') + (id === me ? 'me' : '')}>
                    <td>{k + 1}</td>
                    <td className="l"><b>{TEAMS[state.playerIds.indexOf(id)]} {name(id)}</b>{id === me && ' (나)'}{!active.has(id) && <small> · 나감</small>}</td>
                    <td>{r?.points ?? 0}점</td><td>{r?.best != null ? fmtMs(r.best) : '-'}</td><td>{r?.avg != null ? fmtMs(r.avg) : '-'}</td><td>{state.scores[id] ?? 0}회</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="lk-btns">{isHost ? <><button onClick={toWaiting}>대기실로</button><button className="ok" onClick={restart}>다시 하기</button></> : <span className="muted">방장이 다음 대결을 정할 때까지 기다려 주세요</span>}</div>
        </div>
      )
    }
    if (!p) return null
    return (
      <div className="lk-play">
        <LinkSheet n={p.n} cs={cs} focus={focus} title={`셀 링크 대결 · ${state.round}라운드 (${p.n}×${p.n} · ${pairs}쌍)`} sub="같은 판을 모두 동시에! 먼저 빈칸 없이 다 채우면 1점이에요.">
          <div className={startIn > 0 ? 'lk-hide' : ''}>
            <LinkSvg p={p} paths={play.full} cs={cs} active={play.active} cursor={play.cursor} svgRef={play.svgRef} handlers={locked ? undefined : play.handlers} />
          </div>
        </LinkSheet>
        {startIn > 0 && <div className="lk-count">{secLeft(startIn)}</div>}
        {!state.inGame && <div className="lk-count small">이번 대결은 구경 중이에요</div>}
      </div>
    )
  })()

  return (
    <ExcelFrame
      fileName={FILE_NAME.replace('.xlsx', '_공동편집.xlsx')}
      nameBox={info.nameBox}
      formula={info.formula}
      onExit={leave}
      titleExtra={<span className="lk-avs">{state.playerIds.map((id) => <i key={id} className={active.has(id) ? '' : 'off'} style={{ background: color(id) }} title={name(id)}>{[...name(id)][0]}</i>)}</span>}
      tools={<>
        <div className="grp">
          <button disabled={!playing || !state.inGame || votes.includes(me)} onClick={() => skip(true)}>🏳 넘기기 제안</button>
          <button disabled={locked || !play.canUndo} onClick={play.undo}>↶ 되돌리기</button>
          <button disabled={locked} onClick={play.reset}>처음부터</button>
          <button onClick={() => setHelp(true)}>? 조작법</button>
        </div>
        <div className="grp hint-txt">드래그로 잇기 · 방향키+Space · Ctrl+Z 되돌리기 · Enter 대화</div>
      </>}
      side={
        <div className="lk-side">
          <div className="lk-kpi">
            <small>{state.phase === 'result' ? '최종 점수' : `${state.round}라운드 · ${state.target}점 먼저 승리`}</small>
            <div className="big">{state.playerIds.map((id) => state.points[id] ?? 0).join(' : ')}</div>
          </div>
          <div className="lk-players">
            {state.playerIds.map((id, i) => {
              const pr = state.progress[id]
              const pct = Math.min(pr?.pct ?? 0, 100)
              return (
                <div key={id} className={(id === me ? 'me' : '') + (active.has(id) ? '' : ' gone')}>
                  <div className="nm"><i style={{ background: color(id) }} /><span>{TEAMS[i]} {name(id)}{id === me ? ' (나)' : ''}</span><b>{state.points[id] ?? 0}점</b></div>
                  {state.phase === 'play' && !reveal && <div className="row"><div className="pg"><i style={{ width: `${pct}%` }} /></div><small>{!active.has(id) ? '나감' : `${Math.min(pr?.placed ?? 0, pairs)}/${pairs} · ${pct}%`}</small></div>}
                </div>
              )
            })}
          </div>
          <Chat state={state} me={me} name={name} onSend={(t) => { void api.lkvChat(room.code, t).then(() => { void refresh(); poke() }).catch(() => flash('보내지 못했어요')) }} />
        </div>
      }
      tabs={<><button className="on">셀 링크</button><span className="plus">+</span></>}
      status={<>
        <span>{state.phase === 'result' ? '대결 종료' : `${state.round}라운드`}</span>
        {st && state.phase === 'play' && !reveal && <><span>연결 <b>{st.linked}</b> / {st.pairs}</span><span>칸 채움 <b>{st.pct}%</b></span></>}
        <span className="sp" /><span className="hide-sm">공동 편집 {state.playerIds.filter((id) => active.has(id)).length}명</span>
      </>}
      overlay={<>
        {help && (
          <div className="wb-dlg-wrap" onPointerDown={() => setHelp(false)}>
            <div className="wb-dlg lk-help" onPointerDown={(e) => e.stopPropagation()}>
              <div className="wd-head">조작법<button className="wd-x" onClick={() => setHelp(false)}>✕</button></div>
              <table><tbody>
                <tr><th>목표</th><td>모두 같은 판을 받아요. 같은 글자끼리 선으로 잇고, 빈칸 없이 먼저 다 채우면 1점.</td></tr>
                <tr><th>긋기</th><td>글자에서 드래그 · 선 중간을 누르면 거기서부터 다시 · 다른 선을 지나가면 그 선이 잘려요</td></tr>
                <tr><th>키보드</th><td>방향키 이동 · <kbd>Space</kbd> 긋기 시작/끝 · <kbd>Ctrl</kbd>+<kbd>Z</kbd> 되돌리기</td></tr>
                <tr><th>넘기기</th><td>못 풀겠으면 [넘기기 제안] → 모두 동의하면 정답을 보여주고 점수 없이 다음 판</td></tr>
                <tr><th>대화</th><td><kbd>Enter</kbd>로 열고 보내기 · 빈 칸에서 Enter나 Esc면 게임으로</td></tr>
              </tbody></table>
            </div>
          </div>
        )}
        {toast && <div className="wb-toast">{toast}</div>}
      </>}
    >
      {bar}
      {sheet}
    </ExcelFrame>
  )
}
