import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { dims, fits, flipH, flipV, shapeCells, turnCCW, turnCW, type Cell, type Orient, type Puzzle } from './logic'

/** 혼자 하기·대결이 같이 쓰는 판·도형·조작 */

export const COLORS = ['#4472c4', '#ed7d31', '#70ad47', '#5b9bd5', '#ffc000', '#8e5cc4']

/** 리본 아이콘 (PPT 회전 메뉴 모양) */
export const ICONS: Record<string, JSX.Element> = {
  cw: <svg viewBox="0 0 24 24"><rect x="4" y="9" width="10" height="10" fill="#fbe5dd" stroke="#c43e1c" /><path d="M12 4a8 8 0 0 1 8 8" fill="none" stroke="#333" strokeWidth="1.8" /><path d="M20 8v4h-4" fill="none" stroke="#333" strokeWidth="1.8" /></svg>,
  ccw: <svg viewBox="0 0 24 24"><rect x="10" y="9" width="10" height="10" fill="#fbe5dd" stroke="#c43e1c" /><path d="M12 4a8 8 0 0 0-8 8" fill="none" stroke="#333" strokeWidth="1.8" /><path d="M4 8v4h4" fill="none" stroke="#333" strokeWidth="1.8" /></svg>,
  fh: <svg viewBox="0 0 24 24"><path d="M10 5 3 19h7z" fill="#c43e1c" /><path d="M14 5l7 14h-7z" fill="none" stroke="#c43e1c" strokeWidth="1.5" /><path d="M12 3v18" stroke="#333" strokeDasharray="2 2" /></svg>,
  fv: <svg viewBox="0 0 24 24"><path d="M5 10 19 3v7z" fill="#c43e1c" /><path d="M5 14l14 7v-7z" fill="none" stroke="#c43e1c" strokeWidth="1.5" /><path d="M3 12h18" stroke="#333" strokeDasharray="2 2" /></svg>,
  add: <svg viewBox="0 0 24 24"><rect x="3" y="5" width="16" height="12" fill="#fff" stroke="#888" /><path d="M18 14v8M14 18h8" stroke="#c43e1c" strokeWidth="2" /></svg>,
  clr: <svg viewBox="0 0 24 24"><path d="M5 12a7 7 0 1 0 2-5" fill="none" stroke="#333" strokeWidth="1.8" /><path d="M7 3v4h4" fill="none" stroke="#333" strokeWidth="1.8" /></svg>,
  skip: <svg viewBox="0 0 24 24"><path d="M6 3v18" stroke="#333" strokeWidth="1.8" /><path d="M6 4h12l-3 4 3 4H6z" fill="#fbe5dd" stroke="#c43e1c" strokeWidth="1.5" /></svg>,
  help: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="#c43e1c" strokeWidth="1.6" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5V14" fill="none" stroke="#c43e1c" strokeWidth="1.6" /><circle cx="12" cy="17" r="1" fill="#c43e1c" /></svg>,
}

export function useCellSize() {
  const pick = () => (window.innerWidth >= 1200 ? 44 : window.innerWidth >= 760 ? 38 : 30)
  const [cs, setCs] = useState(pick)
  useEffect(() => { const f = () => setCs(pick()); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])
  return cs
}

/** 도형 하나 (칸 묶음). 선택되면 PPT처럼 테두리·핸들·회전 핸들 */
function Shape({ puz, id, orient, cs, selected, spin, faded, onDown, onSpinDown, onContext, onDouble, onWheel }: {
  puz: Puzzle; id: number; orient: Orient; cs: number; selected?: boolean; spin?: number; faded?: boolean
  onDown?: (e: RPointerEvent<HTMLDivElement>) => void; onSpinDown?: (e: RPointerEvent<HTMLSpanElement>) => void
  onContext?: (shift: boolean) => void; onDouble?: (shift: boolean) => void; onWheel?: (down: boolean) => void
}) {
  const pc = puz.pieces[id]
  const cells = shapeCells(pc.shape, orient)
  const { h, w } = dims(cells)
  const col = COLORS[puz.color[id] ?? id % COLORS.length]
  return (
    <div className={'sp-shape' + (selected ? ' sel' : '') + (faded ? ' faded' : '') + (spin ? ' spinning' : '')} style={{ width: w * cs, height: h * cs, transform: spin ? `rotate(${spin}deg)` : undefined }}
      onPointerDown={onDown}
      onContextMenu={(e) => { e.preventDefault(); onContext?.(e.shiftKey) }}
      onDoubleClick={(e) => onDouble?.(e.shiftKey)}
      onWheel={(e) => onWheel?.(e.deltaY > 0)}>
      {cells.map(([r, c]) => <i key={`${r},${c}`} style={{ left: c * cs, top: r * cs, width: cs, height: cs, background: col }} />)}
      {selected && <>
        <b className="hd tl" /><b className="hd tr" /><b className="hd bl" /><b className="hd br" />
        <span className="rot" title="잡고 돌리기" onPointerDown={onSpinDown}>↻</span>
      </>}
    </div>
  )
}

