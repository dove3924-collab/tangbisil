import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { api } from '../lib/api'
import type { LkvState } from '../link/vs'
import { supabase } from '../lib/supabase'

/** 셀 링크 대결 상태: 실시간 구독 + 서버 시간 + 마감·혼자 남음 처리 */
export function useLinkVs(code: string, activeCount: number) {
  const [state, setState] = useState<LkvState | null>(null)
  const [error, setError] = useState('')
  const offset = useRef(0)
  const bestRtt = useRef(Infinity)
  const pending = useRef<number | null>(null)
  const chRef = useRef<RealtimeChannel | null>(null)

  const refresh = useCallback(async () => {
    try {
      const t0 = Date.now()
      const s = await api.lkvState(code)
      const t1 = Date.now()
      if (s) {
        const rtt = t1 - t0
        if (rtt <= bestRtt.current * 1.3 + 20) { bestRtt.current = Math.min(bestRtt.current, rtt); offset.current = new Date(s.now).getTime() + rtt / 2 - t1 }
      }
      setState((p) => (p && s && p.roundNo === s.roundNo && s.version < p.version ? p : s))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [code])

  const refreshSoon = useCallback(() => {
    if (pending.current) return
    pending.current = window.setTimeout(() => { pending.current = null; void refresh() }, 50)
  }, [refresh])

  /** 내가 뭔가 바꾼 직후: 다른 사람에게 바로 다시 읽으라고 알림 (DB 알림보다 빠름) */
  const poke = useCallback(() => {
    try { void chRef.current?.send({ type: 'broadcast', event: 'poke', payload: {} }) } catch { /* DB 알림이 대신 */ }
  }, [])

  useEffect(() => {
    void refresh()
    const ch = supabase
      .channel(`lkv:${code}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'poke' }, refreshSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lkv_games', filter: `room_code=eq.${code}` }, refreshSoon)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lkv_chats', filter: `room_code=eq.${code}` }, refreshSoon)
      .subscribe()
    chRef.current = ch
    const iv = window.setInterval(refresh, 3_000)
    const iv2 = window.setInterval(() => { bestRtt.current = Infinity }, 60_000)
    return () => { window.clearInterval(iv); window.clearInterval(iv2); chRef.current = null; void supabase.removeChannel(ch) }
  }, [code, refresh, refreshSoon])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const iv = window.setInterval(() => setNow(Date.now()), 200); return () => window.clearInterval(iv) }, [])
  const serverNow = now + offset.current

  // 라운드 마감이 지나거나 혼자 남으면 진행 요청 (서버가 다시 확인)
  const ticked = useRef<string | null>(null)
  const due = !!state && state.phase === 'play' && ((!!state.deadline && serverNow >= new Date(state.deadline).getTime()) || activeCount < 2)
  useEffect(() => {
    if (!due || !state) return
    const key = `${state.deadline}|${state.version}|${activeCount}`
    if (ticked.current === key) return
    ticked.current = key
    window.setTimeout(async () => {
      try { await api.lkvTick(code) } catch { /* 다음 폴링에서 */ }
      await refresh(); poke()
      window.setTimeout(() => { if (ticked.current === key) ticked.current = null }, 2000)
    }, 150 + Math.random() * 300)
  }, [due, state, activeCount, code, refresh, poke])

  return { state, error, refresh, poke, serverNow }
}
