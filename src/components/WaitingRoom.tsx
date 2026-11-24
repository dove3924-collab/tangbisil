import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, type Player, type RoomFull, type RoomSettings } from '../lib/api'
import { GAMES } from '../lib/games'
import { LIAR_CATEGORIES } from '../lib/liar'
import { supabase } from '../lib/supabase'
import { COLORS } from '../lib/colors'
import { track } from '../lib/analytics'
import { battlePuzzles } from '../shapes/logic'
import { battleBoards } from '../cable/logic'

const MIN_PLAYERS: Record<string, number> = { liar: 3, bingo: 2, bell: 2, shapevs: 2, alkkagi: 2, cablevs: 2 }

type Panel = 'people' | 'chat' | null

interface ChatMsg { id: string; from: string; name: string; text: string }

export default function WaitingRoom({ room, refresh }: { room: RoomFull; refresh: () => Promise<void> }) {
  const nav = useNavigate()
  const [panel, setPanel] = useState<Panel>('people')
  const [toast, setToast] = useState('')
  const [chat, setChat] = useState<ChatMsg[]>([])
  const [unread, setUnread] = useState(0)
  const chatChannel = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const panelRef = useRef(panel)
  panelRef.current = panel

  const game = GAMES.find((g) => g.id === room.game)
  const isHost = room.hostId === room.me
  const me = room.players.find((p) => p.id === room.me)
  const link = `${location.origin}/r/${room.code}`
  const minPlayers = MIN_PLAYERS[room.game] ?? 2
  const canStart = room.players.length >= minPlayers

  const flash = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? '' : t)), 2200)
  }

  // 대기실 채팅: 저장하지 않는 실시간 메시지
  useEffect(() => {
    const ch = supabase.channel(`room-chat:${room.code}`, { config: { broadcast: { self: false } } })
    ch.on('broadcast', { event: 'msg' }, ({ payload }) => {
      const m = payload as ChatMsg
      setChat((c) => [...c.slice(-99), m])
      if (panelRef.current !== 'chat') setUnread((n) => n + 1)
    }).subscribe()
    chatChannel.current = ch
    return () => { void supabase.removeChannel(ch) }
  }, [room.code])

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await refresh()
    } catch (e) {
      flash(e instanceof ApiError ? e.message : '실패했어요')
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      flash('링크를 복사했어요')
    } catch {
      flash(link)
    }
  }

  const leave = async () => {
    try { await api.leaveRoom(room.code) } catch { /* 나가는 중 실패는 무시 */ }
    nav('/')
  }

  const setSetting = (patch: Partial<RoomSettings>) => run(() => api.updateSettings(room.code, patch))

  const slots: (Player | null)[] = [...room.players, ...Array(Math.max(0, room.maxPlayers - room.players.length)).fill(null)]

  return (
    <div className="wr">
      <header className="wr-top">
        <div className="wr-title">
          <strong>{game?.title ?? '게임'} · 방 {room.code}</strong>
          <span className="wr-sep" />
          <span className="wr-sub">대기 중 · {room.players.length}/{room.maxPlayers}명</span>
        </div>
        <div className="wr-tools">
          <ToolBtn label="채팅" on={panel === 'chat'} badge={unread} onClick={() => { setPanel(panel === 'chat' ? null : 'chat'); setUnread(0) }} icon={<IconChat />} />
          <ToolBtn label="참가자" on={panel === 'people'} onClick={() => setPanel(panel === 'people' ? null : 'people')} icon={<IconPeople />} />
          <span className="wr-divider" />
          <ToolBtn label="카메라" off icon={<IconCam />} onClick={() => flash('카메라는 지원하지 않아요')} />
          <ToolBtn label="마이크" off icon={<IconMic />} onClick={() => flash('마이크는 지원하지 않아요')} />
          <button className="wr-leave" onClick={leave}>나가기</button>
        </div>
      </header>

      <div className="wr-body">
        <main className="wr-grid">
          {slots.map((p, i) =>
            p ? (
              <div key={p.id} className={'tile' + (p.id === room.me ? ' me' : '') + (p.online ? '' : ' away')}>
                <div className="avatar" style={{ background: COLORS[p.color % COLORS.length] }}>{[...p.nickname][0]}</div>
                <div className="tile-name">
                  <IconMicOff />
                  {p.nickname}
                  {p.id === room.hostId && ' (방장)'}
                  {p.id === room.me && ' (나)'}
                </div>
                {!p.online && <div className="tile-away">연결 끊김</div>}
              </div>
            ) : (
              <div key={'empty' + i} className="tile empty">
                <div className="avatar-empty" />
                <span>입장 대기</span>
              </div>
            ),
          )}
        </main>

        {panel && (
          <aside className="wr-panel">
            <div className="wr-panel-head">
              <strong>{panel === 'chat' ? '채팅' : '참가자'}</strong>
              <button className="x" aria-label="닫기" onClick={() => setPanel(null)}>×</button>
            </div>

            {panel === 'people' ? (
              <div className="wr-panel-scroll">
                <section className="box">
                  <div className="box-label">초대 링크</div>
                  <div className="invite">
                    <span>{link.replace(/^https?:\/\//, '')}</span>
                    <button className="btn-ghost" onClick={copy}>링크 복사</button>
                  </div>
                  <div className="setting-row">
                    <span>비밀번호 사용</span>
                    {isHost ? (
                      <Toggle on={room.hasEntryCode} onChange={(v) => run(() => api.setEntryCode(room.code, v))} />
                    ) : (
                      <span className="dim">{room.hasEntryCode ? '사용' : '안 함'}</span>
                    )}
                  </div>
                  {isHost && room.hasEntryCode && room.entryCode && (
                    <div className="setting-row"><span className="dim">비밀번호</span><strong className="mono">{room.entryCode}</strong></div>
                  )}
                </section>

                {room.game === 'liar' && (
                  <section className="box">
                    <div className="box-label">게임 설정{isHost ? ' (방장만 변경)' : ''}</div>
                    <SettingSelect label="주제" disabled={!isHost} value={room.settings.category}
                      options={[['random', '랜덤'], ...LIAR_CATEGORIES.map((c) => [c, c] as [string, string])]}
                      onChange={(v) => setSetting({ category: v })} />
                    <SettingSelect label="힌트 바퀴" disabled={!isHost} value={String(room.settings.hintRounds)}
                      options={[['1', '1바퀴'], ['2', '2바퀴'], ['3', '3바퀴']]}
                      onChange={(v) => setSetting({ hintRounds: Number(v) })} />
                    <SettingSelect label="힌트 시간" disabled={!isHost} value={String(room.settings.hintSeconds)}
                      options={[['20', '20초'], ['30', '30초'], ['45', '45초']]}
                      onChange={(v) => setSetting({ hintSeconds: Number(v) })} />
                    <SettingSelect label="토론" disabled={!isHost} value={String(room.settings.discussSeconds)}
                      options={[['60', '60초'], ['90', '90초'], ['120', '120초']]}
                      onChange={(v) => setSetting({ discussSeconds: Number(v) })} />
                  </section>
                )}

                {room.game === 'bingo' && (
                  <section className="box">
                    <div className="box-label">게임 설정{isHost ? ' (방장만 변경)' : ''}</div>
                    <SettingSelect label="주제" disabled={!isHost} value={room.settings.category}
                      options={[['random', '랜덤'], ...LIAR_CATEGORIES.map((c) => [c, c] as [string, string])]}
                      onChange={(v) => setSetting({ category: v })} />
                    <SettingSelect label="판 크기" disabled={!isHost} value={String(room.settings.size ?? 5)}
                      options={[['4', '4×4 (직접 입력 3칸)'], ['5', '5×5 (직접 입력 4칸)']]}
                      onChange={(v) => setSetting({ size: Number(v) })} />
                    <SettingSelect label="승리 줄 수" disabled={!isHost} value={String(room.settings.lines ?? 3)}
                      options={[['1', '1줄'], ['2', '2줄'], ['3', '3줄']]}
                      onChange={(v) => setSetting({ lines: Number(v) })} />
                  </section>
                )}

                {room.game === 'bell' && (
                  <section className="box">
                    <div className="box-label">게임 설정{isHost ? ' (방장만 변경)' : ''}</div>
                    <SettingSelect label="제한 시간" disabled={!isHost} value={String(room.settings.limitMin ?? 10)}
                      options={[['3', '3분'], ['5', '5분'], ['10', '10분'], ['15', '15분'], ['0', '없음 (한 명 남을 때까지)']]}
                      onChange={(v) => setSetting({ limitMin: Number(v) })} />
                    <p className="dim" style={{ margin: 0 }}>2~4명 · 카드 뒤집기 Space(또는 내 카드 클릭) · 승인 J · 대화 Enter</p>
                  </section>
                )}

                {room.game === 'cablevs' && (
                  <section className="box">
                    <div className="box-label">대결 설정{isHost ? ' (방장만 변경)' : ''}</div>
                    <SettingSelect label="난이도" disabled={!isHost} value={room.settings.cbLevel ?? 'normal'}
                      options={[['easy', '초급 (5×5)'], ['normal', '중급 (7×6)'], ['hard', '고급 (9×8)']]}
                      onChange={(v) => setSetting({ cbLevel: v as 'easy' | 'normal' | 'hard' })} />
                    <SettingSelect label="승리 조건" disabled={!isHost} value={String(room.settings.cbTarget ?? 3)}
                      options={[['1', '1점 (단판)'], ['2', '2점 먼저'], ['3', '3점 먼저'], ['4', '4점 먼저'], ['5', '5점 먼저']]} onChange={(v) => setSetting({ cbTarget: Number(v) })} />
                    <p className="dim" style={{ margin: 0 }}>2~4명 · 같은 구성도를 먼저 다 이으면 1점 · 못 풀겠으면 [넘기기] 제안 → 모두 동의하면 정답 공개 후 다음 판 · 클릭 회전 · 우클릭 반대 · 대화 Enter</p>
                  </section>
                )}

                {room.game === 'alkkagi' && (
                  <section className="box">
                    <div className="box-label">게임 설정{isHost ? ' (방장만 변경)' : ''}</div>
                    <SettingSelect label="도형 개수" disabled={!isHost} value={String(room.settings.alkN ?? 5)}
                      options={[['3', '3개'], ['5', '5개'], ['7', '7개']]} onChange={(v) => setSetting({ alkN: Number(v) })} />
                    <SettingSelect label="승부" disabled={!isHost} value={String(room.settings.alkTarget ?? 2)}
                      options={[['1', '단판'], ['2', '3판 2선승'], ['3', '5판 3선승']]} onChange={(v) => setSetting({ alkTarget: Number(v) })} />
                    <SettingSelect label="한 턴 시간" disabled={!isHost} value={String(room.settings.alkSec ?? 15)}
                      options={[['15', '15초'], ['30', '30초'], ['0', '없음']]} onChange={(v) => setSetting({ alkSec: Number(v) })} />
                    <SettingSelect label="배치 방식" disabled={!isHost} value={room.settings.alkPlace ?? 'free'}
                      options={[['free', '자율 배치 (30초, 서로 비공개)'], ['line', '기본 (4번째 줄 한 줄)']]} onChange={(v) => setSetting({ alkPlace: v as 'free' | 'line' })} />
                    <p className="dim" style={{ margin: 0 }}>딱 2명 · 내 도형을 잡고 뒤로 당겼다 놓으면 발사 · 영역 밖으로 나가면 삭제 · 상대 도형을 모두 떨어뜨리면 그 판 승리 · 대화 Enter</p>
                  </section>
                )}

                {room.game === 'shapevs' && (
                  <section className="box">
                    <div className="box-label">대결 설정{isHost ? ' (방장만 변경)' : ''}</div>
                    <SettingSelect label="난이도" disabled={!isHost} value={room.settings.shLevel ?? 'normal'}
                      options={[['easy', '초급 (도형 3개)'], ['normal', '중급 (도형 4개)'], ['hard', '고급 (도형 5개)'], ['expert', '전문가 (도형 6개)']]}
                      onChange={(v) => setSetting({ shLevel: v as 'easy' | 'normal' | 'hard' | 'expert' })} />
                    <SettingSelect label="승리 조건" disabled={!isHost} value={String(room.settings.shTarget ?? 3)}
                      options={[['1', '1점 (단판)'], ['2', '2점 먼저'], ['3', '3점 먼저'], ['4', '4점 먼저'], ['5', '5점 먼저']]}
                      onChange={(v) => setSetting({ shTarget: Number(v) })} />
                    <p className="dim" style={{ margin: 0 }}>2~4명 · 같은 판을 먼저 다 채우면 1점 · 못 풀겠으면 [넘기기] 제안 → 모두 동의하면 정답 공개 후 다음 판 · 끌어서 놓기 · Q·E 회전 · A·D 대칭 · 대화 Enter</p>
                  </section>
                )}

                <div className="people-head"><span>참가자</span><span>{room.players.length}/{room.maxPlayers}</span></div>
                <ul className="people">
                  {room.players.map((p) => (
                    <li key={p.id} className={p.id === room.me ? 'me' : ''}>
                      <span className="avatar sm" style={{ background: COLORS[p.color % COLORS.length] }}>{[...p.nickname][0]}</span>
                      <span className="pname">{p.nickname}</span>
                      {p.id === room.hostId && <span className="dim">방장</span>}
                      {p.id === room.me && <span className="dim">나</span>}
                      {!p.online && <span className="dim">끊김</span>}
                    </li>
                  ))}
                </ul>

              </div>
            ) : (
              <Chat
                msgs={chat}
                me={room.me}
                onSend={(text) => {
                  const m: ChatMsg = { id: crypto.randomUUID(), from: room.me, name: me?.nickname ?? '?', text }
                  setChat((c) => [...c.slice(-99), m])
                  void chatChannel.current?.send({ type: 'broadcast', event: 'msg', payload: m })
                }}
              />
            )}

            <div className="wr-panel-foot">
              <p>
                {canStart ? '' : `${minPlayers}명 이상이면 시작할 수 있어요. `}
                {isHost ? '' : '방장만 시작할 수 있습니다.'}
                {isHost && canStart ? '모두 모였으면 시작하세요.' : ''}
              </p>
              <button className="btn-start" disabled={!isHost || !canStart}
                onClick={() => { track('game_start', { game_id: room.game, players: room.players.length }); run(() => (room.game === 'bingo' ? api.bingoStart(room.code) : room.game === 'bell' ? api.bellStart(room.code) : room.game === 'shapevs' ? api.shvStart(room.code, battlePuzzles(room.settings.shLevel ?? 'normal')) : room.game === 'alkkagi' ? api.alkStart(room.code) : room.game === 'cablevs' ? api.cbvStart(room.code, battleBoards(room.settings.cbLevel ?? 'normal')) : api.liarStart(room.code))) }}>
                게임 시작
              </button>
            </div>
          </aside>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function Chat({ msgs, me, onSend }: { msgs: ChatMsg[]; me: string; onSend: (t: string) => void }) {
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs.length])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim().slice(0, 200)
    if (!t) return
    onSend(t)
    setText('')
  }
  return (
    <>
      <div className="wr-panel-scroll chat">
        {msgs.length === 0 && <p className="dim sm">대기실 채팅은 저장되지 않아요.</p>}
        {msgs.map((m) => (
          <div key={m.id} className={'msg' + (m.from === me ? ' mine' : '')}>
            <span className="msg-name">{m.name}</span>
            <span className="msg-text">{m.text}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="chat-input" onSubmit={submit}>
        <input value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="메시지 입력" />
      </form>
    </>
  )
}

function SettingSelect({ label, value, options, disabled, onChange }: {
  label: string; value: string; options: [string, string][]; disabled: boolean; onChange: (v: string) => void
}) {
  const shown = options.find(([v]) => v === value)?.[1] ?? value
  return (
    <div className="setting-row">
      <span>{label}</span>
      {disabled ? (
        <span>{shown}</span>
      ) : (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      )}
    </div>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} className={'toggle' + (on ? ' on' : '')} onClick={() => onChange(!on)}>
      <span />
    </button>
  )
}

function ToolBtn({ label, icon, on, off, badge, onClick }: {
  label: string; icon: React.ReactNode; on?: boolean; off?: boolean; badge?: number; onClick?: () => void
}) {
  return (
    <button className={'tool' + (on ? ' on' : '') + (off ? ' off' : '')} onClick={onClick} aria-label={label} title={label}>
      {icon}
      <span>{label}</span>
      {!!badge && <i className="badge-dot">{badge > 9 ? '9+' : badge}</i>}
    </button>
  )
}

const svg = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const IconChat = () => <svg {...svg}><path d="M4 5h16v11H9l-5 4z" /></svg>
const IconPeople = () => <svg {...svg}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" /><circle cx="16.5" cy="9" r="2.5" /><path d="M16 14.5c2.3 0 4 1.3 4.5 4" /></svg>
const IconCam = () => <svg {...svg}><rect x="3" y="7" width="12" height="10" rx="2" /><path d="M15 11l6-3v8l-6-3M3 3l18 18" /></svg>
const IconMic = () => <svg {...svg}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M3 3l18 18" /></svg>
const IconMicOff = () => <svg {...svg} width={14} height={14}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M3 3l18 18" /></svg>