/** 판 점유 (칸마다 조각 id) */
export function filledOf(puz: Puzzle): (number | null)[] {
  const g: (number | null)[] = Array(puz.h * puz.w).fill(null)
  for (const pc of puz.pieces) if (pc.at) for (const [r, c] of shapeCells(pc.shape, pc.orient)) g[(r + pc.at[0]) * puz.w + c + pc.at[1]] = pc.id
  return g
}

/** 작은 판. filled 를 주면 색 대신 채운 칸 모양만 (남의 진행) */
export function MiniBoard({ puz, cs = 9, filled }: { puz: { h: number; w: number; mask: boolean[]; pieces?: Puzzle['pieces']; color?: number[] }; cs?: number; filled?: number[] }) {
  const g = filled ? null : filledOf(puz as Puzzle)
  const on = new Set(filled ?? [])
  return (
    <div className="sp-mini" style={{ width: puz.w * cs, height: puz.h * cs }}>
      {puz.mask.map((m, i) => m && (
        <i key={i} style={{
          left: (i % puz.w) * cs, top: Math.floor(i / puz.w) * cs, width: cs, height: cs,
          background: filled ? (on.has(i) ? '#8fa0c0' : '#e8ecf3') : g![i] !== null ? COLORS[(puz as Puzzle).color[g![i]!] ?? 0] : '#e8ecf3',
        }} />
      ))}
    </div>
  )
}

interface Drag { id: number; offX: number; offY: number; x: number; y: number; sx: number; sy: number; moved: boolean }
interface Spin { id: number; cx: number; cy: number; last: number; deg: number }

/**
 * 판·대기 칸·끌기·회전·키보드. locked 면 조작 막힘.
 * 키: E·R 시계, Q 반시계, F 좌우, V 상하, Esc 선택 해제, Delete 빼기, Tab·1~5 고르기 (입력칸 안에서는 무시)
 */
