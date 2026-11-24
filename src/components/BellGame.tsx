import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBell } from '../hooks/useBell'
import { api, ApiError, type RoomFull } from '../lib/api'
import { KIND_NAME, TURN_SECONDS, cardCount, cardKind, type BellState } from '../lib/bell'
import { useTurnAlert } from '../hooks/useTurnAlert'
import './bell.css'

const FILE_NAME = '4Q_부서별_현황점검_draft.pptx'
const TEAMS = ['영업2팀', '마케팅팀', '재무팀', '인사팀']
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/* 아이콘 4종 (파란 단색, 모양으로 구분) */
const B = '#1428a0'
function Icon({ k }: { k: number }) {
  if (k === 0) return <svg viewBox="0 0 64 64"><circle cx="32" cy="20" r="11" fill={B} /><path d="M12 56c0-12 9-20 20-20s20 8 20 20z" fill={B} /></svg>
  if (k === 1) return <svg viewBox="0 0 64 64"><rect x="10" y="52" width="44" height="3" fill="#9aa6c4" /><rect x="13" y="34" width="9" height="18" fill={B} /><rect x="28" y="22" width="9" height="30" fill={B} /><rect x="43" y="10" width="9" height="42" fill={B} /></svg>
  if (k === 2) return <svg viewBox="0 0 64 64"><path d="M32 6a18 18 0 0 0-10 33c2 2 3 4 3 7h14c0-3 1-5 3-7A18 18 0 0 0 32 6z" fill="none" stroke={B} strokeWidth="5" /><rect x="25" y="49" width="14" height="4" fill={B} /><rect x="27" y="55" width="10" height="4" fill={B} /></svg>
  return <svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="23" fill="none" stroke={B} strokeWidth="5" /><circle cx="32" cy="32" r="13" fill="none" stroke={B} strokeWidth="5" /><circle cx="32" cy="32" r="4" fill={B} /></svg>
}

function MiniCard({ card, stack, onClick, hot, hit, flipIn }: { card: number | null; stack: boolean; onClick?: () => void; hot?: boolean; hit?: boolean; flipIn?: boolean }) {
  return (
    <button type="button" className={'bl-card' + (stack ? ' stack' : '') + (card === null ? ' empty' : '') + (hot ? ' hot' : '') + (hit ? ' hit' : '') + (flipIn ? ' flipin' : '')} onClick={onClick} disabled={!onClick} aria-label={card === null ? '펼친 카드 없음' : `${KIND_NAME[cardKind(card)]} ${cardCount(card)}`}>
      {card !== null && Array.from({ length: cardCount(card) }, (_, i) => <Icon key={i} k={cardKind(card)} />)}
      {card === null && <span>—</span>}
    </button>
  )
}

