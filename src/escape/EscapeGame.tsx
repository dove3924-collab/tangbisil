import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EP_TITLE, FILE_NAME, GIFT, INTRO, ROOMS } from './episode1'
import {
  asCell, clearState, colName, deriveFlags, fmtTime, formatNumber, freshState, hintCount, isDark, loadState, saveState, type EscState,
} from './state'
import type { CellDef, Hotspot, RoomDef, StoryPage, TableDef } from './types'
import { fmtHints, fmtSec, loadRival, resultUrl } from './share'
import { loadNickname, saveNickname } from '../lib/nickname'
import { track } from '../lib/analytics'
import './escape.css'

const CELL = 24 // 100%일 때 셀 크기(px)
/** 색조 서식: 흰색 → 빨강 */
function scaleColor(v: number, range?: [number, number]) {
  const [lo, hi] = range ?? [0, 100]
  const t = (hi > lo ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 1) ** 2
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t)
  return `rgb(${mix(255, 214)}, ${mix(255, 64)}, ${mix(255, 64)})`
}
const MAX_Z = 2
const FIT_SPAN = 2 // 좁은 열을 이 칸 수 이상으로 넓히면 숫자가 보인다 (4자리 숫자가 들어가는 너비)
const FONTS: [string, string][] = [['', '자동'], ['#000000', '검정'], ['#c00000', '빨강'], ['#1f4e79', '파랑'], ['#217346', '초록'], ['#ffffff', '흰색']]
const FORMATS: [string, string][] = [['general', '일반'], ['number', '숫자 (#,##0)'], ['currency', '통화 (₩)'], ['percent', '백분율 (%)'], ['date', '날짜 (yyyy-mm-dd)'], ['time', '시간 (h:mm:ss)'], ['text', '텍스트']]
const FILLS: [string, string][] = [['', '채우기 없음'], ['#fff2a8', '노랑'], ['#e2efda', '연두'], ['#ddebf7', '하늘'], ['#808080', '회색'], ['#000000', '검정']]

interface DCell {
  x: number; y: number; span: number; text: string
  kind: 'title' | 'header' | 'data'
  table: TableDef; ri: number; col: number; key: string
  cell?: CellDef; color?: string; bold?: boolean; align?: string; err?: boolean
}
interface Popup { pages: StoryPage[]; onDone?: () => void }
interface Sel { x0: number; y0: number; x1: number; y1: number }

