import { useEffect, useRef, useState } from 'react'

/**
 * 케이블 연결 키보드: 방향키·W/A/S/D = 칸 옮기기, Q = 반시계, E(R) = 시계, Space = 잠그기.
 * 입력칸 안에서는 무시. 커서는 판이 바뀌면 서버 칸으로.
 */
export function useCableKeys(opts: {
  w: number; h: number; server: number; resetKey: string; enabled: boolean
  turn: (i: number, dir: 'cw' | 'ccw') => void; lock: (i: number) => void
}) {
  const [cursor, setCursor] = useState(opts.server)
  const [used, setUsed] = useState(false) // 키보드를 한 번이라도 쓰면 커서 표시
  useEffect(() => { setCursor(opts.server) }, [opts.resetKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useRef(opts)
  ref.current = opts
  const cur = useRef(cursor)
  cur.current = cursor
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const o = ref.current
      if (!o.enabled || e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest('input, textarea, select')) return
      const i = cur.current, x = i % o.w, y = Math.floor(i / o.w)
      const move = (dx: number, dy: number) => { e.preventDefault(); setUsed(true); setCursor(Math.max(0, Math.min(o.h - 1, y + dy)) * o.w + Math.max(0, Math.min(o.w - 1, x + dx))) }
      switch (e.code) {
        case 'ArrowUp': case 'KeyW': return move(0, -1)
        case 'ArrowDown': case 'KeyS': return move(0, 1)
        case 'ArrowLeft': case 'KeyA': return move(-1, 0)
        case 'ArrowRight': case 'KeyD': return move(1, 0)
        case 'KeyQ': e.preventDefault(); setUsed(true); return o.turn(i, 'ccw')
        case 'KeyE': case 'KeyR': e.preventDefault(); setUsed(true); return o.turn(i, 'cw')
        case 'Space': e.preventDefault(); setUsed(true); return o.lock(i)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  return { cursor, setCursor, show: used }
}