export function useShapePlay(puz: Puzzle | null, setPuz: (fn: (p: Puzzle) => Puzzle) => void, locked: boolean) {
  const cs = useCellSize()
  const [sel, setSel] = useState<number | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [spin, setSpin] = useState<Spin | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const wheelAt = useRef(0)
  const dragRef = useRef<Drag | null>(null)
  dragRef.current = drag
  const spinRef = useRef<Spin | null>(null)
  spinRef.current = spin
  const csRef = useRef(cs)
  csRef.current = cs
  const lockedRef = useRef(locked)
  lockedRef.current = locked

  useEffect(() => { if (locked) { setSel(null); setDrag(null); setSpin(null) } }, [locked])

  /** 방향 바꾸기: 판 위면 가운데를 기준으로 그 자리 유지, 안 맞으면 대기 칸으로 */
  const reorient = useCallback((id: number, fn: (o: Orient) => Orient) => {
    if (lockedRef.current) return
    setPuz((p) => {
      const pc = p.pieces[id]
      const o = fn(pc.orient)
      let at: Cell | null = null
      if (pc.at) {
        const a = dims(shapeCells(pc.shape, pc.orient)), b = dims(shapeCells(pc.shape, o))
        const tryAt: Cell[] = [[pc.at[0] + Math.round((a.h - b.h) / 2), pc.at[1] + Math.round((a.w - b.w) / 2)], pc.at]
        at = tryAt.find((t) => fits(p, pc, o, t)) ?? null
      }
      return { ...p, pieces: p.pieces.map((x) => (x.id === id ? { ...x, orient: o, at } : x)) }
    })
    // 끌고 있는 중이면 손가락 아래 가운데로
    setDrag((d) => {
      if (!d || d.id !== id || !puz) return d
      const b = dims(shapeCells(puz.pieces[id].shape, fn(puz.pieces[id].orient)))
      return { ...d, offX: (b.w * csRef.current) / 2, offY: (b.h * csRef.current) / 2 }
    })
  }, [setPuz, puz])
  const reorientRef = useRef(reorient)
  reorientRef.current = reorient

  const target = (d: Drag): Cell | null => {
    const el = boardRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const c = csRef.current
    return [Math.round((d.y - d.offY - r.top) / c), Math.round((d.x - d.offX - r.left) / c)]
  }

  const onDown = (id: number) => (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || lockedRef.current) return
    e.preventDefault()
    // 대화 입력 중이었다면 빠져나오기 (회전 키가 대화창에 입력되지 않게)
    const a = document.activeElement as HTMLElement | null
    if (a && a.matches('input, textarea')) a.blur()
    setSel(id)
    const rect = e.currentTarget.getBoundingClientRect()
    setDrag({ id, offX: e.clientX - rect.left, offY: e.clientY - rect.top, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false })
  }
  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => setDrag((d) => d && { ...d, x: e.clientX, y: e.clientY, moved: d.moved || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4 })
    const up = () => {
      const d = dragRef.current
      if (d?.moved && !lockedRef.current) {
        const at = target(d)
        setPuz((p) => {
          const pc = p.pieces[d.id]
          const ok = at && fits(p, pc, pc.orient, at)
          return { ...p, pieces: p.pieces.map((x) => (x.id === d.id ? { ...x, at: ok ? at : null } : x)) }
        })
      }
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up) }
  }, [!!drag]) // eslint-disable-line react-hooks/exhaustive-deps

  // 회전 핸들 잡고 돌리기 → 놓으면 가까운 90도로
  const onSpinDown = (id: number) => (e: RPointerEvent<HTMLSpanElement>) => {
    e.preventDefault(); e.stopPropagation()
    const a = document.activeElement as HTMLElement | null
    if (a && a.matches('input, textarea')) a.blur()
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2
    setSpin({ id, cx, cy, last: Math.atan2(e.clientY - cy, e.clientX - cx), deg: 0 })
  }
  useEffect(() => {
    if (!spin) return
    const move = (e: PointerEvent) => setSpin((s) => {
      if (!s) return s
      const a = Math.atan2(e.clientY - s.cy, e.clientX - s.cx)
      let d = a - s.last
      if (d > Math.PI) d -= 2 * Math.PI
      if (d < -Math.PI) d += 2 * Math.PI
      return { ...s, last: a, deg: s.deg + (d * 180) / Math.PI }
    })
    const up = () => {
      const s = spinRef.current
      if (s) {
        const k = ((Math.round(s.deg / 90) % 4) + 4) % 4
        if (k) reorientRef.current(s.id, (o) => ({ ...o, rot: (o.rot + k) % 4 }))
      }
      setSpin(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up) }
  }, [!!spin]) // eslint-disable-line react-hooks/exhaustive-deps

  const wheel = (id: number) => (down: boolean) => {
    if (lockedRef.current || Date.now() - wheelAt.current < 140) return
    wheelAt.current = Date.now()
    setSel(id); reorient(id, down ? turnCW : turnCCW)
  }

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest('input, textarea, select')) return
    if (!puz || locked) return
    const k = e.code
    if (k === 'Escape') { setSel(null); return }
    if (k === 'Tab') { e.preventDefault(); const n = puz.pieces.length; setSel((s) => (s === null ? 0 : (s + (e.shiftKey ? n - 1 : 1)) % n)); return }
    if (/^Digit[1-5]$/.test(k)) { const i = Number(k.slice(5)) - 1; if (i < puz.pieces.length) setSel(i); return }
    if (sel === null) return
    if (k === 'KeyE' || (k === 'KeyR' && !e.shiftKey)) { e.preventDefault(); reorient(sel, turnCW) }
    else if (k === 'KeyQ' || (k === 'KeyR' && e.shiftKey)) { e.preventDefault(); reorient(sel, turnCCW) }
    // 대칭: A 좌우 · D 상하 (Q·E 회전 바로 아래)
    else if (k === 'KeyA') { e.preventDefault(); reorient(sel, flipH) }
    else if (k === 'KeyD') { e.preventDefault(); reorient(sel, flipV) }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); setPuz((p) => ({ ...p, pieces: p.pieces.map((x) => (x.id === sel ? { ...x, at: null } : x)) })) }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const can = sel !== null && !locked
  /** 리본 회전 버튼 */
  const tool = (label: string, key: string, fn: (o: Orient) => Orient, icon: string) => (
    <button className="tb" disabled={!can} onClick={() => sel !== null && reorient(sel, fn)} title={`${label} (${key})`}><span className="ic">{ICONS[icon]}</span>{label}<kbd>{key}</kbd></button>
  )
  const rotateTools: ReactNode = <>{tool('오른쪽으로 90도', 'E', turnCW, 'cw')}{tool('왼쪽으로 90도', 'Q', turnCCW, 'ccw')}{tool('좌우 대칭', 'A', flipH, 'fh')}{tool('상하 대칭', 'D', flipV, 'fv')}</>

  if (!puz) return { cs, sel, setSel, dragging: false, rotateTools, board: null, tray: null, ghost: null }

  const hot = drag?.moved ? target(drag) : null
  const dragPc = drag?.moved ? puz.pieces[drag.id] : null
  const hotOk = !!(dragPc && hot && fits(puz, dragPc, dragPc.orient, hot))
  const handlers = (id: number) => ({
    onDown: onDown(id), onSpinDown: onSpinDown(id), onContext: (s: boolean) => { if (lockedRef.current) return; setSel(id); reorient(id, s ? turnCCW : turnCW) },
    onDouble: (s: boolean) => reorient(id, s ? flipV : flipH), onWheel: wheel(id),
  })

  const board = (
    <div className="sp-board" ref={boardRef} style={{ width: puz.w * cs, height: puz.h * cs }}>
      {puz.mask.map((m, i) => m && <i key={i} className="slot" style={{ left: (i % puz.w) * cs, top: Math.floor(i / puz.w) * cs, width: cs, height: cs }} />)}
      {hot && dragPc && shapeCells(dragPc.shape, dragPc.orient).map(([r, c]) => (
        <i key={`h${r},${c}`} className={'hot' + (hotOk ? ' ok' : ' no')} style={{ left: (c + hot[1]) * cs, top: (r + hot[0]) * cs, width: cs, height: cs }} />
      ))}
      {puz.pieces.map((pc) => pc.at && !(drag?.moved && drag.id === pc.id) && (
        <div key={pc.id} className="on-board" style={{ left: pc.at[1] * cs, top: pc.at[0] * cs }}>
          <Shape puz={puz} id={pc.id} orient={pc.orient} cs={cs} selected={sel === pc.id} spin={spin?.id === pc.id ? spin.deg : 0} {...handlers(pc.id)} />
        </div>
      ))}
    </div>
  )
  const tray = (
    <div className="pcs">
      {puz.pieces.map((pc) => {
        const big = Math.max(...Object.values(dims(shapeCells(pc.shape, pc.orient)))) * cs + 20
        const out = !pc.at && !(drag?.moved && drag.id === pc.id)
        return (
          <div key={pc.id} className="slot-box" style={{ width: big, height: big }}>
            <span className="no">{pc.id + 1}</span>
            {out
              ? <Shape puz={puz} id={pc.id} orient={pc.orient} cs={cs} selected={sel === pc.id} spin={spin?.id === pc.id ? spin.deg : 0} {...handlers(pc.id)} />
              : <Shape puz={puz} id={pc.id} orient={pc.orient} cs={cs} faded />}
          </div>
        )
      })}
    </div>
  )
  const ghost = drag?.moved && dragPc ? (
    <div className="sp-ghost" style={{ left: drag.x - drag.offX, top: drag.y - drag.offY }}>
      <Shape puz={puz} id={dragPc.id} orient={dragPc.orient} cs={cs} />
    </div>
  ) : null
  return { cs, sel, setSel, dragging: !!drag, rotateTools, board, tray, ghost }
}

