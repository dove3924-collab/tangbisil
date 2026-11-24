import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useRoom } from '../hooks/useRoom'
import { api, ApiError, type RoomPublic } from '../lib/api'
import { GAMES } from '../lib/games'
import { loadNickname, saveNickname } from '../lib/nickname'
import WaitingRoom from '../components/WaitingRoom'
import LiarGame from '../components/LiarGame'
import BingoGame from '../components/BingoGame'
import BellGame from '../components/BellGame'
import ShapesVsGame from '../shapes/ShapesVsGame'
import AlkkagiGame from '../alkkagi/AlkkagiGame'
import CableVsGame from '../cable/CableVsGame'

export default function Room() {
  const code = (useParams().code ?? '').toUpperCase()
  const { state, refresh } = useRoom(code)

  if (state.kind === 'loading') return <Center><p className="muted">불러오는 중…</p></Center>
  if (state.kind === 'missing')
    return (
      <Center>
        <p className="muted">방 {code}</p>
        <h2>없는 방이거나 이미 끝난 방이에요</h2>
        {/^\d{4}$/.test(code) ? (
          <p className="muted sm">숫자 4자리는 방 <b>비밀번호</b>일 수 있어요. 방장이 보낸 초대 링크를 열거나 방 코드(예: K7Q2)를 입력한 뒤, 비밀번호는 입장 화면에서 넣어주세요.</p>
        ) : (
          <p className="muted sm">방장이 보낸 초대 링크를 그대로 열어보세요. 방은 아무도 없으면 바로 사라져요.</p>
        )}
        <Link to="/">로비로 돌아가기</Link>
      </Center>
    )
  if (state.kind === 'error')
    return (
      <Center>
        <h2>연결에 문제가 있어요</h2>
        <p className="muted">{state.message}</p>
        <button className="btn-dark" onClick={() => void refresh()}>다시 시도</button>
      </Center>
    )

  const room = state.room
  if (!room.member) return <JoinForm room={room} onJoined={refresh} />
  if (room.status === 'playing' && room.game === 'liar') return <LiarGame room={room} />
  if (room.status === 'playing' && room.game === 'bingo') return <BingoGame room={room} />
  if (room.status === 'playing' && room.game === 'bell') return <BellGame room={room} />
  if (room.status === 'playing' && room.game === 'shapevs') return <ShapesVsGame room={room} />
  if (room.status === 'playing' && room.game === 'alkkagi') return <AlkkagiGame room={room} />
  if (room.status === 'playing' && room.game === 'cablevs') return <CableVsGame room={room} />
  return <WaitingRoom room={room} refresh={refresh} />
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="room-center">{children}</div>
}

function JoinForm({ room, onJoined }: { room: RoomPublic; onJoined: () => Promise<void> }) {
  const [nick, setNick] = useState(loadNickname)
  const [entry, setEntry] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const game = GAMES.find((g) => g.id === room.game)
  const full = room.playerCount >= room.maxPlayers

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const n = nick.trim()
    if (!n) return setError('닉네임을 입력해 주세요.')
    setBusy(true)
    setError('')
    try {
      await api.joinRoom(room.code, n, room.hasEntryCode ? entry : undefined)
      saveNickname(n)
      await onJoined()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '입장하지 못했어요.')
      setBusy(false)
    }
  }

  return (
    <div className="room-center">
      <form className="join-card card" onSubmit={submit}>
        <p className="muted sm">{game?.title ?? '게임'} · 방 {room.code}</p>
        <h2>{room.isHost ? '방이 만들어졌어요' : '방에 입장'}</h2>
        <p className="muted sm">
          {room.isHost
            ? '닉네임을 정하면 초대 링크를 복사할 수 있어요.'
            : `현재 ${room.playerCount}/${room.maxPlayers}명 대기 중`}
        </p>
        <label>
          <span>닉네임</span>
          <input autoFocus value={nick} maxLength={10} onChange={(e) => setNick(e.target.value)} placeholder="최대 10자" />
        </label>
        {room.hasEntryCode && (
          <label>
            <span>비밀번호</span>
            <input value={entry} inputMode="numeric" maxLength={4} onChange={(e) => setEntry(e.target.value)} placeholder="방장에게 받은 숫자 4자리" />
          </label>
        )}
        {error && <p className="err">{error}</p>}
        <button className="btn-primary" disabled={busy || (full && !room.isHost) || room.status !== 'waiting'}>
          {room.status !== 'waiting' ? '게임 진행 중' : full && !room.isHost ? '방이 꽉 찼어요' : busy ? '입장 중…' : '입장'}
        </button>
        <Link className="muted sm back" to="/">로비로</Link>
      </form>
    </div>
  )
}