export default function BellGame({ room }: { room: RoomFull }) {
  const nav = useNavigate()
  const { state, error, refresh, announce, remaining, gameLeft, serverNow } = useBell(room.code)
  const [toast, setToast] = useState('')
  const busy = useRef(false)
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? '' : t)), 2200) }
  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); await refresh(); return true } catch (e) { flash(e instanceof ApiError ? e.message : '실패했어요'); return false }
  }

  const me = room.me
  const isHost = room.hostId === me
  const myTurn = !!state && state.phase === 'play' && !!state.deadline && state.playerIds[state.turnIndex] === me
  const myHand = state?.hands[me]
  const alive = !!myHand && myHand.deck + myHand.face > 0
  // 방금 뒤집은 카드가 아직 공개 전이면 차례 표시도 그 사람에게 머묾
  const lv0 = state?.last
  const revealing = !!lv0 && lv0.type === 'flip' && !!lv0.until && new Date(lv0.until).getTime() > serverNow()
  const [flipping, setFlipping] = useState(false) // 내가 누른 직후 서버 응답 전 (카드 뒷면 먼저 보여줌)
  const myTurnShown = myTurn && !revealing && !flipping
  useTurnAlert(myTurnShown)

  const flip = async () => {
    if (!myTurnShown || busy.current) return
    busy.current = true
    setFlipping(true)
    try { await api.bellFlip(room.code); await announce() } catch (e) { flash(e instanceof ApiError ? e.message : '실패했어요') }
    setFlipping(false)
    busy.current = false
  }
  const ring = async () => {
    if (!state || state.phase !== 'play' || !state.inGame || !alive) return
    const u = state.last?.type === 'flip' ? state.last.until : null
    if (u && new Date(u).getTime() > serverNow()) return // 아직 공개 전 카드
    try {
      const r = await api.bellRing(room.code, state.version)
      if (r.late) { flash('한발 늦었어요. 이미 카드가 바뀌었어요'); await refresh() } else await announce()
    } catch (e) { flash(e instanceof ApiError ? e.message : '실패했어요') }
  }

  // Space = 카드 뒤집기, J = 승인, Enter = 대화 입력 (입력칸에서는 무시)
  const typedAt = useRef(0)
  const keyRef = useRef({ flip, ring })
  keyRef.current = { flip, ring }
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select') || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.code === 'Space') { e.preventDefault(); void keyRef.current.flip() }
      else if (e.code === 'KeyJ') {
        // 대화창 밖에서 글자를 치다 섞인 J(한글 ㅓ)는 승인으로 치지 않음
        if (Date.now() - typedAt.current < 700) return
        e.preventDefault(); void keyRef.current.ring()
      } else if (e.key === 'Enter') {
        e.preventDefault(); document.querySelector<HTMLInputElement>('.bl .chat .ci input')?.focus()
      } else if (/^(Key[A-Z]|Digit\d)$/.test(e.code)) typedAt.current = Date.now()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const leave = async () => {
    if (state && state.phase === 'play' && !window.confirm('게임 중에 나가면 이번 판에는 다시 들어올 수 없어요. 나갈까요?')) return
    try { await api.leaveRoom(room.code) } catch { /* 무시 */ }
    nav('/games')
  }

  if (!state) return <div className="room-center"><p className="muted">{error || '불러오는 중…'}</p></div>

  const person = (id: string | null) => (id && state.people[id]) || { nickname: '?', color: 0 }
  const active = new Set(room.players.map((p) => p.id))
  const turnId = state.phase === 'play' && state.deadline ? state.playerIds[state.turnIndex] : null
  const n = state.playerIds.length
  let nextName = ''
  for (let k = 1; k < n; k++) {
    const id = state.playerIds[(state.turnIndex + k) % n]
    if (active.has(id) && (state.hands[id]?.deck ?? 0) > 0) { nextName = person(id).nickname; break }
  }
  // 뒤집은 카드는 공개 시각까지 이전 카드로, 승인 성공 직후엔 맞힌 카드들을 잠깐 보여줌
  const lv = state.last
  const holdLeft = lv?.until ? new Date(lv.until).getTime() - serverNow() : 0
  let view = state
  let hitKind: number | null = null
  if (holdLeft > 0 && lv?.type === 'flip' && state.hands[lv.by]) {
    const h = state.hands[lv.by]
    view = { ...state, hands: { ...state.hands, [lv.by]: { ...h, top: lv.prev ?? null, face: Math.max(0, h.face - 1), deck: h.deck + 1 } } }
  } else if (holdLeft > 0 && lv?.type === 'ring' && lv.ok && lv.tops) {
    const tops = lv.tops
    hitKind = lv.kind ?? null
    view = { ...state, hands: Object.fromEntries(Object.entries(state.hands).map(([id, h]) => [id, { ...h, top: tops[id] ?? null, face: tops[id] != null ? 1 : 0 }])) }
  }
  const backId = flipping ? me : revealing && lv ? lv.by : null // 뒷면으로 보일 자리
  const flipInId = !revealing && lv?.type === 'flip' ? lv.by : null // 막 공개된 자리 (뒤집히는 효과)
  const turnShown = backId ?? turnId
  const tableTotal = Object.values(view.hands).reduce((a, h) => a + h.face, 0)
  const last = state.last
  const lastAge = last ? (Date.now() - new Date(last.at).getTime()) / 1000 : 99
  const ringFlash = last?.type === 'ring' && lastAge < 4 ? last : null

  return (
    <div className="bl">
      <div className="bl-title"><span className="bl-logo">P</span><span className="bl-auto">자동 저장 ● 켬</span><span className="bl-tmid">{FILE_NAME} — 공동 작업 중</span>
        <span className="bl-avs">{state.playerIds.map((id) => <i key={id} className={active.has(id) ? '' : 'off'}>{[...person(id).nickname][0]}</i>)}</span>
        <button className="bl-leave" onClick={leave}>나가기</button></div>
      <div className="bl-tabs">{['파일', '홈', '삽입', '디자인', '전환', '애니메이션', '슬라이드 쇼', '검토', '보기'].map((t) => <span key={t} className={t === '검토' ? 'on' : ''}>{t}</span>)}</div>
      <div className="bl-ribbon">
        <div className="grp"><button className="big" disabled={!myTurn} onClick={flip}>
          <svg viewBox="0 0 32 32"><rect x="4" y="7" width="20" height="16" rx="2" fill="#fff" stroke="#888" strokeWidth="2" /><path d="M20 16h9m-3-4 4 4-4 4" stroke="#1428a0" strokeWidth="2.5" fill="none" strokeLinecap="round" /></svg>
          제출 (카드 뒤집기)<kbd>Space</kbd></button><b>진행</b></div>
        <div className="grp"><button className="big" disabled={state.phase !== 'play' || !state.inGame || !alive} onClick={ring}>
          <svg viewBox="0 0 32 32"><rect x="4" y="6" width="24" height="20" fill="#1428a0" /><path d="M10 16.5l4 4 8-9" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          승인<kbd>J</kbd></button><b>검토</b></div>
        <div className="grp hide-sm"><div className="row"><span className="sm">맞춤법 검사</span><span className="sm">새 메모</span></div><div className="row"><span className="sm">비교</span><span className="sm">변경 내용 추적</span></div><b>교정</b></div>
      </div>

      {/* 알림 줄: 항상 같은 높이로 두고 내용만 바꿈 (화면 흔들림 방지) */}
      {(() => {
        if (ringFlash) return ringFlash.ok
          ? <div className="bl-bar ok" role="status"><span className="ic">✔</span><b>{person(ringFlash.by).nickname} 님 승인</b><span className="sub">{KIND_NAME[ringFlash.kind ?? 0]} 합계 5 · 펼쳐진 카드 +{ringFlash.gained}장 회수</span></div>
          : <div className="bl-bar bad" role="status"><span className="ic">✕</span><b>{person(ringFlash.by).nickname} 님 반려</b><span className="sub">5가 아니에요 · 다른 사람에게 {ringFlash.given}장 지급</span></div>
        if (state.phase !== 'play') return <div className="bl-bar wait" role="status"><span className="ic">■</span><b>점검 완료</b><span className="sub">이번 판 결과를 확인하세요</span></div>
        const urgent = remaining !== null && remaining <= 2
        const pct = remaining !== null ? Math.min(100, (remaining / TURN_SECONDS) * 100) : 0
        const timer = remaining !== null && <span className="tm">{Math.ceil(remaining)}초<span className="tbar"><i style={{ width: `${pct}%` }} /></span></span>
        if (backId) return <div className="bl-bar wait" role="status"><span className="ic">↻</span><b>{person(backId).nickname} 님 카드 공개 중…</b><span className="sub">{turnId && turnId !== backId ? `곧 ${person(turnId).nickname} 님 차례` : '맨 위 카드끼리 같은 아이콘 합계 5면 J'}</span></div>
        if (myTurn) return <div className={'bl-bar mine' + (urgent ? ' urgent' : '')} role="status"><span className="ic">●</span><b>내 차례예요</b><span className="sub">Space 또는 내 카드를 눌러 한 장 제출{nextName ? ` · 다음은 ${nextName} 님` : ''}</span>{timer}</div>
        if (turnId) return <div className="bl-bar wait" role="status"><span className="ic">○</span><b>{person(turnId).nickname} 님 제출 중</b><span className="sub">{nextName ? `다음은 ${nextName} 님` : '맨 위 카드끼리 같은 아이콘 합계 5면 J'}</span>{timer}</div>
        return <div className="bl-bar wait" role="status"><span className="ic">○</span><b>준비 중</b><span className="sub">곧 시작돼요</span></div>
      })()}

      <div className="bl-main">
        <div className="bl-thumbs hide-sm">{[1, 2, 3].map((i) => <div key={i} className={'th' + (i === 2 ? ' on' : '')}><i>{i}</i><div className="s"><b /><em /><em /><em style={{ width: '60%' }} /></div></div>)}</div>
        <div className="bl-stage">
          <div className="bl-slide">
            <div className="topband" />
            <div className="trk"><span>01 현황</span><span className={state.phase === 'play' ? 'on' : ''}>02 점검</span><span className={state.phase === 'result' ? 'on' : ''}>03 결론</span></div>
            {state.phase === 'play' ? (
              <PlaySlide state={view} hitKind={hitKind} backId={backId} flipInId={flipInId} me={me} turnId={turnShown} person={person} active={active} tableTotal={tableTotal} gameLeft={gameLeft}
                ringFlash={ringFlash} canRing={state.inGame && alive} onRing={ring} onFlip={flip} myTurn={myTurnShown}
                onChat={(t) => run(() => api.bellChat(room.code, t))} />
            ) : (
              <ResultSlide state={state} me={me} person={person} isHost={isHost}
                onNext={() => run(() => api.bellStart(room.code))} onWaiting={() => run(() => api.bellToWaiting(room.code))}
                onChat={(t) => run(() => api.bellChat(room.code, t))} />
            )}
            <div className="ft"><span>○○주식회사 · 대외비</span><span>{n}개 부서{gameLeft !== null ? ` · ${mmss(gameLeft)} 남음` : ''}</span><span>2</span></div>
          </div>
          <div className="bl-notes"><b>슬라이드 노트</b> · {noteText(state, person)}</div>
        </div>
      </div>
      <div className="bl-status"><span>슬라이드 2/3</span><span>한국어</span><span className="sp" /><span>Space 뒤집기 · J 승인 · Enter 대화</span></div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function noteText(state: BellState, person: (id: string | null) => { nickname: string }) {
  const l = state.last
  if (state.phase === 'result') return '판이 끝났어요'
  if (!l) return '첫 차례가 카드를 펼치면 시작돼요 · 맨 위 카드끼리만 합산'
  if (l.type === 'flip') return `${person(l.by).nickname} 님이 ${KIND_NAME[cardKind(l.card ?? 0)]} ${cardCount(l.card ?? 0)}을 제출${l.auto ? ' (시간 초과 자동)' : ''} · 맨 위 카드끼리만 합산`
  return l.ok ? `${person(l.by).nickname} 님 승인 성공 (+${l.gained}장)` : `${person(l.by).nickname} 님 반려 (${l.given}장 지급)`
}

type Person = (id: string | null) => { nickname: string; color: number }

function PlaySlide({ state, hitKind, backId, flipInId, me, turnId, person, active, tableTotal, gameLeft, ringFlash, canRing, onRing, onFlip, myTurn, onChat }: {
  state: BellState; hitKind: number | null; backId: string | null; flipInId: string | null; me: string; turnId: string | null; person: Person; active: Set<string>; tableTotal: number; gameLeft: number | null
  ringFlash: BellState['last']; canRing: boolean; onRing: () => void; onFlip: () => void; myTurn: boolean; onChat: (t: string) => void
}) {
  const n = state.playerIds.length
  const maxWon = Math.max(20, ...Object.values(state.hands).map((h) => h.won))
  return (
    <>
      <h1>부서별 최신 제출 현황 점검</h1>
      <p className="lead">각 부서 최신 제출(맨 위 카드) 기준, 같은 아이콘 합계가 정확히 5가 되는 순간 즉시 승인</p>
      <div className="rule" />
      <div className={'body n' + n}>
        <div className="tblwrap">
          <div className="ex"><span><b>표 2.</b> 부서별 제출 · 잔여 · 획득 현황 ({n}개 부서)</span><span>단위: 장</span></div>
          <table>
            <thead><tr><th>부서</th><th>최신 제출</th><th>누적 제출</th><th>잔여</th><th>획득</th></tr></thead>
            <tbody>
              {state.playerIds.map((id, i) => {
                const h = state.hands[id] ?? { deck: 0, face: 0, top: null, won: 0, ok: 0, bad: 0 }
                const out = !active.has(id) || h.deck + h.face === 0
                const isMe = id === me
                return (
                  <tr key={id} className={(turnId === id ? 'turn ' : '') + (isMe ? 'me ' : '') + (out ? 'out ' : '') + (ringFlash?.ok && ringFlash.by === id ? 'win' : '')}>
                    <td className="nm"><b>{TEAMS[i] ?? `${i + 1}팀`}{isMe && <em>나</em>}</b><small>{person(id).nickname}{out ? ' · 제외' : turnId === id ? ' · 제출 중' : ''}</small></td>
                    <td>{backId === id
                      ? <span className="bl-card back stack" aria-label="카드 공개 중"><i>보고서</i></span>
                      : <MiniCard key={`${h.top}:${h.face}`} card={h.top} stack={h.face > 1} onClick={isMe && myTurn ? onFlip : undefined} hot={isMe && myTurn}
                          flipIn={flipInId === id} hit={hitKind !== null && h.top !== null && cardKind(h.top) === hitKind} />}</td>
                    <td><span className="num">{h.face}<small>장</small></span></td>
                    <td><span className="num">{h.deck}<small>장</small></span></td>
                    <td><div className="won"><div className="bar"><i style={{ width: `${Math.min(100, (h.won / maxWon) * 100)}%` }} /></div><b>{h.won}장</b></div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="src">※ 최신 제출 항목끼리만 합산 · 틀린 승인은 다른 부서에 1장씩 지급 · 자기 차례 {TURN_SECONDS}초가 지나면 자동 제출</div>
        </div>
        <div className="side">
          <div className="kbox">
            <div><small>테이블 누적 제출</small><div className="kpi">{tableTotal}<small>장</small></div>{gameLeft !== null && <small className="left">남은 시간 {mmss(gameLeft)}</small>}</div>
            <button className={'appr' + (ringFlash?.ok ? ' hot' : '')} disabled={!canRing} onClick={onRing}>승 인<span>J</span></button>
          </div>
          <ChatBox state={state} me={me} person={person} onChat={onChat} />
        </div>
      </div>
    </>
  )
}

function ResultSlide({ state, me, person, isHost, onNext, onWaiting, onChat }: {
  state: BellState; me: string; person: Person; isHost: boolean; onNext: () => void; onWaiting: () => void; onChat: (t: string) => void
}) {
  const res = state.result?.players ?? {}
  const rows = state.playerIds.map((id, i) => ({ id, team: TEAMS[i] ?? `${i + 1}팀`, ...(res[id] ?? { cards: 0, won: 0, ok: 0, bad: 0 }) }))
    .sort((a, b) => b.cards - a.cards || b.won - a.won)
  const max = Math.max(1, ...rows.map((r) => r.cards))
  const reason = { last: '한 부서만 남아 종료', nodeck: '제출할 카드가 모두 소진되어 종료', time: '제한 시간 종료' }[state.result?.reason ?? 'time']
  return (
    <>
      <h1>{state.winner ? `${rows[0]?.team}(${person(state.winner).nickname}), 최종 보유 카드 1위` : '결론'}</h1>
      <p className="lead">{reason} · 판 {state.roundNo} · 누적 우승 {Object.entries(state.scores).map(([id, v]) => `${person(id).nickname} ${v}`).join(' · ') || '-'}</p>
      <div className="rule" />
      <div className="body">
        <div className="tblwrap">
          <div className="ex"><span><b>표 3.</b> 부서별 최종 보유 카드 · 승인 실적</span><span>단위: 장 / 회</span></div>
          <table>
            <thead><tr><th>순위</th><th>부서</th><th>최종 보유</th><th>획득</th><th>승인</th><th>반려</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className={(r.id === me ? 'me ' : '') + (i === 0 ? 'win' : '')}>
                  <td><span className="rank">{i + 1}</span></td>
                  <td className="nm"><b>{r.team}{r.id === me && <em>나</em>}</b><small>{person(r.id).nickname}</small></td>
                  <td><div className="won"><div className="bar"><i style={{ width: `${(r.cards / max) * 100}%` }} /></div><b>{r.cards}장</b></div></td>
                  <td><span className="num">{r.won}<small>장</small></span></td>
                  <td><span className="num">{r.ok}<small>회</small></span></td>
                  <td><span className="num">{r.bad}<small>회</small></span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="src">※ 최종 보유 = 남은 덱 + 펼친 카드 · 같으면 획득이 많은 부서가 앞</div>
        </div>
        <div className="side">
          <div className="kbox col">
            {isHost ? (
              <><button className="appr" onClick={onNext}>다시 하기</button><button className="ghost" onClick={onWaiting}>대기실로</button></>
            ) : <small>방장이 다음 판을 시작할 때까지 기다려 주세요</small>}
          </div>
          <ChatBox state={state} me={me} person={person} onChat={onChat} />
        </div>
      </div>
    </>
  )
}

function ChatBox({ state, me, person, onChat }: { state: BellState; me: string; person: Person; onChat: (t: string) => void }) {
  const [text, setText] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight }, [state.chats.length])
  const send = (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    onChat(t)
    setText('') // 보낸 뒤에도 입력칸에 남아 이어서 칠 수 있음
  }
  return (
    <div className="chat">
      <div className="ch">대화 <span>{state.playerIds.length}명 참여 중</span></div>
      <div className="cb" ref={box}>
        {state.chats.map((m) => (
          <div key={m.id} className={'m' + (m.userId === null ? ' sys' : m.userId === me ? ' me' : '')}>
            {m.userId !== null && <b>{person(m.userId).nickname}</b>}{m.body}
          </div>
        ))}
      </div>
      <form className="ci" onSubmit={send}>
        <input value={text} maxLength={200} placeholder="Enter로 대화 · 빈 칸 Enter·Esc로 게임" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // 빈 칸에서 Enter, 또는 Esc → 게임으로 돌아감
            if (e.key === 'Escape' || (e.key === 'Enter' && !e.nativeEvent.isComposing && !text.trim())) { e.preventDefault(); (e.target as HTMLInputElement).blur() }
          }} />
        <button disabled={!text.trim()}>전송</button>
      </form>
    </div>
  )
}
