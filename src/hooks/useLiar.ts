import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { LiarState } from '../lib/liar'
import { supabase } from '../lib/supabase'

/** 라이어 게임 상태: 실시간 변경 구독 + 서버 시간 기준 타이머 + 마감 시 진행(tick) 요청 */
export function useLiar(code: string) {
  const [state, setState] = useState<LiarState | null>(null)
  const [error, setError] = useState('')
  const offset = useRef(0) // 서버 시각 - 내 시각 (ms)
  const pending = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const s = await api.liarState(code)
      if (s) offset.current = new Date(s.now).getTime() - Date.now()
      setState(s)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [code])

  const refreshSoon = useCallback(() => {
    if (pending.current) return
    pending.current = window.setTimeout(() => {
      pending.current = null
      void refresh()
    }, 120)
  }, [refresh])

  useEffect(() => {
    void refresh()
    const ch = supabase
      .channel(`liar:${code}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'liar_games', filter: `room_code=eq.${code}` }, refreshSoon)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'liar_messages', filter: `room_code=eq.${code}` }, refreshSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'liar_reactions', filter: `room_code=eq.${code}` }, refreshSoon)
      .subscribe()
    // 실시간 연결이 끊겨도 따라오도록 가끔 다시 불러온다
    const iv = window.setInterval(refresh, 10_000)
    return () => {
      window.clearInterval(iv)
      void supabase.removeChannel(ch)
    }
  }, [code, refresh, refreshSoon])

  // 남은 시간 (초, 소수)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const iv = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(iv)
  }, [])
  const deadline = state?.deadline ? new Date(state.deadline).getTime() : null
  const remaining = deadline === null ? null : Math.max(0, (deadline - (now + offset.current)) / 1000)

  // 마감이 지나면 서버에 진행 요청 (모두가 보내도 서버가 한 번만 처리)
  const ticked = useRef<string | null>(null)
  useEffect(() => {
    if (!state?.deadline || remaining === null || remaining > 0) return
    const key = `${state.deadline}`
    if (ticked.current === key) return
    ticked.current = key
    const delay = 200 + Math.random() * 400
    const t = window.setTimeout(async () => {
      try { await api.liarTick(code) } catch { /* 다음 폴링에서 재시도 */ }
      await refresh()
      // 아직 그대로면 잠시 후 다시 시도할 수 있게
      window.setTimeout(() => { if (ticked.current === key) ticked.current = null }, 2000)
    }, delay)
    return () => window.clearTimeout(t)
  }, [state?.deadline, remaining, code, refresh])

  return { state, error, refresh, remaining }
}
