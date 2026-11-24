import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiar } from '../hooks/useLiar'
import { api, ApiError, type RoomFull } from '../lib/api'
import { APPEAL_SECONDS, DEFENSE_SECONDS, GUESS_SECONDS, REVOTE_SECONDS, VOTE_SECONDS, type LiarMessage, type LiarState } from '../lib/liar'
import { COLORS } from '../lib/colors'
import NextTopic from './NextTopic'
import TurnBanner from './TurnBanner'
import { useTurnAlert } from '../hooks/useTurnAlert'

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export default function LiarGame({ room }: { room: RoomFull }) {
  const nav = useNavigate()
  const { state, error, refresh, remaining } = useLiar(room.code)
  const [toast, setToast] = useState('')

  const flash = (m: string) => {
    setToast(m)
    window.setTimeout(() => setToast((t) => (t === m ? '' : t)), 2400)
  }
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await refresh()
      return true
    } catch (e) {
      flash(e instanceof ApiError ? e.message : '실패했어요')
      return false
    }
  }

  const leave = async () => {
    if (state && state.phase !== 'result' && !window.confirm('게임 중에 나가면 이번 판에는 다시 들어올 수 없어요. 나갈까요?')) return
    try { await api.leaveRoom(room.code) } catch { /* 무시 */ }
    nav('/')
  }

  // 내 차례(힌트·제시어 맞히기)면 다른 탭에 있어도 알 수 있게
  const alertOn = !!state && ((state.phase === 'hint' && state.playerIds[state.turnIndex % state.playerIds.length] === room.me)
    || (state.phase === 'guess' && state.role === 'liar'))
  useTurnAlert(alertOn)

  if (!state) {
    return <div className="room-center"><p className="muted">{error || '게임 불러오는 중…'}</p></div>
  }

  const me = room.me
  const isHost = room.hostId === me
  const n = state.playerIds.length
  const person = (id: string | null) => (id && state.people[id]) || { nickname: '?', color: 0 }
  const speaker = state.phase === 'hint' ? state.playerIds[state.turnIndex % n] : null
  const myTurn = speaker === me
  const online = new Set(room.players.filter((p) => p.online).map((p) => p.id))
  const active = new Set(room.players.map((p) => p.id))
  // 다음 힌트 차례 (나간 사람은 건너뜀). 마지막이면 토론
  let nextText = ''
  if (state.phase === 'hint') {
    nextText = '다음은 토론'
    for (let t = state.turnIndex + 1; t < state.hintRounds * n; t++) {
      const id = state.playerIds[t % n]
      if (active.has(id)) { nextText = `다음은 ${person(id).nickname} 님`; break }
    }
  }

  return (
    <div className="lg">
      <nav className="lg-rail" aria-hidden>
        <div className="lg-logo">W</div>
        <span className="on"><IconChat /></span>
        <span><IconUser /></span>
        <span><IconCal /></span>
        <span><IconDoc /></span>
      </nav>

      <aside className="lg-side">
        <div className="lg-me">
          <strong>탕비실</strong>
          <span>{person(me).nickname} · 접속 중</span>
        </div>
        <input className="lg-search" placeholder="검색" aria-label="검색" />
        <div className="lg-side-label">참여 중인 방</div>
        <div className="lg-room on"># 라이어 게임 · {room.code}</div>
        <div className="lg-side-label">참가자</div>
        <ul className="lg-people">
          {state.playerIds.map((id) => (
            <li key={id} className={active.has(id) ? '' : 'gone'}>
              <i className={'dot' + (online.has(id) ? ' on' : '')} />
              <span>{person(id).nickname}{id === room.hostId ? ' (방장)' : ''}</span>
              {!!state.scores[id] && <em>{state.scores[id]}승</em>}
            </li>
          ))}
        </ul>
        <button className="lg-leave" onClick={leave}>방 나가기</button>
      </aside>

      <main className="lg-main">
        <header className="lg-head">
          <strong># 라이어 게임 · {room.code}</strong>
          <span className="muted">참가자 {n}명</span>
          <button className="lg-leave-sm" onClick={leave}>나가기</button>
        </header>

        {myTurn && (
          <TurnBanner title="내 힌트 차례예요" sub="아래 노란 칸에 힌트를 쓰세요" next={nextText} remaining={remaining} total={state.hintSeconds} />
        )}
        {state.phase === 'guess' && state.role === 'liar' && (
          <TurnBanner title="제시어를 맞힐 차례예요" sub="아래 빨간 칸에 입력하세요 · 기회는 한 번" remaining={remaining} total={GUESS_SECONDS} />
        )}

        <div className="lg-pin">
          <span className="pin-tag">고정</span>
          <span>주제: <b>{state.category}</b></span>
          <span className="pin-sep">·</span>
          <span>제시어: <b>{state.word ?? (state.role === 'liar' ? '???' : '-')}</b></span>
          {state.role === 'liar' && state.phase !== 'result' && state.phase !== 'appeal' && <span className="pin-liar">당신은 라이어</span>}
          <span className="pin-note">
            {state.phase === 'result' || state.phase === 'appeal' ? '게임이 끝나 제시어를 공개했어요' : state.role === 'liar' ? '다른 사람 힌트로 제시어를 추리하세요' : '라이어에게는 제시어가 보이지 않아요'}
          </span>
        </div>

        <Messages state={state} me={me} person={person} onReact={(id, e) => run(() => api.liarReact(room.code, id, e))} />

        <Composer
          state={state}
          me={me}
          speakerName={speaker ? person(speaker).nickname : ''}
          myTurn={myTurn}
          remaining={remaining}
          onHint={(t) => run(() => api.liarHint(room.code, t))}
          onGuess={(t) => run(() => api.liarGuess(room.code, t))}
          onChat={(t) => run(() => api.liarChat(room.code, t))}
          onEndDiscussion={() => run(() => api.liarEndDiscussion(room.code))}
        />
      </main>

      <aside className={'lg-panel' + (['vote', 'defense', 'revote', 'guess', 'result', 'appeal'].includes(state.phase) ? ' has-action' : '')}>
        <Progress state={state} remaining={remaining} />

        <section className="lg-sec role-sec">
          <h3>내 역할</h3>
          <div className={'role-card' + (state.role === 'liar' ? ' liar' : '')}>
            {state.role === 'liar' ? (
              <>
                <strong>라이어</strong>
                <p>주제는 "{state.category}"입니다. 당신은 라이어입니다. 다른 사람 힌트로 제시어를 추리하세요.</p>
              </>
            ) : state.role === 'citizen' ? (
              <>
                <strong>시민</strong>
                <p>주제는 "{state.category}", 제시어는 "{state.word}"입니다.</p>
              </>
            ) : (
              <p>이번 판에는 참여하지 않아요.</p>
            )}
          </div>
        </section>

        {state.phase === 'discuss' && (
          <section className="lg-sec order-sec">
            <h3>토론 끝내기</h3>
            <ol className="order">
              {state.playerIds.map((id, i) => {
                const status: [string, string] = !active.has(id) ? ['나감', 'dim'] : state.discussDone.includes(id) ? ['끝내기', 'ok'] : ['토론 중', 'dim']
                return (
                  <li key={id}>
                    <span className="idx">{i + 1}</span>
                    <Avatar name={person(id).nickname} color={person(id).color} />
                    <span className="nm">{person(id).nickname}{id === me ? ' (나)' : ''}</span>
                    <span className={'st ' + status[1]}>{status[0]}</span>
                  </li>
                )
              })}
            </ol>
          </section>
        )}

        {(state.phase === 'hint' || state.phase === 'discuss') && <HintBoard state={state} me={me} person={person} active={active} />}

        {state.phase === 'defense' && state.result?.firstVotes && (
          <section className="lg-sec">
            <h3>동점 · 해명 중</h3>
            <ul className="tally">
              {state.tieIds.map((id) => (
                <li key={id} className="accused">
                  <Avatar name={person(id).nickname} color={person(id).color} />
                  <span className="nm">{person(id).nickname}{id === me ? ' (나)' : ''}</span>
                  <span className="cnt">{state.result!.firstVotes![id] ?? 0}표</span>
                </li>
              ))}
            </ul>
            <p className="muted sm">
              {state.tieIds.includes(me) ? '지금 채팅으로 해명하세요. ' : '동점자의 해명을 들어보세요. '}
              잠시 후 동점자 중에서 다시 투표해요. 재투표도 동점이면 라이어가 이겨요.
            </p>
          </section>
        )}

        {(state.phase === 'vote' || state.phase === 'revote') && (
          <section className="lg-sec">
            <h3>{state.phase === 'revote' ? '재투표' : '투표'} <span className="muted sm">{state.votedCount}/{n}명 완료</span></h3>
            {state.inGame ? (
              <>
                {state.phase === 'revote' && <p className="muted sm">동점자 중에서만 고를 수 있어요.</p>}
                <div className="vote-list">
                  {state.playerIds.filter((id) => id !== me && (state.phase !== 'revote' || state.tieIds.includes(id))).map((id) => (
                    <button key={id} className={'vote-btn' + (state.myVote === id ? ' on' : '')}
                      onClick={() => run(() => api.liarVote(room.code, id))}>
                      <Avatar name={person(id).nickname} color={person(id).color} />
                      <span>{person(id).nickname}</span>
                      {state.myVote === id && <span className="check">✓ 선택</span>}
                    </button>
                  ))}
                </div>
                <p className="muted sm">마감 전까지 바꿀 수 있어요. 결과는 마감 후 한 번에 공개돼요.</p>
              </>
            ) : <p className="muted sm">이번 판 참가자만 투표해요.</p>}
          </section>
        )}

        {(state.phase === 'guess' || state.phase === 'result' || state.phase === 'appeal') && state.result && (
          <Outcome state={state} me={me} person={person} isHost={isHost} nextTopic={<NextTopic room={room} current={state.category} isHost={isHost} />}
            onNext={() => run(() => api.liarStart(room.code))}
            onWaiting={() => run(() => api.liarToWaiting(room.code))}
            onAppeal={() => run(() => api.liarAppeal(room.code))}
            onAppealVote={(v) => run(() => api.liarAppealVote(room.code, v))} />
        )}
      </aside>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

type PersonFn = (id: string | null) => { nickname: string; color: number }

const REACTIONS = ['😂', '🤔', '👀', '🙄']

function Messages({ state, me, person, onReact }: { state: LiarState; me: string; person: PersonFn; onReact: (id: number, e: string) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const last = state.messages[state.messages.length - 1]?.id
  useEffect(() => {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }, [last])
  return (
    <div className="lg-msgs" ref={box}>
      {state.messages.map((m) => <Message key={m.id} m={m} me={me} person={person} onReact={onReact} />)}
    </div>
  )
}

function Message({ m, me, person, onReact }: { m: LiarMessage; me: string; person: PersonFn; onReact: (id: number, e: string) => void }) {
  if (m.kind === 'system') return <div className="sys"><span>{m.body}</span></div>
  const p = person(m.userId)
  const rx = m.reactions ?? {}
  return (
    <div className={'msg-row' + (m.userId === me ? ' mine' : '')}>
      <Avatar name={p.nickname} color={p.color} big />
      <div className="msg-col">
        <div className="msg-meta"><strong>{p.nickname}</strong><span>{fmtTime(m.at)}</span>
          {m.kind === 'guess' && <span className="tag">제시어 답</span>}
        </div>
        {m.kind !== 'hint' ? <div className={'msg-body k-' + m.kind}>{m.body}</div> : (
          <>
            <div className="hint-wrap" tabIndex={-1}>
              <div className="msg-body k-hint"><span className="hint-tag">💡 힌트</span>{m.body}</div>
              <div className="rx-pick">
                {REACTIONS.map((e) => (
                  <button key={e} type="button" aria-label={`${e} 반응`} onMouseDown={(ev) => ev.preventDefault()} onClick={() => onReact(m.id, e)}>{e}</button>
                ))}
              </div>
            </div>
            {REACTIONS.some((e) => rx[e]?.length) && (
              <div className="rx">
                {REACTIONS.filter((e) => rx[e]?.length).map((e) => (
                  <button key={e} type="button" className={rx[e].includes(me) ? 'on' : ''} title={rx[e].map((u) => person(u).nickname).join(', ')}
                    onMouseDown={(ev) => ev.preventDefault()} onClick={() => onReact(m.id, e)}>
                    {e}<b>{rx[e].length}</b>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** 오른쪽 패널: 바퀴별 힌트 모음 (지금 차례는 파랑, 남은 차례는 대기) */
function HintBoard({ state, me, person, active }: { state: LiarState; me: string; person: PersonFn; active: Set<string> }) {
  const n = state.playerIds.length
  const said: Record<string, LiarMessage[]> = {}
  for (const m of state.messages) if ((m.kind === 'hint' || m.kind === 'timeout') && m.userId) (said[m.userId] ??= []).push(m)
  const lapNow = state.phase === 'hint' ? Math.floor(state.turnIndex / n) : state.hintRounds - 1
  const laps = []
  for (let lap = 0; lap <= Math.min(lapNow, state.hintRounds - 1); lap++) {
    laps.push(
      <div key={lap}>
        <div className="hb-round">{lap + 1}바퀴</div>
        <ol className="hb-list">
          {state.playerIds.map((id, i) => {
            const t = lap * n + i
            const msg = said[id]?.[lap]
            let cls = ''
            let text = ''
            if (msg) { text = msg.body; cls = msg.kind === 'timeout' ? 'late' : '' }
            else if (state.phase === 'hint' && t === state.turnIndex) { text = id === me ? '내 차례' : '입력 중…'; cls = 'now' }
            else if (!active.has(id) || t < state.turnIndex || state.phase !== 'hint') { text = '나감'; cls = 'wait' }
            else { text = '대기'; cls = 'wait' }
            return (
              <li key={id} className={'hb-item ' + cls}>
                <span className="nm">{person(id).nickname}{id === me ? ' (나)' : ''}</span>
                <span className="tx">{text}</span>
              </li>
            )
          })}
        </ol>
      </div>,
    )
  }
  return (
    <section className="lg-sec order-sec hb-panel">
      <h3>힌트 모음 <span className="muted sm">순서대로</span></h3>
      {laps}
    </section>
  )
}

function Composer({ state, me, speakerName, myTurn, remaining, onHint, onGuess, onChat, onEndDiscussion }: {
  state: LiarState; me: string; speakerName: string; myTurn: boolean; remaining: number | null
  onHint: (t: string) => Promise<boolean>; onGuess: (t: string) => Promise<boolean>; onChat: (t: string) => Promise<boolean>
  onEndDiscussion: () => void
}) {
  const chatRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLInputElement>(null)
  const isLiar = state.role === 'liar'
  const hintTurn = state.phase === 'hint' && myTurn
  const guessTurn = state.phase === 'guess' && isLiar

  let label = ''
  let total = 0
  switch (state.phase) {
    case 'hint':
      label = myTurn ? '내 힌트 차례예요' : `${speakerName} 님 힌트 차례예요`
      total = state.hintSeconds
      break
    case 'discuss': label = '토론 중'; total = state.discussSeconds; break
    case 'defense': label = '동점자 해명 중'; total = DEFENSE_SECONDS; break
    case 'revote': label = '재투표 중'; total = REVOTE_SECONDS; break
    case 'vote': label = '투표 중'; total = VOTE_SECONDS; break
    case 'guess': label = isLiar ? '제시어를 맞혀보세요' : '라이어가 제시어를 맞히는 중'; total = GUESS_SECONDS; break
    case 'appeal': label = '정답 인정 투표 중'; total = APPEAL_SECONDS; break
    case 'result': label = '게임 끝'; break
  }

  // 입력창 밖을 클릭했어도 글자를 치면 바로 입력창으로 (내 차례면 힌트 칸, 아니면 대화창)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return
      if (e.key.length === 1 || e.key === 'Process') (boxRef.current ?? chatRef.current)?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pct = remaining !== null && total ? Math.min(100, (remaining / total) * 100) : 0
  const ended = state.discussDone.includes(me)
  const chatPlaceholder =
    state.phase === 'defense' && state.tieIds.includes(me) ? '왜 라이어가 아닌지 해명하세요'
      : state.phase === 'appeal' && isLiar ? '왜 정답인지 설명해 보세요'
        : state.phase === 'hint' && !myTurn ? `대화 입력 · ${speakerName} 님이 힌트를 쓰는 중`
          : '대화 입력 (누구나 언제든)'

  return (
    <div className="lg-compose">
      <div className="lg-status">
        <span className={'lbl' + (hintTurn || guessTurn ? ' hot' : '')}>{label}</span>
        <div className={'bar' + ((hintTurn || guessTurn) && remaining !== null && remaining <= 5 ? ' urgent' : '')}><i style={{ width: `${pct}%` }} /></div>
        {remaining !== null && <span className="time">남은 시간 <b>{mmss(Math.ceil(remaining))}</b></span>}
        {state.phase === 'discuss' && state.inGame && (
          <button className="btn-line" disabled={ended} onClick={onEndDiscussion}>
            {ended ? '끝내기 누름' : '토론 끝내기'} ({state.discussDone.length}/{state.playerIds.length})
          </button>
        )}
      </div>
      {hintTurn && (
        <LineBox key={`h${state.roundNo}-${state.turnIndex}`} inputRef={boxRef} cls="hint-box"
          label="💡 내 힌트" time={remaining !== null ? mmss(Math.ceil(remaining)) : undefined}
          placeholder="제시어에 대한 힌트를 한 줄로 (최대 40자)" button="힌트 내기" onSend={onHint} />
      )}
      {guessTurn && (
        <LineBox key={`g${state.roundNo}`} inputRef={boxRef} cls="hint-box guess-box"
          label="🎯 제시어 맞히기" time={remaining !== null ? mmss(Math.ceil(remaining)) : undefined}
          placeholder="제시어 입력 (기회는 한 번)" button="제출" onSend={onGuess} />
      )}
      <LineBox inputRef={chatRef} cls="lg-input" placeholder={chatPlaceholder} limit={200} button="전송" onSend={onChat} />
    </div>
  )
}

/** 한 줄 입력 + 보내기. 성공하면 비우고, 처음 나타나면 바로 입력할 수 있게 포커스 */
function LineBox({ inputRef, cls, label, time, placeholder, limit = 40, button, onSend }: {
  inputRef: RefObject<HTMLInputElement>; cls: string; label?: string; time?: string; placeholder: string; limit?: number; button: string
  onSend: (t: string) => Promise<boolean>
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (label) inputRef.current?.focus()
  }, []) // 처음 나타날 때만
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    const ok = await onSend(t.slice(0, limit))
    setBusy(false)
    if (ok) setText('')
    inputRef.current?.focus()
  }
  return (
    <form className={cls} onSubmit={submit}>
      {label && <b className="lb-label">{label}{time && <span className="lb-time"> · {time}</span>}</b>}
      <input ref={inputRef} value={text} maxLength={limit} readOnly={busy}
        onChange={(e) => setText(e.target.value)} placeholder={placeholder} />
      <span className="cnt">{text.length}/{limit}</span>
      <button className="send" disabled={busy || !text.trim()} onMouseDown={(e) => e.preventDefault()}>{button}</button>
    </form>
  )
}

function Progress({ state, remaining }: { state: LiarState; remaining: number | null }) {
  const n = state.playerIds.length
  const steps = useMemo(() => {
    const s: { key: string; label: string }[] = []
    for (let r = 1; r <= state.hintRounds; r++) s.push({ key: `h${r}`, label: `힌트 ${r}바퀴` })
    s.push({ key: 'discuss', label: '토론' }, { key: 'vote', label: '투표' }, { key: 'result', label: '결과' })
    return s
  }, [state.hintRounds])
  const current =
    state.phase === 'hint' ? `h${Math.floor(state.turnIndex / n) + 1}` : state.phase === 'guess' || state.phase === 'appeal' ? 'result' : state.phase === 'defense' || state.phase === 'revote' ? 'vote' : state.phase
  const ci = steps.findIndex((s) => s.key === current)
  const roundPos = state.phase === 'hint' ? `${(state.turnIndex % n) + 1}/${n}` : ''
  return (
    <section className="lg-sec progress-sec">
      <h3>진행 <span className="muted sm">{state.roundNo}번째 게임</span></h3>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.key} className={i < ci ? 'done' : i === ci ? 'now' : ''}>
            <span className="num">{i < ci ? '✓' : i + 1}</span>
            <span>{s.label}{s.key === 'discuss' ? ` · ${mmss(state.phase === 'discuss' && remaining !== null ? remaining : state.discussSeconds)}` : ''}</span>
            {i === ci && roundPos && <em>{roundPos}</em>}
          </li>
        ))}
      </ol>
    </section>
  )
}

function Outcome({ state, me, person, isHost, nextTopic, onNext, onWaiting, onAppeal, onAppealVote }: {
  state: LiarState; me: string; person: PersonFn; isHost: boolean; nextTopic: React.ReactNode; onNext: () => void; onWaiting: () => void
  onAppeal: () => void; onAppealVote: (accept: boolean) => void
}) {
  const r = state.result!
  const votes = r.votes ?? {}
  const rows = [...state.playerIds].sort((a, b) => (votes[b] ?? 0) - (votes[a] ?? 0))
  const iWon = state.phase === 'result' && r.winner && ((r.winner === 'liar') === (state.role === 'liar'))
  const isLiar = state.role === 'liar'
  const canAppeal = state.phase === 'result' && isLiar && r.winner === 'citizen' && !!r.guess && !r.appeal
  const voters = state.playerIds.length - 1
  const ap = r.appeal
  return (
    <>
      {state.phase === 'result' && r.winner && (
        <section className="lg-sec">
          <div className={'winner ' + r.winner}>
            <strong>{r.winner === 'liar' ? '라이어 승리' : '시민 승리'}</strong>
            {state.inGame && <span>{iWon ? '이겼어요' : '졌어요'}</span>}
          </div>
          <p className="muted sm reason">{r.reason}</p>
          <p className="sm">라이어: <b>{person(r.liarId ?? null).nickname}</b> · 제시어: <b>{r.word}</b></p>
          {ap && ap.accepted !== undefined && (
            <p className="sm appeal-line">
              이의 신청 {ap.accepted ? '인정됨' : '거절됨'} · 인정 {ap.yes} / 불인정 {ap.no} (과반 {Math.floor((ap.eligible ?? 0) / 2) + 1}표 필요)
            </p>
          )}
          {canAppeal && (
            <div className="appeal-box">
              <p className="sm">같은 뜻인데 오답 처리됐나요? 이의 신청하면 라이어를 뺀 참가자 과반이 인정할 때 라이어 승리로 바뀌어요. (한 번만)</p>
              <button className="btn-line" onClick={onAppeal}>이의 신청</button>
            </div>
          )}
        </section>
      )}
      {state.phase === 'appeal' && (
        <section className="lg-sec">
          <h3>정답 인정 투표 <span className="muted sm">{state.appealVotedCount}/{voters}명 완료</span></h3>
          <p className="sm appeal-q">라이어 답 <b>{r.guess}</b> · 제시어 <b>{state.word}</b></p>
          {isLiar ? (
            <p className="muted sm">참가자들이 투표하는 중이에요. 채팅으로 해명할 수 있어요.</p>
          ) : state.inGame ? (
            <>
              <div className="appeal-btns">
                <button className={'vote-btn' + (state.myAppeal === true ? ' on' : '')} onClick={() => onAppealVote(true)}>정답 인정</button>
                <button className={'vote-btn' + (state.myAppeal === false ? ' on' : '')} onClick={() => onAppealVote(false)}>인정 안 함</button>
              </div>
              <p className="muted sm">과반({Math.floor(voters / 2) + 1}표)이 인정하면 라이어 승리로 바뀌어요. 투표 안 하면 인정 안 한 걸로 쳐요.</p>
            </>
          ) : null}
        </section>
      )}
      {r.firstVotes && (
        <section className="lg-sec">
          <h3>1차 투표 <span className="muted sm">동점 → 재투표</span></h3>
          <ul className="tally">
            {state.playerIds.filter((id) => r.firstVotes![id]).sort((a, b) => r.firstVotes![b] - r.firstVotes![a]).map((id) => (
              <li key={id}>
                <Avatar name={person(id).nickname} color={person(id).color} />
                <span className="nm">{person(id).nickname}{id === me ? ' (나)' : ''}</span>
                <span className="cnt">{r.firstVotes![id]}표</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="lg-sec">
        <h3>{r.firstVotes ? '재투표 결과' : '투표 결과'}</h3>
        <ul className="tally">
          {rows.map((id) => (
            <li key={id} className={id === r.accusedId ? 'accused' : ''}>
              <Avatar name={person(id).nickname} color={person(id).color} />
              <span className="nm">
                {person(id).nickname}{id === me ? ' (나)' : ''}
                {id === state.liarId && <span className="liar-tag">라이어</span>}
              </span>
              <span className="cnt">{votes[id] ?? 0}표</span>
            </li>
          ))}
        </ul>
        {r.voteDetail && r.voteDetail.length > 0 && (
          <details className="detail">
            <summary>누가 누구에게 투표했나</summary>
            <ul>
              {r.voteDetail.map((v) => <li key={v.voter}>{person(v.voter).nickname} → {person(v.target).nickname}</li>)}
            </ul>
          </details>
        )}
      </section>
      {state.phase === 'result' && (
        <section className="lg-sec">
          {nextTopic}
          {isHost ? (
            <div className="host-btns">
              <button className="btn-blue" onClick={onNext}>다음 판</button>
              <button className="btn-line" onClick={onWaiting}>대기실로</button>
            </div>
          ) : (
            <p className="muted sm">방장이 다음 판을 시작할 수 있어요.</p>
          )}
        </section>
      )}
    </>
  )
}

function Avatar({ name, color, big }: { name: string; color: number; big?: boolean }) {
  return <span className={'av' + (big ? ' big' : '')} style={{ background: COLORS[color % COLORS.length] }}>{[...name][0]}</span>
}

const svg = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const IconChat = () => <svg {...svg}><path d="M4 5h16v11H9l-5 4z" /></svg>
const IconUser = () => <svg {...svg}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></svg>
const IconCal = () => <svg {...svg}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>
const IconDoc = () => <svg {...svg}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></svg>
