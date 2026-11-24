import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBingo } from '../hooks/useBingo'
import { api, ApiError, type RoomFull } from '../lib/api'
import { CALL_SECONDS, FILL_SECONDS, doneLines, norm, type BingoState } from '../lib/bingo'
import { COLORS } from '../lib/colors'
import NextTopic from './NextTopic'
import TurnBanner from './TurnBanner'
import { useTurnAlert } from '../hooks/useTurnAlert'

const DOC_NAME = '주간회의록_11월2주차.docx'
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })

export default function BingoGame({ room }: { room: RoomFull }) {
  const nav = useNavigate()
  const { state, error, refresh, remaining } = useBingo(room.code)
  const [toast, setToast] = useState('')
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? '' : t)), 2400) }
  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); await refresh(); return true } catch (e) { flash(e instanceof ApiError ? e.message : '실패했어요'); return false }
  }
  const leave = async () => {
    if (state && state.phase !== 'result' && !window.confirm('게임 중에 나가면 이번 판에는 다시 들어올 수 없어요. 나갈까요?')) return
    try { await api.leaveRoom(room.code) } catch { /* 무시 */ }
    nav('/games')
  }

  const myTurnNow = !!state && state.phase === 'call' && !!state.deadline && state.playerIds[state.turnIndex] === room.me
  useTurnAlert(myTurnNow)

  if (!state) return <div className="room-center"><p className="muted">{error || '불러오는 중…'}</p></div>

  const me = room.me
  const isHost = room.hostId === me
  const person = (id: string | null) => (id && state.people[id]) || { nickname: '?', color: 0 }
  const turnId = state.phase === 'call' && state.deadline ? state.playerIds[state.turnIndex] : null
  // 다음 차례 (나간 사람은 건너뜀)
  const active = new Set(room.players.map((p) => p.id))
  const n = state.playerIds.length
  let nextName = ''
  for (let k = 1; k < n; k++) {
    const id = state.playerIds[(state.turnIndex + k) % n]
    if (active.has(id)) { nextName = person(id).nickname; break }
  }

  return (
    <div className="bd">
      <div className="bd-title"><span className="bd-logo">W</span><span className="bd-tmid">{DOC_NAME}</span><button className="bd-leave" onClick={leave}>나가기</button></div>
      <div className="bd-ribbon">{['파일', '홈', '삽입', '디자인', '레이아웃', '참조', '검토', '보기'].map((t) => <span key={t} className={t === '홈' ? 'on' : ''}>{t}</span>)}</div>
      <div className="bd-tools" aria-hidden>
        <div className="g"><span className="bx">맑은 고딕</span><span className="bx">11</span></div>
        <div className="g"><b>가</b><i>가</i><u>가</u><s>가</s></div>
        <div className="g"><span className="bx">표준</span><span className="bx">제목 1</span><span className="bx">제목 2</span></div>
        <div className="g">찾기 · 바꾸기</div>
      </div>
      {turnId === me && (
        <TurnBanner title="내 차례예요" sub="판에서 부를 단어를 클릭하세요" next={nextName ? `다음은 ${nextName} 님` : undefined} remaining={remaining} total={CALL_SECONDS} />
      )}
      <div className="bd-main">
        <div className="bd-canvas">
          <div className="bd-page">
            {state.phase === 'fill' ? (
              <FillPhase key={state.roundNo} state={state} me={me} code={room.code} remaining={remaining} run={run} flash={flash} />
            ) : (
              <PlayBoard state={state} me={me} myTurn={turnId === me} onCall={(w) => run(() => api.bingoCall(room.code, w))} person={person} />
            )}
          </div>
        </div>
        <aside className="bd-side">
          <SidePanel state={state} me={me} isHost={isHost} turnId={turnId} remaining={remaining} person={person} nextTopic={<NextTopic room={room} current={state.category} isHost={isHost} />}
            onClaim={() => run(() => api.bingoClaim(room.code))}
            onNext={() => run(() => api.bingoStart(room.code))}
            onWaiting={() => run(() => api.bingoToWaiting(room.code))}
            onChat={(t) => run(() => api.bingoChat(room.code, t))} />
        </aside>
      </div>
      <div className="bd-status">
        <span>페이지 1/1</span><span>단어 {state.size * state.size}</span><span>한국어</span><span className="sp" /><span>100%</span>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

type PersonFn = (id: string | null) => { nickname: string; color: number }

/* ───────── 판 채우기 ───────── */
function FillPhase({ state, me, code, remaining, run, flash }: {
  state: BingoState; me: string; code: string; remaining: number | null
  run: (fn: () => Promise<unknown>) => Promise<boolean>; flash: (m: string) => void
}) {
  const total = state.size * state.size
  const [cells, setCells] = useState<string[]>(() => (state.myCells.length === total ? [...state.myCells] : Array(total).fill('')))
  const [sel, setSel] = useState(() => Math.max(0, cells.findIndex((c) => !c)))
  const ready = state.ready.includes(me)
  const bank = useMemo(() => new Set(state.words.map(norm)), [state.words])
  const used = useMemo(() => new Set(cells.filter(Boolean).map(norm)), [cells])
  const customCount = cells.filter((c) => c && !bank.has(norm(c))).length
  const filled = cells.filter(Boolean).length
  const dirty = useRef(false)

  // 자동 저장 (준비 전까지)
  useEffect(() => {
    if (!dirty.current || ready) return
    const t = window.setTimeout(() => { void api.bingoSetBoard(code, cells, false).catch(() => {}) }, 700)
    return () => window.clearTimeout(t)
  }, [cells, code, ready])

  const put = (i: number, w: string) => {
    if (ready) return
    dirty.current = true
    setCells((prev) => {
      const next = [...prev]
      next[i] = w
      const nextEmpty = next.findIndex((c, k) => !c && k > i)
      setSel(nextEmpty >= 0 ? nextEmpty : next.findIndex((c) => !c) >= 0 ? next.findIndex((c) => !c) : i)
      return next
    })
  }
  const clickWord = (w: string) => {
    if (ready) return
    const at = cells.findIndex((c) => c && norm(c) === norm(w))
    if (at >= 0) { dirty.current = true; setCells((p) => p.map((c, k) => (k === at ? '' : c))); setSel(at); return }
    put(sel, w)
  }
  /** 칸 i 에 단어를 직접 넣는다. 성공하면 true */
  const typeInto = (i: number, raw: string) => {
    if (ready) return false
    const w = raw.trim().replace(/\s+/g, ' ')
    if (!w) return false
    if (w.length > 10) { flash('최대 10자예요'); return false }
    if (cells[i] && norm(cells[i]) === norm(w)) return true
    if (used.has(norm(w))) { flash('이미 판에 있는 단어예요'); return false }
    const isCustom = !bank.has(norm(w))
    const replacing = cells[i] && !bank.has(norm(cells[i]))
    if (isCustom && customCount - (replacing ? 1 : 0) >= state.customMax) { flash(`직접 입력은 ${state.customMax}칸까지예요`); return false }
    put(i, w)
    return true
  }
  // 표 안에서 바로 입력: 선택한 칸에 입력창이 들어간다
  const [draft, setDraft] = useState('')
  const cellInput = useRef<HTMLInputElement>(null)
  const cellFocused = useRef(false)
  const [wordsOpen, setWordsOpen] = useState(true)
  useEffect(() => { setDraft(''); if (cellFocused.current) cellInput.current?.focus() }, [sel])
  const moveSel = (dr: number, dc: number) => {
    const n = state.size
    const r = Math.min(n - 1, Math.max(0, Math.floor(sel / n) + dr)), c = Math.min(n - 1, Math.max(0, (sel % n) + dc))
    setSel(r * n + c)
  }
  const onCellKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') { e.preventDefault(); if (draft.trim()) { if (typeInto(sel, draft)) setDraft('') } return }
    if (e.key === 'Escape') { setDraft(''); return }
    if (draft) return
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); clearSel(); return }
    const mv: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Tab: [0, e.shiftKey ? -1 : 1] }
    if (mv[e.key]) { e.preventDefault(); moveSel(...mv[e.key]) }
  }
  const randomFill = () => {
    if (ready) return
    dirty.current = true
    const pool = state.words.filter((w) => !used.has(norm(w))).sort(() => Math.random() - 0.5)
    setCells((p) => p.map((c) => c || pool.shift() || ''))
  }
  const clearAll = () => { if (!ready) { dirty.current = true; setCells(Array(total).fill('')); setSel(0) } }
  const clearSel = () => { if (!ready && cells[sel]) { dirty.current = true; setCells((p) => p.map((c, k) => (k === sel ? '' : c))) } }
  // Delete / Backspace 로 선택한 칸 지우기 (입력창에 쓰는 중이 아닐 때)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearSel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <>
      <h1>빙고 — 주제: {state.category}</h1>
      <p className="sub">
        {ready ? '준비 완료! 다른 사람을 기다리는 중이에요.' : '칸을 클릭해 바로 입력하거나, 아래 단어 목록에서 골라 채우세요. 다른 사람은 내 판을 볼 수 없어요.'}
      </p>
      <table className={`bd-board s${state.size}`}>
        <tbody>
          {Array.from({ length: state.size }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: state.size }, (_, c) => {
                const i = r * state.size + c
                const w = cells[i]
                const editing = i === sel && !ready
                return (
                  <td key={c} className={(w ? '' : 'empty') + (editing ? ' cur' : '') + (w && !bank.has(norm(w)) ? ' custom' : '')}
                    onClick={() => { setSel(i); cellFocused.current = true; cellInput.current?.focus() }} onDoubleClick={() => w && put(i, '')}>
                    <span className={editing && draft ? 'hide' : ''}>{w || (editing ? '입력하거나 아래에서 고르기' : '(빈 칸)')}</span>
                    {editing && (
                      <input ref={cellInput} className="bd-cellin" value={draft} maxLength={10} aria-label="칸에 직접 입력"
                        onChange={(e) => setDraft(e.target.value)} onKeyDown={onCellKey}
                        onFocus={() => { cellFocused.current = true }}
                        onBlur={() => { cellFocused.current = false; if (draft.trim() && typeInto(sel, draft)) setDraft('') }} />
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {!ready && (
        <>
          <div className="bd-keys">
            <span>입력 후 <kbd>Enter</kbd> · 칸 비우기 <kbd>Backspace</kbd> / <kbd>Delete</kbd> · 칸 이동 <kbd>방향키</kbd></span>
            <span className="bd-ccount">목록에 없는 단어 <b>{customCount}/{state.customMax}</b></span>
          </div>
          <div className="bd-words-head">
            <p className="note">단어 목록 — 클릭하면 선택한 칸에 들어가요. 다시 누르면 빠져요.</p>
            <button className={'bd-fold' + (filled === total && wordsOpen ? ' hl' : '')} onClick={() => setWordsOpen((o) => !o)} aria-expanded={wordsOpen}>
              {wordsOpen ? '단어 목록 접기 ▲' : `단어 목록 펼치기 ▼ (${state.words.length}개)`}
            </button>
          </div>
          {wordsOpen && (
            <div className="bd-chips">
              {state.words.map((w) => <button key={w} className={used.has(norm(w)) ? 'used' : ''} onClick={() => clickWord(w)}>{w}</button>)}
            </div>
          )}
        </>
      )}
      <div className="bd-fill-actions">
        {!ready ? (
          <>
            <button onClick={randomFill}>랜덤으로 채우기</button>
            <button onClick={clearSel} disabled={!cells[sel]}>선택한 칸 지우기</button>
            <button onClick={clearAll}>전체 비우기</button>
            <button className="pri" disabled={filled < total} onClick={() => run(() => api.bingoSetBoard(code, cells, true))}>준비 완료 ({filled}/{total})</button>
          </>
        ) : (
          <button onClick={() => run(() => api.bingoSetBoard(code, cells, false))}>준비 취소</button>
        )}
        {remaining !== null && <span className="muted sm">남은 시간 {mmss(Math.ceil(remaining))} · 끝나면 빈 칸은 자동으로 채워져요</span>}
      </div>
    </>
  )
}

/* ───────── 부르기 · 결과 ───────── */
function PlayBoard({ state, me, myTurn, onCall, person }: {
  state: BingoState; me: string; myTurn: boolean; onCall: (w: string) => void; person: PersonFn
}) {
  const called = useMemo(() => new Set(state.calls.map((c) => norm(c.word))), [state.calls])
  const cells = state.phase === 'result' && state.result ? state.result.boards[me]?.cells ?? state.myCells : state.myCells
  const customs = state.phase === 'result' && state.result ? state.result.boards[me]?.custom ?? state.myCustom : state.myCustom
  const lines = doneLines(cells, state.size, called)
  const winCells = new Set(state.phase === 'result' && state.winner === me ? lines.flat() : [])
  const others = state.phase === 'result' && state.result ? Object.entries(state.result.boards).filter(([id]) => id !== me) : []
  const lastCall = state.calls[state.calls.length - 1]

  return (
    <>
      <h1>빙고 — 주제: {state.category}</h1>
      <p className="sub">
        {state.phase === 'result'
          ? <><b className="gold">{person(state.winner).nickname} 님 빙고!</b> · {state.result?.calls}번째 단어에서 완성</>
          : <>{state.linesToWin}줄을 먼저 지우고 [빙고!]를 누르면 승리 · 지금 <b>{lines.length}줄</b>{myTurn && <b className="blue"> · 내 차례! 부를 단어를 판에서 클릭하세요</b>}</>}
      </p>
      {state.inGame || state.phase === 'result' ? (
        <table className={`bd-board s${state.size}${myTurn ? ' pick' : ''}`}>
          <tbody>
            {Array.from({ length: state.size }, (_, r) => (
              <tr key={r}>
                {Array.from({ length: state.size }, (_, c) => {
                  const i = r * state.size + c
                  const w = cells[i] ?? ''
                  const mk = w && called.has(norm(w))
                  const isLast = lastCall && norm(lastCall.word) === norm(w)
                  return (
                    <td key={c} className={(mk ? 'mk' : '') + (winCells.has(i) ? ' win' : '') + (customs[i] ? ' custom' : '') + (isLast ? ' last' : '') + (myTurn && !mk ? ' can' : '')}
                      onClick={() => { if (myTurn && !mk && w) onCall(w) }}>
                      <span>{w}</span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="muted">이번 판에는 참여하지 않아요.</p>}
      {others.length > 0 && (
        <>
          <p className="note">다른 사람 판 <span className="bd-legend">보라색</span> = 직접 입력한 단어</p>
          <div className="bd-others">
            {others.map(([id, b]) => (
              <div key={id}>
                <div className="bd-other-name"><b>{person(id).nickname}</b> · {b.lines}줄{id === state.winner && ' 🏆'}</div>
                <div className="bd-mini" style={{ gridTemplateColumns: `repeat(${state.size}, 1fr)` }}>
                  {b.cells.map((w, i) => <i key={i} className={(called.has(norm(w)) ? 'm' : '') + (b.custom[i] ? ' c' : '')} title={w}><span>{w}</span></i>)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function SidePanel({ state, me, isHost, turnId, remaining, person, nextTopic, onClaim, onNext, onWaiting, onChat }: {
  state: BingoState; me: string; isHost: boolean; turnId: string | null; remaining: number | null; person: PersonFn; nextTopic: React.ReactNode
  onClaim: () => void; onNext: () => void; onWaiting: () => void; onChat: (t: string) => Promise<boolean>
}) {
  const called = useMemo(() => new Set(state.calls.map((c) => norm(c.word))), [state.calls])
  const myLines = doneLines(state.myCells, state.size, called).length
  const canClaim = state.phase === 'call' && state.inGame && myLines >= state.linesToWin
  const total = state.phase === 'fill' ? FILL_SECONDS : CALL_SECONDS
  const pct = remaining !== null ? Math.min(100, (remaining / total) * 100) : 0

  // 부른 단어 + 대화를 시간순으로
  const items = useMemo(() => [
    ...state.calls.map((c) => ({ key: 'c' + c.id, at: c.at, kind: 'call' as const, c })),
    ...state.chats.map((m) => ({ key: 'm' + m.id, at: m.at, kind: 'chat' as const, m })),
  ].sort((a, b) => a.at.localeCompare(b.at)), [state.calls, state.chats])
  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight }, [items.length])

  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const send = async (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    const ok = await onChat(t.slice(0, 200))
    setBusy(false)
    if (ok) setText('')
    inputRef.current?.focus()
  }

  return (
    <>
      <h3>{state.phase === 'result' ? '결과' : '메모 · 진행'}</h3>
      {state.phase === 'fill' && (
        <div className="sec">
          <div className="lbl">단계</div><b>판 채우기</b>{remaining !== null && <> · {mmss(Math.ceil(remaining))}</>}
          <div className="bar"><i style={{ width: `${pct}%` }} /></div>
          <div className="rules">· 자기 차례에 <b>내 판에 있는 단어</b>를 불러요<br />· 불린 단어는 모두의 판에서 지워져요<br />· {state.linesToWin}줄을 먼저 지우고 <b>[빙고!]</b>를 먼저 누르면 승리<br />· <b>목록에 없는 단어</b>는 {state.customMax}칸까지 직접 입력. 다른 사람과 겹치면 "통했다!"</div>
        </div>
      )}
      {state.phase === 'call' && (
        <div className={'sec' + (turnId === me ? ' myturn' : '')}>
          <div className="lbl">차례</div>
          {turnId ? (
            <>{turnId === me ? <b className="blue">내 차례예요 — 판에서 단어를 클릭</b> : <b>{person(turnId).nickname} 님 차례</b>}
              {remaining !== null && <> · {mmss(Math.ceil(remaining))}</>}
              <div className={'bar' + (turnId === me && remaining !== null && remaining <= 5 ? ' urgent' : '')}><i style={{ width: `${pct}%` }} /></div></>
          ) : <span className="muted">더 부를 단어가 없어요. 빙고를 확인하세요!</span>}
          <button className="bd-bingo" disabled={!canClaim} onClick={onClaim}>빙고!</button>
          <div className="muted sm">{state.linesToWin}줄을 완성하면 버튼이 켜져요. 먼저 누른 사람이 이겨요.</div>
        </div>
      )}
      {state.phase === 'result' && (
        <div className="sec">
          <div className="win-title">🏆 {person(state.winner).nickname} 님 빙고!</div>
          <div className="muted">단어 {state.result?.calls}개 만에 {state.linesToWin}줄 완성</div>
          {nextTopic}
          {isHost ? <div className="host-btns" style={{ marginTop: 10 }}><button className="btn-blue" onClick={onNext}>다음 판</button><button className="btn-line" onClick={onWaiting}>대기실로</button></div>
            : <div className="muted sm" style={{ marginTop: 8 }}>방장이 다음 판을 시작할 수 있어요.</div>}
        </div>
      )}
      <div className="sec">
        <div className="lbl">참가자{state.phase === 'fill' ? ' (준비)' : state.phase === 'result' ? ' (줄 수 · 누적 승수)' : ' (누적 승수)'}</div>
        {state.playerIds.map((id, i) => {
          const p = person(id)
          return (
            <div key={id} className={'pl' + (id === turnId ? ' now' : '')}>
              <span className="av" style={{ background: COLORS[p.color % COLORS.length] }}>{[...p.nickname][0]}</span>
              <span>{i + 1}. {p.nickname}{id === me ? ' (나)' : ''}</span>
              <span className="r">
                {state.phase === 'fill' ? (state.ready.includes(id) ? '준비 ✓' : '채우는 중') : state.phase === 'result' ? `${state.result?.boards[id]?.lines ?? 0}줄 · ${state.scores[id] ?? 0}승` : `${state.scores[id] ?? 0}승`}
              </span>
            </div>
          )
        })}
      </div>
      <div className="sec log" ref={logRef}>
        <div className="lbl">메모 (부른 단어 {state.calls.length}개 · 대화)</div>
        {items.length === 0 && <div className="muted sm">아직 없어요. 아래에서 대화할 수 있어요.</div>}
        {items.map((it) => {
          if (it.kind === 'chat') {
            const p = person(it.m.userId)
            return (
              <div key={it.key} className={'cm chat' + (it.m.userId === me ? ' mine' : '')} style={{ ['--c' as string]: COLORS[p.color % COLORS.length] }}>
                <b>{p.nickname}</b><span className="t">{fmtTime(it.at)}</span><br />{it.m.body}
              </div>
            )
          }
          const c = it.c
          const p = person(c.userId)
          return (
            <div key={it.key}>
              <div className="cm call" style={{ ['--c' as string]: COLORS[p.color % COLORS.length] }}>
                <b>{p.nickname}</b><span className="t">{fmtTime(c.at)} · 부름{c.auto ? ' (시간 초과 자동)' : ''}</span><br />
                <strong className={'w' + (c.custom ? ' cu' : '')}>{c.word}</strong>
              </div>
              {c.tongs.length > 0 && <div className="cm sys">🎉 {[c.userId, ...c.tongs].map((id) => person(id).nickname).join(' · ')} 통했다! ({c.word})</div>}
            </div>
          )
        })}
      </div>
      <form className="bd-chat" onSubmit={send}>
        <input ref={inputRef} value={text} maxLength={200} readOnly={busy} onChange={(e) => setText(e.target.value)} placeholder="메모 입력 (대화)" />
        <button disabled={!text.trim() || busy} onMouseDown={(e) => e.preventDefault()}>전송</button>
      </form>
    </>
  )
}