export default function EscapeGame() {
  const nav = useNavigate()
  const [s, setS] = useState<EscState>(() => loadState() ?? freshState())
  const up = useCallback((fn: (d: EscState) => void) => setS((p) => { const d = structuredClone(p); fn(d); return d }), [])
  const flags = useMemo(() => deriveFlags(s), [s])
  // 열 너비 드래그 중인 값 (손을 떼면 s.widen 으로 저장)
  const [live, setLive] = useState<{ id: string; w: number } | null>(null)
  const widenOf = (id: string) => (live?.id === id ? live.w : s.widen[id] ?? 0)
  const fits = (t: TableDef) => !!s.autofit[t.id] || (live?.id === t.id && t.spans[t.narrowCol!] + live.w >= FIT_SPAN - 0.1)
  const ri = s.room
  const room: RoomDef = ri === 3 ? GIFT : ROOMS[ri]

  /* ── 팝업 ── */
  const [popups, setPopups] = useState<Popup[]>([])
  const [page, setPage] = useState(0)
  const queue = useCallback((pages: StoryPage[], onDone?: () => void) => {
    if (pages.length) setPopups((q) => [...q, { pages, onDone }]); else onDone?.()
  }, [])
  const cur = popups[0]

  const [toast, setToast] = useState('')
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? '' : t)), 2400) }

  useEffect(() => { saveState(s) }, [s])
  useEffect(() => {
    if (!s.introDone) queue(INTRO, () => up((d) => { d.introDone = true }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (document.visibilityState === 'visible') setS((p) => (p.introDone && !p.finished ? { ...p, activeMs: p.activeMs + 1000 } : p))
    }, 1000)
    return () => window.clearInterval(iv)
  }, [])

  /* ── 행 레이아웃 (숨긴 행) ── */
  const hidden = useMemo(() => new Set(room.hiddenRows.filter((y) => !s.unhidden[`${ri}:${y}`])), [room, s.unhidden, ri])
  const visRows = useMemo(() => Array.from({ length: room.h }, (_, y) => y).filter((y) => !hidden.has(y)), [room.h, hidden])
  const rowPos = useMemo(() => { const m = new Map<number, number>(); visRows.forEach((y, i) => m.set(y, i)); return m }, [visRows])

  /* ── 표 → 셀 ── */
  const dcells = useMemo(() => {
    const out: DCell[] = []
    for (const t of room.tables) {
      const xs: number[] = []; let acc = t.x
      t.spans.forEach((sp) => { xs.push(acc); acc += sp })
      const total = acc - t.x
      let yy = t.y
      if (t.title) { out.push({ x: t.x, y: yy, span: total, text: t.title, kind: 'title', table: t, ri: -1, col: 0, key: '', color: t.titleColor, bold: true }); yy++ }
      if (t.header) { t.header.forEach((h, j) => out.push({ x: xs[j], y: yy, span: t.spans[j], text: h, kind: 'header', table: t, ri: -1, col: j, key: '', bold: true, align: 'center', color: t.color })); yy++ }
      let slots = t.rows.map((_, i) => i)
      const srt = s.sorts[t.id]
      if (srt) {
        const val = (i: number) => { const c = asCell(t.rows[i].cells[srt.col]); return c.v ?? c.serial ?? '' }
        slots = [...slots].sort((a, b) => {
          const va = val(a), vb = val(b)
          return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'ko')) * srt.dir
        })
      }
      slots.forEach((rIdx, k) => {
        const row = t.rows[rIdx]
        if (row.showIf && !flags[row.showIf]) return
        row.cells.forEach((cin, j) => {
          const c = asCell(cin)
          const key = `${ri}:${t.id}:${rIdx}:${j}`
          let text = ''; let err = false
          if (c.lock) text = s.opened[c.lock] ? '[열림]' : String(c.v ?? '')
          if (c.id === 'pcState' && flags.r2_release) text = '야간 경비 모드 꺼짐'
          const fmt = s.fmts[key] ?? (c.dateFmt ? 'date' : 'general')
          if (c.lock || (c.id === 'pcState' && flags.r2_release)) { /* 위에서 처리 */ }
          else if (t.narrowCol === j && !fits(t)) { text = '####'; err = false }
          else if (c.serial !== undefined) text = formatNumber(c.serial, fmt)
          else if (typeof c.v === 'number') text = formatNumber(c.v, fmt)
          else text = c.v === undefined || c.v === null ? '' : String(c.v)
          const numeric = (typeof c.v === 'number' || c.serial !== undefined) && fmt !== 'text'
          out.push({ x: xs[j], y: yy + k, span: t.spans[j], text, kind: 'data', table: t, ri: rIdx, col: j, key, cell: c,
            color: c.white ? '#ffffff' : c.color ?? t.color, bold: c.bold, align: c.align ?? (numeric ? 'right' : 'left'), err })
        })
      })
    }
    return out
  }, [room, s.sorts, s.opened, s.fmts, s.autofit, live, flags, ri]) // eslint-disable-line react-hooks/exhaustive-deps

  const cellAt = useCallback((x: number, y: number) => dcells.find((d) => d.y === y && x >= d.x && x < d.x + d.span), [dcells])

  /* ── 색조 서식: 표마다 최솟값~최댓값 ── */
  const cfRange = useMemo(() => {
    const m: Record<string, [number, number]> = {}
    for (const t of room.tables) if (t.cf) {
      const vs = t.rows.flatMap((r) => r.cells.map((c) => asCell(c).v)).filter((v): v is number => typeof v === 'number')
      m[t.id] = [Math.min(...vs), Math.max(...vs)]
    }
    return m
  }, [room])
  const cfTop10 = useMemo(() => {
    const m: Record<string, number> = {}
    for (const t of room.tables) if (t.cf) {
      const vs = t.rows.flatMap((r) => r.cells.map((c) => asCell(c).v)).filter((v): v is number => typeof v === 'number').sort((a, b) => b - a)
      m[t.id] = vs[Math.max(0, Math.ceil(vs.length * 0.1) - 1)]
    }
    return m
  }, [room])

  /** 이 셀에 적용되는 조건부 서식 결과 */
  const cfOf = useCallback((d: DCell): { hi?: boolean; scale?: string; bar?: number; icon?: string } | null => {
    const rule = s.cf[d.table.id]
    if (!rule || d.kind !== 'data' || !d.table.cf || typeof d.cell?.v !== 'number') return null
    const v = d.cell.v
    const [lo, hi] = cfRange[d.table.id] ?? [0, 100]
    const t = hi > lo ? (v - lo) / (hi - lo) : 1
    if (rule === 'scale') return { scale: scaleColor(v, [lo, hi]) }
    if (rule === 'bar') return { bar: Math.max(0.05, t) }
    if (rule === 'icon') return { icon: t >= 0.67 ? '▲' : t >= 0.33 ? '▶' : '▼' }
    if (rule === 'top10') return { hi: v >= (cfTop10[d.table.id] ?? Infinity) }
    const m = rule.match(/^(gt|lt):(.+)$/)
    if (m) return { hi: m[1] === 'gt' ? v > Number(m[2]) : v < Number(m[2]) }
    return null
  }, [s.cf, cfRange]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── 픽셀 ── */
  const pixels = useMemo(() => {
    const px = room.art(flags).map((r) => [...r])
    for (const d of dcells) {
      if (d.kind === 'header' && d.table.headerFill) for (let i = 0; i < d.span; i++) px[d.y][d.x + i] = d.table.headerFill
      const cf = cfOf(d)
      if (cf?.scale) px[d.y][d.x] = cf.scale
      else if (cf?.hi) px[d.y][d.x] = '#ffc7ce'
    }
    for (const [k, c] of Object.entries(s.fills)) {
      const [r, x, y] = k.split(':').map(Number)
      if (r === ri && px[y]?.[x] !== undefined) px[y][x] = c || px[y][x]
    }
    return px
  }, [room, flags, dcells, s.fills, ri, cfOf])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    cv.width = room.w; cv.height = visRows.length
    const ctx = cv.getContext('2d')!
    visRows.forEach((y, vi) => pixels[y].forEach((c, x) => { ctx.fillStyle = c; ctx.fillRect(x, vi, 1, 1) }))
  }, [pixels, visRows, room.w])

  /* ── 확대/축소 ── */
  const scroller = useRef<HTMLDivElement>(null)
  const colHdr = useRef<HTMLDivElement>(null)
  const rowHdr = useRef<HTMLDivElement>(null)
  const [zMap, setZMap] = useState<Record<number, number>>({})
  const [fitZ, setFitZ] = useState(0.5)
  const z = zMap[ri] ?? fitZ
  const cp = CELL * z
  const minZ = Math.min(0.25, fitZ)
  const pending = useRef<{ cx: number; cy: number; sx: number; sy: number } | null>(null)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => setFitZ(Math.floor(Math.min(el.clientWidth / (room.w * CELL), el.clientHeight / (visRows.length * CELL)) * 100) / 100)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [room.w, visRows.length])

  // 시트를 바꾸면 왼쪽 위부터
  useLayoutEffect(() => { const el = scroller.current; if (el) { el.scrollLeft = 0; el.scrollTop = 0; syncHeaders() } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ri])

  const setZoom = useCallback((nz: number, anchor?: { cx: number; cy: number; sx: number; sy: number }) => {
    const el = scroller.current
    const clamped = Math.max(minZ, Math.min(MAX_Z, nz))
    if (el) {
      const cur = CELL * z
      pending.current = anchor ?? { cx: (el.scrollLeft + el.clientWidth / 2) / cur, cy: (el.scrollTop + el.clientHeight / 2) / cur, sx: el.clientWidth / 2, sy: el.clientHeight / 2 }
    }
    setZMap((m) => ({ ...m, [ri]: clamped }))
  }, [z, minZ, ri])

  useLayoutEffect(() => {
    const el = scroller.current, p = pending.current
    if (!el || !p) return
    pending.current = null
    el.scrollLeft = p.cx * cp - p.sx
    el.scrollTop = p.cy * cp - p.sy
    syncHeaders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cp])

  const zoomToCell = (x: number, y: number, nz = 1) => {
    const el = scroller.current
    if (!el) return
    const vi = rowPos.get(y) ?? 0
    pending.current = { cx: x + 0.5, cy: vi + 0.5, sx: el.clientWidth / 2, sy: el.clientHeight / 2 }
    if (Math.abs(nz - z) < 0.001) { el.scrollLeft = (x + 0.5) * cp - el.clientWidth / 2; el.scrollTop = (vi + 0.5) * cp - el.clientHeight / 2; pending.current = null; syncHeaders() }
    else setZMap((m) => ({ ...m, [ri]: nz }))
  }

  const syncHeaders = () => {
    const el = scroller.current
    if (!el) return
    if (colHdr.current) colHdr.current.style.transform = `translateX(${-el.scrollLeft}px)`
    if (rowHdr.current) rowHdr.current.style.transform = `translateY(${-el.scrollTop}px)`
  }

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const sx = e.clientX - r.left, sy = e.clientY - r.top
      pending.current = null
      const anchor = { cx: (el.scrollLeft + sx) / cp, cy: (el.scrollTop + sy) / cp, sx, sy }
      setZoom(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15), anchor)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [cp, z, setZoom])

  /* ── 선택 ── */
  const [sel, setSel] = useState<Sel>({ x0: 0, y0: 0, x1: 0, y1: 0 })
  const dragging = useRef(false)
  const ax = sel.x0, ay = sel.y0
  const active = cellAt(ax, ay)
  const bx0 = Math.min(sel.x0, sel.x1), bx1 = Math.max(sel.x0, sel.x1), by0 = Math.min(sel.y0, sel.y1), by1 = Math.max(sel.y0, sel.y1)

  const pointToCell = (clientX: number, clientY: number) => {
    const el = scroller.current!
    const r = el.getBoundingClientRect()
    const x = Math.max(0, Math.min(room.w - 1, Math.floor((clientX - r.left + el.scrollLeft) / cp)))
    const vi = Math.max(0, Math.min(visRows.length - 1, Math.floor((clientY - r.top + el.scrollTop) / cp)))
    return { x, y: visRows[vi] }
  }

  const formulaText = active ? active.text : ''

  /* ── 메뉴/대화상자 ── */
  const [menu, setMenu] = useState<{ x: number; y: number; kind: 'cell' | 'tab' } | null>(null)
  const [dropdown, setDropdown] = useState<'fill' | 'font' | 'fmt' | 'sort' | 'cf' | null>(null)
  const [pwFor, setPwFor] = useState<number | null>(null)
  const [hint, setHint] = useState<{ steps: string[]; level: number; key: string } | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  // 힌트는 처음 본 단계만 1번으로 센다
  useEffect(() => {
    if (!hint) return
    const k = `${hint.key}:${hint.level}`
    if (!s.hintsSeen[k]) up((d) => { d.hintsSeen[k] = true })
  }, [hint, s.hintsSeen, up])
  const [unhideSheet, setUnhideSheet] = useState(false)
  const [showClear, setShowClear] = useState(false)
  const [find, setFind] = useState<{ q: string; idx: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); setFind({ q: '', idx: -1 }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 실행 취소: 서식·정렬 같은 편집만 되돌린다 (잠금·시간은 그대로)
  type Snap = Pick<EscState, 'fills' | 'fmts' | 'unhidden' | 'sorts' | 'cf' | 'fonts' | 'autofit' | 'widen'>
  const history = useRef<Snap[]>([])
  const act = (fn: (d: EscState) => void) => {
    history.current.push(structuredClone({ fills: s.fills, fmts: s.fmts, unhidden: s.unhidden, sorts: s.sorts, cf: s.cf, fonts: s.fonts, autofit: s.autofit, widen: s.widen }))
    if (history.current.length > 50) history.current.shift()
    up(fn)
  }
  const undo = () => {
    setDropdown(null); setMenu(null)
    const snap = history.current.pop()
    if (!snap) return flash('되돌릴 작업이 없어요')
    setS((p) => ({ ...p, ...snap }))
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      e.preventDefault(); undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const selDataCells = () => dcells.filter((d) => d.kind === 'data' && d.y >= by0 && d.y <= by1 && d.x + d.span - 1 >= bx0 && d.x <= bx1)

  const applyFill = (color: string) => {
    setDropdown(null)
    act((d) => {
      for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
        if (hidden.has(y)) continue
        const k = `${ri}:${x}:${y}`
        if (color) d.fills[k] = color; else delete d.fills[k]
      }
    })
  }
  const applyFont = (color: string) => {
    setDropdown(null)
    act((d) => {
      for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
        const k = `${ri}:${x}:${y}`
        if (color) d.fonts[k] = color; else delete d.fonts[k]
      }
    })
  }
  const applyFmt = (f: string) => {
    setDropdown(null); setMenu(null)
    const cells = selDataCells()
    if (!cells.length) return flash('표 안의 셀을 선택하세요')
    act((d) => cells.forEach((c) => { d.fmts[c.key] = f }))
  }
  const applySort = (dir: 1 | -1) => {
    setDropdown(null); setMenu(null)
    if (!active || active.kind === 'title') return flash('정렬할 표의 열(셀)을 선택하세요')
    if (!active.table.sortable) return flash('이 표는 정렬할 수 없어요')
    act((d) => { d.sorts[active.table.id] = { col: active.col, dir } })
  }
  const unhideRows = () => {
    setMenu(null)
    const targets = [...hidden].filter((h) => by0 <= h + 1 && by1 >= h - 1)
    if (!targets.length) return flash('선택한 곳 근처에 숨긴 행이 없어요')
    act((d) => targets.forEach((h) => { d.unhidden[`${ri}:${h}`] = true }))
  }
  /** 이 열이 들어 있는 좁은 열(narrowCol)의 표 */
  const narrowTableAt = (col: number) => room.tables.find((tb) => {
    if (tb.narrowCol === undefined) return false
    let acc = tb.x
    for (let j = 0; j < tb.narrowCol; j++) acc += tb.spans[j]
    return col >= acc && col < acc + tb.spans[tb.narrowCol]
  })
  const narrowLast = (t: TableDef) => { let acc = t.x; for (let j = 0; j <= t.narrowCol!; j++) acc += t.spans[j]; return acc - 1 }
  const autofit = (x?: number, fromHeader = false) => {
    setMenu(null)
    const t = narrowTableAt(x ?? ax)
    if (!t) { if (!fromHeader) flash('이 열은 이미 너비가 충분해요'); return }
    const need = Math.max(0, FIT_SPAN - t.spans[t.narrowCol!])
    act((d) => { d.autofit[t.id] = true; d.widen[t.id] = Math.max(d.widen[t.id] ?? 0, need) })
  }
  /** 열 머리글 경계선 드래그: 좁은 열이면 끄는 동안 바로 넓어진다 */
  const [guide, setGuide] = useState<number | null>(null)
  const startResize = (e: React.PointerEvent, x: number) => {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const t = narrowTableAt(x)
    const w0 = t ? widenOf(t.id) : 0
    const edge = edgeOf(x)
    const calc = (cx: number) => (t ? Math.min(12, Math.max(0, w0 + (cx - startX) / cp)) : 0)
    const move = (ev: PointerEvent) => {
      if (t) setLive({ id: t.id, w: calc(ev.clientX) })
      setGuide(Math.max(x * cp + 4, edge + ev.clientX - startX))
    }
    const end = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', end)
      setGuide(null); setLive(null)
      if (!t) return
      const w = calc(ev.clientX)
      if (Math.abs(w - w0) < 0.05) return
      const span = t.spans[t.narrowCol!]
      act((d) => {
        d.widen[t.id] = w
        if (span + w >= FIT_SPAN - 0.1) d.autofit[t.id] = true; else delete d.autofit[t.id]
      })
    }
    setGuide(edge)
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end)
  }
  /** 좁은 열 셀의 너비(칸) */
  const spanOf = (d: DCell) => d.kind !== 'title' && d.table.narrowCol === d.col ? d.span + widenOf(d.table.id) : d.span
  /** 머리글에서 열 x 의 오른쪽 경계선 위치(px) */
  const edgeOf = (x: number) => {
    const t = narrowTableAt(x)
    return t && x === narrowLast(t) ? (x + 1 + widenOf(t.id)) * cp : (x + 1) * cp
  }
  /** 넓어진 좁은 열에 덮인 머리글 열 (경계선 손잡이를 숨긴다) */
  const coveredCols = useMemo(() => {
    const m = new Set<number>()
    for (const t of room.tables) if (t.narrowCol !== undefined) {
      const last = narrowLast(t), w = widenOf(t.id)
      for (let x = last + 1; x < last + 1 + w + 0.2; x++) m.add(x)
    }
    return m
  }, [room, s.widen, live]) // eslint-disable-line react-hooks/exhaustive-deps
  const [cfAsk, setCfAsk] = useState<{ table: string; op: 'gt' | 'lt' } | null>(null)
  const applyCf = (rule: string | null) => {
    setDropdown(null)
    if (!active?.table.cf) return flash('숫자가 있는 표의 셀을 선택하세요')
    const id = active.table.id
    if (rule === 'gt' || rule === 'lt') { setCfAsk({ table: id, op: rule }); return }
    act((d) => { if (rule) d.cf[id] = rule; else delete d.cf[id] })
  }

  const tryLock = (lockId: string, code: string) => {
    const lock = room.locks.find((l) => l.id === lockId)
    if (!lock) return
    if (s.opened[lockId]) return flash('이미 열려 있어요')
    if (code.trim() !== lock.answer) return queue([{ title: lock.title, icon: 'error', text: '암호가 틀렸습니다.' }])
    up((d) => { d.opened[lockId] = true })
    if (lockId === 'gate') track('escape_clear', { game_id: 'escape', seconds: Math.round(s.activeMs / 1000), hints: hintCount(s) })
    queue(lock.onOpen, lockId === 'gate' ? () => { up((d) => { d.finished = true }); setShowClear(true) } : undefined)
  }

  // 잠긴 셀 편집 (엑셀처럼 셀에 바로 입력)
  const [edit, setEdit] = useState<{ lock: string; x: number; y: number; span: number; val: string } | null>(null)
  const activeLock = active?.cell?.lock && !s.opened[active.cell.lock] ? active : null
  const startEdit = (initial = '') => {
    if (!activeLock?.cell?.lock) return false
    setEdit({ lock: activeLock.cell.lock, x: activeLock.x, y: activeLock.y, span: activeLock.span, val: initial })
    if (z < 0.7) zoomToCell(activeLock.x, activeLock.y, 1)
    return true
  }
  const commitEdit = () => {
    if (!edit) return
    const v = edit.val.trim().replace(/^=?\s*열기\s*\(\s*(\S+?)\s*\)$/, '$1')
    setEdit(null)
    if (v) tryLock(edit.lock, v)
  }
  useEffect(() => { setEdit(null) }, [ax, ay, ri])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (edit || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (document.querySelector('.xe-dim')) return
      if (e.key === 'Enter' || e.key === 'F2') { if (startEdit('')) e.preventDefault() }
      else if (e.key.length === 1) { if (startEdit(e.key)) e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const doFind = (q: string, from: number) => {
    const qq = q.trim().toLowerCase()
    if (!qq) return
    const matches = dcells.filter((d) => d.text.toLowerCase().includes(qq))
    if (!matches.length) { flash(`'${q}'을(를) 찾을 수 없습니다.`); return }
    const idx = (from + 1) % matches.length
    const m = matches[idx]
    setFind({ q, idx })
    setSel({ x0: m.x, y0: m.y, x1: m.x, y1: m.y })
    zoomToCell(m.x, m.y, Math.max(z, 1))
  }

  const goRoom = (i: number) => {
    setMenu(null)
    if (i === 3) { up((d) => { d.room = 3 }); return }
    if (i >= s.unlocked) { setPwFor(i); return }
    up((d) => { d.room = i })
    setSel({ x0: 0, y0: 0, x1: 0, y1: 0 })
  }
  const unlockRoom = (i: number, pw: string) => {
    if (pw.trim() !== ROOMS[i].password) return false
    up((d) => { d.unlocked = Math.max(d.unlocked, i + 1); d.room = i; d.seenEnter[i] = true })
    setPwFor(null)
    setSel({ x0: 0, y0: 0, x1: 0, y1: 0 })
    if (!s.seenEnter[i]) queue(ROOMS[i].enter)
    return true
  }

  const clickHotspot = (h: Hotspot) => {
    if (h.say) queue([{ title: h.label, icon: 'info', text: h.say.join('\n') }])
    else zoomToCell(Math.floor(h.x + h.w / 2), visRows.reduce((best, y) => (Math.abs(y - (h.y + h.h / 2)) < Math.abs(best - (h.y + h.h / 2)) ? y : best), visRows[0]), 1)
  }

  const openHint = () => {
    if (ri === 3 || s.finished) return queue([{ title: '힌트', icon: 'info', text: '이미 탈출했어요! 시트 탭을 우클릭해 보세요.' }])
    const h = ROOMS[ri].hints.find((x) => !flags[x.until])
    if (!h) return queue([{ title: '힌트', icon: 'info', text: '이 시트는 다 풀었어요. 다음 시트 탭을 열어 보세요.' }])
    setHint({ steps: h.steps, level: 0, key: `${ri}:${h.until}` })
  }

  const reset = () => {
    clearState(); history.current = []; setShowClear(false); setConfirmReset(false); setHint(null); setS(freshState()); setZMap({})
    setSel({ x0: 0, y0: 0, x1: 0, y1: 0 })
    queue(INTRO, () => up((d) => { d.introDone = true }))
  }
  const [nick, setNick] = useState(loadNickname)
  const rival = useMemo(() => loadRival(), [showClear])
  const mySec = Math.round(s.activeMs / 1000)
  const myHints = hintCount(s)
  const copyShare = async () => {
    const n = nick.trim()
    if (!n) return flash('닉네임을 입력하세요')
    saveNickname(n)
    const url = resultUrl(n, mySec, myHints)
    const text = `[${EP_TITLE}] ${n} 님 탈출 성공! 걸린 시간 ${fmtSec(mySec)} · ${fmtHints(myHints)}\n너도 해봐 → ${url}`
    track('share_result', { game_id: 'escape' })
    try { await navigator.clipboard.writeText(text); flash('자랑 링크를 복사했어요. 메신저에 붙여넣으세요!') } catch { flash(url) }
  }

  /* ── 그리기 ── */
  const textOpacity = Math.max(0, Math.min(1, (z - 0.45) / 0.25))
  const showHotspots = z < 0.7
  const W = room.w * cp, H = visRows.length * cp
  const gridAlpha = cp < 8 ? 0.04 : 0.09
  const blinkOn = ri === 1 && !flags.r2_release
  const activeComment = active?.cell?.comment

  return (
    <div className="xe" onClick={() => { setMenu(null); setDropdown(null) }} onMouseUp={() => { dragging.current = false }}>
      <div className="xe-title"><span className="xe-logo">X</span><span className="xe-tmid">{FILE_NAME}</span><span className="xe-win">—  ☐  ✕</span></div>
      <div className="xe-ribbon">{['파일', '홈', '삽입', '페이지 레이아웃', '수식', '데이터', '검토', '보기'].map((t) => <span key={t} className={t === '홈' ? 'on' : ''}>{t}</span>)}</div>
      <div className="xe-tools" onClick={(e) => e.stopPropagation()}>
        <div className="grp"><button onClick={undo} title="실행 취소 (Ctrl+Z)">↶ 실행 취소</button></div>
        <div className="grp rel">
          <button onClick={() => setDropdown(dropdown === 'fill' ? null : 'fill')}><i className="sw" style={{ background: '#fff2a8' }} />채우기 색 ▾</button>
          {dropdown === 'fill' && <div className="dd">{FILLS.map(([c, n]) => <button key={n} onClick={() => applyFill(c)}><i className="sw" style={{ background: c || '#fff' }} />{n}</button>)}</div>}
        </div>
        <div className="grp rel">
          <button onClick={() => setDropdown(dropdown === 'font' ? null : 'font')}><b className="fc">가</b>글꼴 색 ▾</button>
          {dropdown === 'font' && <div className="dd">{FONTS.map(([c, n]) => <button key={n} onClick={() => applyFont(c)}><b className="fc" style={{ color: c || '#222', background: c === '#ffffff' ? '#999' : undefined }}>가</b>{n}</button>)}</div>}
        </div>
        <div className="grp rel">
          <button onClick={() => setDropdown(dropdown === 'fmt' ? null : 'fmt')}>표시 형식 ▾</button>
          {dropdown === 'fmt' && <div className="dd">{FORMATS.map(([f, n]) => <button key={f} onClick={() => applyFmt(f)}>{n}</button>)}</div>}
        </div>
        <div className="grp"><button onClick={() => autofit()}>열 너비 자동 맞춤</button><button onClick={unhideRows}>숨기기 취소</button></div>
        <div className="grp rel">
          <button onClick={() => setDropdown(dropdown === 'cf' ? null : 'cf')}>조건부 서식 ▾</button>
          {dropdown === 'cf' && (
            <div className="dd">
              <button onClick={() => applyCf('gt')}><i className="sw" style={{ background: '#ffc7ce' }} />셀 강조 규칙: 보다 큼…</button>
              <button onClick={() => applyCf('lt')}><i className="sw" style={{ background: '#ffc7ce' }} />셀 강조 규칙: 보다 작음…</button>
              <button onClick={() => applyCf('top10')}><i className="sw" style={{ background: '#ffc7ce' }} />상위 10%</button>
              <button onClick={() => applyCf('bar')}><i className="sw bar" />데이터 막대</button>
              <button onClick={() => applyCf('scale')}><i className="sw cs" />색조: 흰색 - 빨강</button>
              <button onClick={() => applyCf('icon')}><i className="sw ic">▲</i>아이콘 집합</button>
              <hr /><button onClick={() => applyCf(null)}>규칙 지우기</button>
            </div>
          )}
        </div>
        <div className="grp rel">
          <button onClick={() => setDropdown(dropdown === 'sort' ? null : 'sort')}>정렬 및 필터 ▾</button>
          {dropdown === 'sort' && <div className="dd"><button onClick={() => applySort(1)}>오름차순 정렬</button><button onClick={() => applySort(-1)}>내림차순 정렬</button></div>}
        </div>
        <div className="grp"><button onClick={() => setFind({ q: find?.q ?? '', idx: -1 })}>찾기</button></div>
        <div className="grp end"><button onClick={openHint}>힌트</button><button onClick={() => setConfirmReset(true)}>처음부터 다시 하기</button></div>
      </div>

      <div className="xe-fbar">
        <span className="xe-name">{colName(ax)}{ay + 1}</span>
        <span className="xe-fx">fx</span>
        <input className="xe-fval" value={edit ? edit.val : formulaText} readOnly tabIndex={-1} />
      </div>

      <div className="xe-sheet">
        <div className="xe-corner" />
        <div className="xe-colhdr-wrap">
          <div className="xe-colhdr" ref={colHdr} style={{ width: W }}>
            {cp >= 14 && Array.from({ length: room.w }, (_, x) => {
              const t = narrowTableAt(x)
              const wide = t && x === narrowLast(t) ? widenOf(t.id) : 0
              return (
                <span key={x} className={(x >= bx0 && x <= bx1 ? 'hi' : '') + (wide ? ' wide' : '')} style={{ left: x * cp, width: cp * (1 + wide) }}
                  onDoubleClick={() => autofit(x, true)}>{colName(x)}</span>
              )
            })}
            {cp >= 14 && Array.from({ length: room.w }, (_, x) => !coveredCols.has(x) && (
              <i key={'r' + x} className="rz" style={{ left: edgeOf(x) - 4 }}
                onPointerDown={(e) => startResize(e, x)} onDoubleClick={() => autofit(x, true)} />
            ))}
            {guide !== null && <i className="xe-guide hdr" style={{ left: guide }} />}
          </div>
        </div>
        <div className="xe-rowhdr-wrap">
          <div className="xe-rowhdr" ref={rowHdr} style={{ height: H }}>
            {visRows.map((y, vi) => (
              <span key={y} className={(y >= by0 && y <= by1 ? 'hi' : '') + (vi > 0 && visRows[vi - 1] !== y - 1 ? ' jump' : '')}
                style={{ top: vi * cp, height: cp, fontSize: Math.min(11, cp * 0.55), lineHeight: `${cp}px` }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSel({ x0: 0, y0: y, x1: room.w - 1, y1: y }); setMenu({ x: e.clientX, y: e.clientY, kind: 'cell' }) }}>
                {cp >= 9 ? y + 1 : ''}
              </span>
            ))}
          </div>
        </div>
        <div className="xe-scroll" ref={scroller} onScroll={syncHeaders}
          style={{ backgroundSize: `${cp}px ${cp}px`, backgroundImage: `linear-gradient(to right, rgba(0,0,0,${gridAlpha}) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,${gridAlpha}) 1px, transparent 1px)`, backgroundAttachment: 'local' }}>
          <div className="xe-inner" style={{ width: W, height: H }}
            onMouseDown={(e) => {
              if (e.button !== 0 || (e.target as HTMLElement).closest('.hs')) return
              const c = pointToCell(e.clientX, e.clientY); dragging.current = true; setSel({ x0: c.x, y0: c.y, x1: c.x, y1: c.y })
            }}
            onMouseMove={(e) => { if (dragging.current) { const c = pointToCell(e.clientX, e.clientY); setSel((p) => ({ ...p, x1: c.x, y1: c.y })) } }}
            onDoubleClick={(e) => {
              const c = pointToCell(e.clientX, e.clientY)
              const d = cellAt(c.x, c.y)
              if (d?.cell?.lock && !s.opened[d.cell.lock] && z >= 0.7) { setEdit({ lock: d.cell.lock, x: d.x, y: d.y, span: d.span, val: '' }); return }
              if (z < 0.95) zoomToCell(c.x, c.y, 1)
            }}
            onContextMenu={(e) => {
              e.preventDefault(); e.stopPropagation()
              const c = pointToCell(e.clientX, e.clientY)
              if (!(c.x >= bx0 && c.x <= bx1 && c.y >= by0 && c.y <= by1)) setSel({ x0: c.x, y0: c.y, x1: c.x, y1: c.y })
              setMenu({ x: e.clientX, y: e.clientY, kind: 'cell' })
            }}>
            <canvas ref={canvasRef} className="xe-canvas" style={{ width: W, height: H }} />
            <div className="xe-lines" style={{ backgroundSize: `${cp}px ${cp}px`, backgroundImage: `linear-gradient(to right, rgba(0,0,0,${gridAlpha}) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,${gridAlpha}) 1px, transparent 1px)` }} />
            {blinkOn && room.blink?.map((b) => rowPos.has(b.y) && <i key={`${b.x}-${b.y}`} className="xe-blink" style={{ left: b.x * cp, top: rowPos.get(b.y)! * cp, width: cp, height: cp }} />)}
            <div className="xe-bars">
              {dcells.map((d, i) => { const cf = cfOf(d); return cf?.bar && rowPos.has(d.y)
                ? <i key={i} style={{ left: d.x * cp + 1, top: rowPos.get(d.y)! * cp + cp * 0.15, width: (cp - 2) * cf.bar, height: cp * 0.7 }} /> : null })}
            </div>
            {textOpacity > 0 && (
              <div className="xe-texts" style={{ opacity: textOpacity }}>
                {dcells.filter((d) => rowPos.has(d.y) && d.text).map((d, i) => {
                  const fill = s.fills[`${ri}:${d.x}:${d.y}`]
                  const font = s.fonts[`${ri}:${d.x}:${d.y}`]
                  const cf = cfOf(d)
                  const color = font || (d.cell?.white ? '#ffffff' : isDark(fill) ? '#ffffff' : cf?.hi ? '#9c0006' : d.color ?? '#222222')
                  return (
                    <span key={i} className={'xe-t' + (d.cell?.lock ? (s.opened[d.cell.lock] ? ' unlocked' : ' locked') : '')}
                      style={{ left: d.x * cp, top: rowPos.get(d.y)! * cp, width: spanOf(d) * cp, height: cp, lineHeight: `${cp}px`, fontSize: 12 * z,
                        padding: `0 ${3 * z}px`, color, fontWeight: d.bold ? 700 : 400, textAlign: d.align as 'left',
                        ...(spanOf(d) !== d.span ? { background: fill || (d.kind === 'header' ? d.table.headerFill : undefined) || '#ffffff', boxShadow: 'inset -1px -1px 0 #d4d4d4', zIndex: 1 } : null) }}>
                      {cf?.icon && <b className={'cf-ic ' + (cf.icon === '▲' ? 'up' : cf.icon === '▼' ? 'down' : 'mid')}>{cf.icon}</b>}{d.text}{d.cell?.comment && <i className="cm" />}
                    </span>
                  )
                })}
              </div>
            )}
            {guide !== null && <i className="xe-guide" style={{ left: guide }} />}
            {rowPos.has(by0) && (
              <div className="xe-sel" style={{ left: bx0 * cp, top: rowPos.get(by0)! * cp, width: (bx1 - bx0 + 1) * cp, height: (visRows.filter((y) => y >= by0 && y <= by1).length) * cp }} />
            )}
            {edit && rowPos.has(edit.y) && (
              <input className="xe-edit" autoFocus value={edit.val} placeholder="암호 입력 후 Enter"
                style={{ left: edit.x * cp, top: rowPos.get(edit.y)! * cp, width: Math.max(edit.span * cp, 140), height: cp, fontSize: Math.max(12, 12 * z) }}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => setEdit({ ...edit, val: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitEdit() } else if (e.key === 'Escape') setEdit(null) }}
                onBlur={() => setEdit(null)} />
            )}
            {active && rowPos.has(active.y) && (
              <div className="xe-act" style={{ left: active.x * cp, top: rowPos.get(active.y)! * cp, width: active.span * cp, height: cp }}>
                {activeComment && textOpacity > 0.5 && <span className="memo">{activeComment}</span>}
              </div>
            )}
            {showHotspots && room.hotspots(flags).map((h) => {
              const top = rowPos.get(h.y) ?? visRows.findIndex((y) => y > h.y)
              return (
                <button key={h.label} className="hs" title={h.label} onClick={(e) => { e.stopPropagation(); clickHotspot(h) }}
                  style={{ left: h.x * cp, top: top * cp, width: h.w * cp, height: h.h * cp }}><span>{h.label}</span></button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="xe-tabs" onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, kind: 'tab' }) }}>
        {ROOMS.map((r, i) => (
          <button key={r.name} className={(ri === i ? 'on' : '') + (i >= s.unlocked ? ' lock' : '')} onClick={() => goRoom(i)}>
            {i >= s.unlocked && <i className="lockic" />}{r.name}
          </button>
        ))}
        {s.giftShown && <button className={ri === 3 ? 'on' : ''} onClick={() => goRoom(3)}>{GIFT.name}</button>}
        <span className="plus">⊕</span>
      </div>
      <div className="xe-status" onClick={(e) => e.stopPropagation()}>
        <span className="rd">준비</span>
        <span>경과 {fmtTime(s.activeMs)}</span>
        <button onClick={openHint}>힌트</button>
        <span>사용 {myHints}회</span>
        <span className="sp" />
        <button onClick={() => setZoom(fitZ)}>전체 보기</button>
        <button onClick={() => setZoom(1)}>100%</button>
        <button className="pm" onClick={() => setZoom(z / 1.25)}>−</button>
        <input className="zs" type="range" min={Math.round(minZ * 100)} max={MAX_Z * 100} value={Math.round(z * 100)}
          onChange={(e) => setZoom(Number(e.target.value) / 100)} aria-label="확대/축소" />
        <button className="pm" onClick={() => setZoom(z * 1.25)}>+</button>
        <b className="zp">{Math.round(z * 100)}%</b>
      </div>

      {menu && (
        <div className="xe-menu" style={{ left: Math.min(menu.x, window.innerWidth - 190), top: menu.kind === 'tab' ? menu.y - 110 : Math.min(menu.y, window.innerHeight - 260) }} onClick={(e) => e.stopPropagation()}>
          {menu.kind === 'cell' ? (
            <>
              <button disabled>잘라내기</button><button disabled>복사</button><hr />
              <button onClick={() => applyFmt('date')}>셀 서식: 날짜</button>
              <button onClick={() => applyFmt('general')}>셀 서식: 일반</button>
              <button onClick={() => applySort(1)}>정렬: 오름차순</button>
              <button onClick={() => autofit()}>열 너비 자동 맞춤</button><hr />
              <button onClick={unhideRows}>숨기기 취소</button>
            </>
          ) : (
            <>
              <button disabled>삽입…</button><button disabled>삭제</button><button disabled>이름 바꾸기</button><hr />
              <button disabled={!s.finished || s.giftShown} onClick={() => { setMenu(null); setUnhideSheet(true) }}>숨기기 취소…</button>
            </>
          )}
        </div>
      )}

      {find && !cur && (
        <div className="xe-find" onClick={(e) => e.stopPropagation()}>
          <div className="xe-dt"><span>찾기 및 바꾸기</span><button className="x" onClick={() => setFind(null)}>✕</button></div>
          <form onSubmit={(e) => { e.preventDefault(); doFind(find.q, find.idx) }}>
            <label className="xe-row">찾을 내용(N): <input autoFocus value={find.q} onChange={(e) => setFind({ q: e.target.value, idx: -1 })} /></label>
            <div className="xe-btns"><button className="pri" type="submit">다음 찾기</button><button type="button" onClick={() => setFind(null)}>닫기</button></div>
          </form>
        </div>
      )}

      {cur && (
        <Dialog title={cur.pages[page].title}>
          <div className="xe-story"><Icon kind={cur.pages[page].icon} /><p>{cur.pages[page].text}</p></div>
          <div className="xe-btns">
            {cur.pages.length > 1 && <span className="pg">{page + 1} / {cur.pages.length}</span>}
            {page > 0 && <button onClick={() => setPage(page - 1)}>{'< 이전'}</button>}
            <button className="pri" autoFocus onClick={() => {
              if (page + 1 < cur.pages.length) setPage(page + 1)
              else { setPage(0); setPopups((q) => q.slice(1)); cur.onDone?.() }
            }}>{page + 1 < cur.pages.length ? '다음 >' : '확인'}</button>
          </div>
        </Dialog>
      )}

      {!cur && pwFor !== null && <PasswordDialog sheet={ROOMS[pwFor].name} onCancel={() => setPwFor(null)} onSubmit={(pw) => unlockRoom(pwFor, pw)} />}
      {!cur && cfAsk && <NumDialog op={cfAsk.op} onCancel={() => setCfAsk(null)} onSubmit={(n) => { const t = cfAsk.table; setCfAsk(null); act((d) => { d.cf[t] = `${cfAsk.op}:${n}` }) }} />}
      {!cur && confirmReset && (
        <Dialog title={FILE_NAME} onClose={() => setConfirmReset(false)}>
          <div className="xe-story"><Icon kind="warn" /><p>처음부터 다시 할까요?{'\n'}지금까지의 진행 상황과 시간, 힌트 기록이 모두 초기화돼요.</p></div>
          <div className="xe-btns"><button className="pri" onClick={reset}>처음부터</button><button onClick={() => setConfirmReset(false)}>취소</button></div>
        </Dialog>
      )}
      {!cur && hint && (
        <Dialog title="힌트" onClose={() => setHint(null)}>
          <div className="xe-story"><Icon kind="info" /><p>{hint.steps[hint.level]}</p></div>
          <div className="xe-btns">
            {hint.level > 0 && <button onClick={() => setHint({ ...hint, level: hint.level - 1 })}>{'< 이전'}</button>}
            {hint.level + 1 < hint.steps.length && <button onClick={() => setHint({ ...hint, level: hint.level + 1 })}>더 자세히</button>}
            <button className="pri" onClick={() => setHint(null)}>확인</button>
          </div>
        </Dialog>
      )}
      {!cur && unhideSheet && (
        <Dialog title="숨기기 취소" onClose={() => setUnhideSheet(false)}>
          <div className="xe-body"><p>숨기기 취소할 시트:</p><div className="xe-list"><div className="on">{GIFT.name}</div></div></div>
          <div className="xe-btns">
            <button className="pri" onClick={() => { setUnhideSheet(false); up((d) => { d.giftShown = true; d.room = 3 }) }}>확인</button>
            <button onClick={() => setUnhideSheet(false)}>취소</button>
          </div>
        </Dialog>
      )}
      {!cur && showClear && (
        <Dialog title={FILE_NAME} onClose={() => setShowClear(false)}>
          <div className="xe-story">
            <Icon kind="ok" />
            <div>
              <p><b>탈출 완료!</b> 모든 시트의 보호를 해제했습니다.</p>
              <div className="xe-big">{fmtSec(mySec)}</div>
              <p className="xe-hints">{fmtHints(myHints)}</p>
              <p className="dim">{EP_TITLE}</p>
              {rival && (
                <p className="xe-vs">
                  {rival.n} 님 {fmtSec(rival.t)}{rival.h !== undefined ? ` (${fmtHints(rival.h)})` : ''} vs 나 {fmtSec(mySec)} ({fmtHints(myHints)})<br />
                  <b>{mySec < rival.t ? `${fmtSec(rival.t - mySec)} 빨라요! 🎉` : mySec > rival.t ? `${fmtSec(mySec - rival.t)} 느려요 ㅠ` : '똑같아요!'}</b>
                </p>
              )}
              <label className="xe-row">닉네임: <input value={nick} maxLength={10} onChange={(e) => setNick(e.target.value)} placeholder="자랑할 이름 (최대 10자)" /></label>
            </div>
          </div>
          <div className="xe-btns">
            <button onClick={copyShare}>자랑 링크 복사</button><button onClick={reset}>처음부터</button>
            <button onClick={() => nav('/')}>로비로</button><button className="pri" onClick={() => setShowClear(false)}>닫기</button>
          </div>
        </Dialog>
      )}
      {toast && <div className="xe-toast">{toast}</div>}
    </div>
  )
}

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="xe-dim" onClick={(e) => e.stopPropagation()}>
      <div className="xe-dlg" role="dialog" aria-label={title}>
        <div className="xe-dt"><span>{title}</span>{onClose && <button className="x" onClick={onClose}>✕</button>}</div>
        {children}
      </div>
    </div>
  )
}

