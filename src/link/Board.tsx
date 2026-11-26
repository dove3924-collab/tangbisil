import { useEffect, useRef, useState, type RefObject } from 'react'
import { COLORS, LETTERS, complete, dragTo, startAt, stepTo, owner, type Paths, type Puzzle } from './logic'

/** 판 그림 (혼자 하기·대결·정답 공개가 같이 씀) */
export function LinkSvg({ p, paths, cs, active = null, cursor = null, done, svgRef, handlers }: {
  p: Puzzle; paths: Paths; cs: number; active?: number | null; cursor?: number | null; done?: boolean
  svgRef?: RefObject<SVGSVGElement>; handlers?: React.SVGProps<SVGSVGElement>
}) {
  const n = p.n
  const c2 = cs / 2
  const sw = Math.max(8, cs * 0.3)
  const full = paths.length === p.ends.length ? paths : p.ends.map(() => [])
  return (
    <svg ref={svgRef} className={'lk-board' + (done ? ' done' : '') + (handlers ? '' : ' ro')} width={n * cs} height={n * cs} onContextMenu={(e) => e.preventDefault()} {...handlers}>
      {Array.from({ length: n * n }, (_, i) => {
        const o = owner(full, i)
        return <rect key={i} x={(i % n) * cs} y={Math.floor(i / n) * cs} width={cs} height={cs}
          fill={o >= 0 ? COLORS[o] + (complete(p, full, o) ? '2e' : '1a') : '#fff'} stroke="#d9dde3" />
      })}
      {full.map((ps, c) => ps.length > 1 && (
        <polyline key={c} points={ps.map((i) => `${(i % n) * cs + c2},${Math.floor(i / n) * cs + c2}`).join(' ')}
          fill="none" stroke={COLORS[c]} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" opacity={active === c ? 0.85 : 1} />
      ))}
      {p.ends.map(([a, b], c) => [a, b].map((i) => (
        <g key={`${c}-${i}`} transform={`translate(${(i % n) * cs + c2},${Math.floor(i / n) * cs + c2})`}>
          <circle r={cs * 0.36} fill={COLORS[c]} stroke="#fff" strokeWidth={2} />
          {complete(p, full, c) && <circle r={cs * 0.42} fill="none" stroke={COLORS[c]} strokeWidth={2} opacity={0.5} />}
          <text y={cs * 0.12} textAnchor="middle" fontSize={cs * 0.34} fontWeight={700} fill="#fff">{LETTERS[c]}</text>
        </g>
      )))}
      {active !== null && full[active]?.length > 0 && !complete(p, full, active) && (() => {
        const t = full[active][full[active].length - 1]
        return <circle cx={(t % n) * cs + c2} cy={Math.floor(t / n) * cs + c2} r={sw * 0.55} fill="#fff" stroke={COLORS[active]} strokeWidth={3} pointerEvents="none" />
      })()}
      {cursor !== null && <rect pointerEvents="none" x={(cursor % n) * cs + 2} y={Math.floor(cursor / n) * cs + 2} width={cs - 4} height={cs - 4} fill="none" stroke="#217346" strokeWidth={3} strokeDasharray={active !== null ? '' : '5 3'} />}
    </svg>
  )
}

/** 드래그·키보드로 선 긋기 + 되돌리기 */
export function useLinkPlay({ p, paths, setPaths, cs, enabled, resetKey }: {
  p: Puzzle | null; paths: Paths; setPaths: (fn: (x: Paths) => Paths) => void; cs: number; enabled: boolean; resetKey: string
}) {
  const [active, setActive] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const [undoN, setUndoN] = useState(0)
  const undo = useRef<Paths[]>([])
  const svgRef = useRef<SVGSVGElement>(null)
  const full = p ? (paths.length === p.ends.length ? paths : p.ends.map(() => [])) : []

  useEffect(() => { undo.current = []; setUndoN(0); setActive(null); setCursor(null) }, [resetKey])
  useEffect(() => { if (!enabled) setActive(null) }, [enabled])

  const push = (x: Paths) => { undo.current.push(x); if (undo.current.length > 100) undo.current.shift(); setUndoN(undo.current.length) }
  const cellAt = (e: { clientX: number; clientY: number }) => {
    if (!svgRef.current || !p) return null
    const r = svgRef.current.getBoundingClientRect()
    const x = Math.floor((e.clientX - r.left) / cs), y = Math.floor((e.clientY - r.top) / cs)
    return x >= 0 && y >= 0 && x < p.n && y < p.n ? y * p.n + x : null
  }
  const begin = (i: number) => {
    if (!p || !enabled) return false
    const s = startAt(p, full, i)
    if (!s) return false
    push(full)
    setPaths(() => s.paths)
    setActive(s.c)
    return true
  }
  const handlers: React.SVGProps<SVGSVGElement> = {
    onPointerDown: (e) => {
      const i = cellAt(e)
      if (i === null) return
      setCursor(null)
      if (begin(i)) (e.target as Element).setPointerCapture?.(e.pointerId)
    },
    onPointerMove: (e) => {
      const i = cellAt(e)
      setHover(i)
      if (active === null || i === null || !p || !enabled) return
      setPaths((x) => dragTo(p, x, active, i))
    },
    onPointerUp: () => setActive(null),
    onPointerCancel: () => setActive(null),
    onPointerLeave: () => setHover(null),
  }
  const doUndo = () => { const prev = undo.current.pop(); setUndoN(undo.current.length); if (prev && enabled) { setPaths(() => prev); setActive(null) } }
  const reset = () => { if (!p || !enabled) return; push(full); setPaths((x) => x.map(() => [])); setActive(null) }

  // 방향키 이동 · Space/Enter 긋기 시작·끝 · Ctrl+Z
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e: KeyboardEvent) => {
    if (!p || (e.target as HTMLElement).closest('input, textarea, select')) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); return }
    if (!enabled) return
    const d = ({ ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] } as Record<string, number[]>)[e.key]
    const cur = cursor ?? p.ends[0][0]
    if (d) {
      e.preventDefault()
      const x = cur % p.n + d[0], y = Math.floor(cur / p.n) + d[1]
      if (x < 0 || y < 0 || x >= p.n || y >= p.n) return
      const j = y * p.n + x
      if (active !== null) {
        const nxt = stepTo(p, full, active, j)
        if (!nxt) return
        setPaths(() => nxt)
        if (complete(p, nxt, active)) setActive(null)
      }
      setCursor(j)
    } else if (e.key === ' ' || (e.key === 'Enter' && cursor !== null)) {
      e.preventDefault()
      if (cursor === null) { setCursor(cur); return }
      if (active !== null) setActive(null)
      else begin(cur)
    }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  return { active, hover, cursor, svgRef, handlers, undo: doUndo, canUndo: undoN > 0, reset, full }
}

export function useCellSize(n: number, sideW: number) {
  const pick = () => {
    const availW = window.innerWidth - (window.innerWidth > 900 ? sideW : 80)
    const availH = window.innerHeight - 300
    return Math.max(28, Math.min(56, Math.floor(Math.min(availW, availH) / n)))
  }
  const [cs, setCs] = useState(pick)
  useEffect(() => { const f = () => setCs(pick()); f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [n, sideW]) // eslint-disable-line react-hooks/exhaustive-deps
  return cs
}