export function HelpDialog({ onClose, extra }: { onClose: () => void; extra?: ReactNode }) {
  return (
    <div className="sp-dlg-wrap" onPointerDown={onClose}>
      <div className="sp-dlg" onPointerDown={(e) => e.stopPropagation()}>
        <div className="hd">조작법<button onClick={onClose}>✕</button></div>
        <table>
          <tbody>
            <tr><th>옮기기</th><td>도형을 끌어서 점선 영역에 놓기 (칸에 딱 붙어요) · 밖으로 끌면 빼기 · Delete</td></tr>
            <tr><th>시계방향 회전</th><td><kbd>E</kbd> 또는 <kbd>R</kbd> · 오른쪽 클릭 · 휠 아래 · ↻ 핸들 잡고 돌리기</td></tr>
            <tr><th>반시계 회전</th><td><kbd>Q</kbd> 또는 <kbd>Shift</kbd>+<kbd>R</kbd> · Shift+오른쪽 클릭 · 휠 위</td></tr>
            <tr><th>좌우 대칭</th><td><kbd>A</kbd> · 더블클릭</td></tr>
            <tr><th>상하 대칭</th><td><kbd>D</kbd> · Shift+더블클릭</td></tr>
            <tr><th>도형 고르기</th><td>클릭 · <kbd>1</kbd>~<kbd>5</kbd> · <kbd>Tab</kbd></td></tr>
            {extra}
          </tbody>
        </table>
      </div>
    </div>
  )
}