function PasswordDialog({ sheet, onCancel, onSubmit }: { sheet: string; onCancel: () => void; onSubmit: (pw: string) => boolean }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)
  return (
    <Dialog title="시트 보호 해제" onClose={onCancel}>
      <form onSubmit={(e) => { e.preventDefault(); if (!onSubmit(pw)) { setErr(true); setPw('') } }}>
        <div className="xe-body">
          <p>'{sheet}' 시트는 보호되어 있습니다.</p>
          <label className="xe-row">암호(P): <input type="password" autoFocus value={pw} onChange={(e) => { setPw(e.target.value); setErr(false) }} /></label>
          {err ? <p className="xe-err">암호가 잘못되었습니다.</p> : <p className="dim">앞 시트의 단서를 모두 풀면 암호를 알 수 있어요.</p>}
        </div>
        <div className="xe-btns"><button className="pri" type="submit">확인</button><button type="button" onClick={onCancel}>취소</button></div>
      </form>
    </Dialog>
  )
}

function NumDialog({ op, onCancel, onSubmit }: { op: 'gt' | 'lt'; onCancel: () => void; onSubmit: (n: number) => void }) {
  const [t, setT] = useState('')
  return (
    <Dialog title={op === 'gt' ? '보다 큼' : '보다 작음'} onClose={onCancel}>
      <form onSubmit={(e) => { e.preventDefault(); const n = Number(t); if (t.trim() && !Number.isNaN(n)) onSubmit(n) }}>
        <div className="xe-body">
          <p>다음 값보다 {op === 'gt' ? '큰' : '작은'} 셀의 서식 지정:</p>
          <label className="xe-row"><input autoFocus inputMode="numeric" value={t} onChange={(e) => setT(e.target.value)} /> <span className="cf-sample">진한 빨강 텍스트가 있는 연한 빨강 채우기</span></label>
        </div>
        <div className="xe-btns"><button className="pri" type="submit">확인</button><button type="button" onClick={onCancel}>취소</button></div>
      </form>
    </Dialog>
  )
}

function Icon({ kind }: { kind: StoryPage['icon'] }) {
  const map = { warn: ['!', '#f2b400'], info: ['i', '#2b6cb0'], error: ['✕', '#c42b1c'], ok: ['✓', '#217346'] } as const
  const [ch, bg] = map[kind]
  return <span className="xe-ic" style={{ background: bg }}>{ch}</span>
}
