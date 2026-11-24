import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { BingoState } from '../lib/bingo'
import { supabase } from '../lib/supabase'

/** 빙고 상태: 실시간 구독 + 서버 시간 기준 타이머 + 마감 시 진행 요청 */
export function useBingo(code: string) {
  const [state, setState] = useState<BingoState | null>(null)
  const [error, setError] = useState('')
  const offset = useRef(0)
  const pending = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const s = await api.bingoState(code)
      if (s) offset.current = new Date(s.now).getTime() - Date.now()
      setState(s)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [code])

  const refreshSoon = useCallback(() => {
    if (pending.current) return
    pending.current = window.setTimeout(() => { pending.current = null; void refresh() }, 120)
  }, [refresh])

  useEffect(() => {
    void refresh()
    const ch = supabase
      .channel(`bingo:${code}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bingo_games', filter: `room_code=eq.${code}` }, refreshSoon)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bingo_calls', filter: `room_code=eq.${code}` }, refreshSoon)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bingo_chats', filter: `room_code=eq.${code}` }, refreshSoon)
      .subscribe()
    const iv = window.setInterval(refresh, 10_000)
    return () => { window.clearInterval(iv); void supabase.removeChannel(ch) }
  }, [code, refresh, refreshSoon])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const iv = window.setInterval(() => setNow(Date.now()), 250); return () => window.clearInterval(iv) }, [])
  const deadline = state?.deadline ? new Date(state.deadline).getTime() : null
  const remaining = deadline === null ? null : Math.max(0, (deadline - (now + offset.current)) / 1000)

  const ticked = useRef<string | null>(null)
  useEffect(() => {
    if (!state?.deadline || remaining === null || remaining > 0) return
    const key = state.deadline
    if (ticked.current === key) return
    ticked.current = key
    const t = window.setTimeout(async () => {
      try { await api.bingoTick(code) } catch { /* 다음 폴링에서 */ }
      await refresh()
      window.setTimeout(() => { if (ticked.current === key) ticked.current = null }, 2000)
    }, 200 + Math.random() * 400)
    return () => window.clearTimeout(t)
  }, [state?.deadline, remaining, code, refresh])

  return { state, error, refresh, remaining }
}
