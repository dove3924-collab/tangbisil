import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { BellLast, BellState } from '../lib/bell'
import { supabase } from '../lib/supabase'

type Row = { round_no: number; phase: string; version: number; turn_index: number; deadline: string | null; last: BellLast | null }
/** 행동한 사람이 바로 뿌리는 공개 상태 (DB 알림보다 빠른 Broadcast 통로) */
type Snap = Pick<BellState, 'roundNo' | 'phase' | 'version' | 'turnIndex' | 'deadline' | 'last' | 'hands'>

/** 할리갈리 상태: 실시간 구독 + 서버 시간 기준 타이머 + 마감 시 진행 요청 */
export function useBell(code: string) {
  const [state, setState] = useState<BellState | null>(null)
  const [error, setError] = useState('')
  const offset = useRef(0)
  const pending = useRef<number | null>(null)
  const chRef = useRef<RealtimeChannel | null>(null)
  const bestRtt = useRef(Infinity)

  const refresh = useCallback(async (): Promise<BellState | null> => {
    try {
      const t0 = Date.now()
      const s = await api.bellState(code)
      const t1 = Date.now()
      // 서버 시계 맞추기: 왕복 시간의 절반을 빼고, 가장 빨랐던 응답 기준으로 (오래되면 다시)
      if (s) {
        const rtt = t1 - t0
        if (rtt <= bestRtt.current * 1.3 + 20) {
          bestRtt.current = Math.min(bestRtt.current, rtt)
          offset.current = new Date(s.now).getTime() + rtt / 2 - t1
        }
      }
      // 늦게 도착한 옛 응답이 새 상태를 덮지 않게
      setState((p) => (p && s && p.roundNo === s.roundNo && s.version < p.version ? p : s))
      setError('')
      return s
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    }
  }, [code])

  // 받은 공개 상태가 더 새것이면 바로 반영
  const merge = useCallback((n: Snap | undefined) => {
    if (!n || typeof n.version !== 'number') return
    setState((p) => {
      if (!p || p.roundNo !== n.roundNo || n.version <= p.version) return p
      return { ...p, phase: n.phase, version: n.version, turnIndex: n.turnIndex, deadline: n.deadline, last: n.last, hands: n.hands }
    })
  }, [])

  /** 내가 뒤집거나 승인한 직후: 새 상태를 받아 다른 사람에게 바로 뿌림 */
  const announce = useCallback(async () => {
    const s = await refresh()
    const ch = chRef.current
    if (!s || !ch) return
    const snap: Snap = { roundNo: s.roundNo, phase: s.phase, version: s.version, turnIndex: s.turnIndex, deadline: s.deadline, last: s.last, hands: s.hands }
    try { await ch.send({ type: 'broadcast', event: 'st', payload: snap }) } catch { /* DB 알림이 대신 */ }
  }, [refresh])

  // 실시간 알림에 실린 행으로 바로 반영 (뒤집기는 카드까지, 나머지는 다음 조회에서)
  const patch = useCallback((r: Row | undefined) => {
    if (!r || typeof r.version !== 'number') return
    setState((p) => {
      if (!p || p.roundNo !== r.round_no || r.phase !== 'play' || r.version !== p.version + 1) return p
      const l = r.last
      const hands = { ...p.hands }
      if (l?.type === 'flip' && l.card != null && hands[l.by]) {
        const h = hands[l.by]
        hands[l.by] = { ...h, deck: Math.max(0, h.deck - 1), face: h.face + 1, top: l.card }
      }
      return { ...p, version: r.version, turnIndex: r.turn_index, deadline: r.deadline, last: l, hands }
    })
  }, [])

  const refreshSoon = useCallback(() => {
    if (pending.current) return
    pending.current = window.setTimeout(() => { pending.current = null; void refresh() }, 60)
  }, [refresh])

  useEffect(() => {
    void refresh()
    const ch = supabase
      .channel(`bell:${code}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'st' }, ({ payload }) => { merge(payload as Snap); refreshSoon() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bell_games', filter: `room_code=eq.${code}` }, (pl) => { patch(pl.new as Row); refreshSoon() })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bell_chats', filter: `room_code=eq.${code}` }, refreshSoon)
      .subscribe()
    chRef.current = ch
    const iv = window.setInterval(refresh, 5_000)
    // 시계는 1분마다 다시 맞춤
    const iv2 = window.setInterval(() => { bestRtt.current = Infinity }, 60_000)
    return () => { window.clearInterval(iv); window.clearInterval(iv2); chRef.current = null; void supabase.removeChannel(ch) }
  }, [code, refresh, refreshSoon, patch, merge])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const iv = window.setInterval(() => setNow(Date.now()), 200); return () => window.clearInterval(iv) }, [])
  const at = (iso: string | null | undefined) => (iso ? Math.max(0, (new Date(iso).getTime() - (now + offset.current)) / 1000) : null)
  const serverNow = () => now + offset.current
  // 공개·멈춤이 끝나는 순간 다시 그리기
  const until = state?.last?.until
  useEffect(() => {
    if (!until) return
    const ms = new Date(until).getTime() - (Date.now() + offset.current)
    if (ms <= 0) return
    const t = window.setTimeout(() => setNow(Date.now()), ms + 20)
    return () => window.clearTimeout(t)
  }, [until])
  const remaining = state?.phase === 'play' ? at(state.deadline) : null
  const gameLeft = state?.phase === 'play' ? at(state.endsAt) : null

  // 차례 마감·판 마감이 지나면 누군가 진행 요청 (서버가 시간을 다시 확인)
  const ticked = useRef<string | null>(null)
  useEffect(() => {
    if (!state || state.phase !== 'play') return
    const due = (remaining !== null && remaining <= 0) || (gameLeft !== null && gameLeft <= 0)
    if (!due) return
    const key = `${state.deadline}|${state.version}`
    if (ticked.current === key) return
    ticked.current = key
    // 화면 갱신(0.2초마다)에 취소되지 않게 정리 함수 없이 예약
    window.setTimeout(async () => {
      try { await api.bellTick(code) } catch { /* 다음 폴링에서 */ }
      await announce() // 자동 뒤집기도 바로 뿌림
      window.setTimeout(() => { if (ticked.current === key) ticked.current = null }, 1500)
    }, 150 + Math.random() * 300)
  }, [state, remaining, gameLeft, code, announce])

  return { state, error, refresh, announce, remaining, gameLeft, serverNow }
}
