import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, type RoomView } from '../lib/api'
import { supabase } from '../lib/supabase'

const HEARTBEAT_MS = 15_000

export type RoomState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; room: RoomView }

/** 방 상태를 불러오고, 멤버가 되면 실시간 변경 구독 + 접속 신호를 보낸다. */
export function useRoom(code: string) {
  const [state, setState] = useState<RoomState>({ kind: 'loading' })
  const timer = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const room = await api.getRoom(code)
      setState(room ? { kind: 'ready', room } : { kind: 'missing' })
    } catch (e) {
      setState((s) =>
        s.kind === 'ready' ? s : { kind: 'error', message: e instanceof ApiError ? e.message : String(e) },
      )
    }
  }, [code])

  // 짧은 시간에 이벤트가 몰리면 한 번만 다시 불러온다
  const refreshSoon = useCallback(() => {
    if (timer.current) return
    timer.current = window.setTimeout(() => {
      timer.current = null
      void refresh()
    }, 150)
  }, [refresh])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const member = state.kind === 'ready' && state.room.member

  useEffect(() => {
    if (!member) return
    const channel = supabase
      .channel(`room-db:${code}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${code}` }, refreshSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_code=eq.${code}` }, refreshSoon)
      .subscribe()

    const beat = () => api.heartbeat(code).then(refreshSoon).catch(() => {})
    const iv = window.setInterval(beat, HEARTBEAT_MS)
    const onVisible = () => document.visibilityState === 'visible' && beat()
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.clearInterval(iv)
      document.removeEventListener('visibilitychange', onVisible)
      void supabase.removeChannel(channel)
    }
  }, [member, code, refreshSoon])

  return { state, refresh }
}
