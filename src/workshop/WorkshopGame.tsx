import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ALL_OBJS, CHAT, END_LATE, END_SAFE, EP_TITLE, FILE_NAME, GATE_ENTER, HINTS, INTRO, LIMIT_MS, LOBBY_ENTER, LOCKER_OPEN, OUR_BUS, SAFE_OPEN, START_MIN, WRONG_BUS, WRONG_BUS_MS,
  SECTIONS, SH, SLIDES, STK_A, STK_B, STK_H, STK_W, SW, TIPS, stickerSvg, slideIndex,
  type Grad, type ObjDef, type SlideDef, type StoryPage,
} from './episode'
import {
  brightnessOf, clearState, loadHistory, saveHistory, clockText, compare, deriveFlags, freshState, gameMinute, hintCount, leftText, loadRival, loadState, openSections,
  resultUrl, saveState, type MergeOp, type ObjState, type WsState,
} from './state'
import { fmtHints, fmtSec } from '../escape/share'
import { loadNickname, saveNickname } from '../lib/nickname'
import { track } from '../lib/analytics'
import './workshop.css'

const FILLS: [string, string][] = [['auto', '자동'], ['', '채우기 없음'], ['#ffffff', '흰색'], ['#f2c94c', '노랑'], ['#e46a6a', '빨강'], ['#5b8fd6', '파랑'], ['#3a3f48', '검정']]
const GRADS: [Grad, string][] = [['none', '없음'], ['lr', '왼쪽 → 오른쪽'], ['rl', '오른쪽 → 왼쪽'], ['tb', '위 → 아래']]
const TRANS = [0, 25, 50, 75, 100]
const BRI = [-40, -20, 0, 20, 40]
const CON = [-20, 0, 20]
const ALIGN: [string, string][] = [['l', '왼쪽 맞춤'], ['c', '가운데 맞춤'], ['r', '오른쪽 맞춤'], ['t', '위쪽 맞춤'], ['m', '중간 맞춤'], ['b', '아래쪽 맞춤']]
const MERGES: [MergeOp, string, string][] = [['union', '통합', '하나로 합치기'], ['combine', '결합', '겹친 부분만 빼고 합치기'], ['fragment', '조각', '겹친 곳마다 조각내기'], ['intersect', '교차', '겹치는 부분만 남기기'], ['subtract', '빼기', '먼저 고른 도형에서 나머지 빼기']]
type DD = 'fill' | 'grad' | 'trans' | 'align' | 'rotate' | 'merge' | 'bright' | 'recolor' | 'crop' | null

interface Popup { pages: StoryPage[]; onDone?: () => void }
type Snap = Pick<WsState, 'objs' | 'merge'>

/* ───────── 개체 그리기 ───────── */
interface View { def: ObjDef; st: ObjState; svg?: string; hideOrig?: boolean }

/** 병합 결과를 반영한 슬라이드의 개체 목록 */
function viewObjs(slide: SlideDef, s: WsState): View[] {
  const out: View[] = []
  const stk = s.merge.stk
  slide.objs.forEach((def) => {
    const st = s.objs[def.id] ?? {}
    if (stk && (def.id === 'stkA' || def.id === 'stkB')) {
      if (def.id === 'stkB') return
      const a = stk.first === 'stkA' ? STK_A : STK_B, b = stk.first === 'stkA' ? STK_B : STK_A
      const cells = new Set<number>()
      if (stk.op === 'union') { a.forEach((k) => cells.add(k)); b.forEach((k) => cells.add(k)) }
      if (stk.op === 'intersect') a.forEach((k) => { if (b.has(k)) cells.add(k) })
      if (stk.op === 'subtract') a.forEach((k) => { if (!b.has(k)) cells.add(k) })
      if (stk.op === 'combine') { a.forEach((k) => { if (!b.has(k)) cells.add(k) }); b.forEach((k) => { if (!a.has(k)) cells.add(k) }) }
      const firstDef = ALL_OBJS[stk.first], fs = s.objs[stk.first] ?? {}
      out.push({ def: { ...def, id: 'stkM', name: '병합된 도형', x: firstDef.x + (fs.dx ?? 0), y: firstDef.y + (fs.dy ?? 0), fill: fs.fill ?? firstDef.fill, svg: stickerSvg(cells) }, st: s.objs.stkM ?? {} })
      return
    }
    out.push({ def, st })
  })
  return out
}

function ObjView({ v, z, uid, selected, onDown }: { v: View; z: number; uid: string; selected: boolean; onDown?: (e: React.PointerEvent, id: string) => void }) {
  const { def, st } = v
  const fillCol = st.fill === undefined ? def.fill : st.fill === '' ? 'transparent' : st.fill
  const grad = st.grad ?? def.grad ?? 'none'
  const gid = `g-${uid}-${def.id}`
  const fillVar = def.kind === 'shape' && grad !== 'none' && fillCol !== 'transparent' ? `url(#${gid})` : fillCol
  const vec = grad === 'lr' ? 'x1="0" y1="0" x2="1" y2="0"' : grad === 'rl' ? 'x1="1" y1="0" x2="0" y2="0"' : 'x1="0" y1="0" x2="0" y2="1"'
  const defs = def.kind === 'shape' && grad !== 'none'
    ? `<defs><linearGradient id="${gid}" ${vec}><stop offset="0" stop-color="${fillCol}" stop-opacity="1"/><stop offset=".5" stop-color="${fillCol}" stop-opacity=".97"/><stop offset=".72" stop-color="${fillCol}" stop-opacity="0"/></linearGradient></defs>`
    : ''
  const filters: string[] = []
  if (def.kind === 'picture') {
    const b = brightnessOf(def.id, st)
    if (b !== 1) filters.push(`brightness(${b})`)
    if (st.con) filters.push(`contrast(${1 + st.con / 100})`)
    if (st.recolor === 'gray') filters.push('grayscale(1)')
    if (st.recolor === 'sepia') filters.push('sepia(1)')
  }
  const [cx, cy, cw, ch] = cropBox(def, st)
  const fh = st.fh ?? def.fh ?? false, fv = st.fv ?? false, rot = st.rot ?? 0
  const tf = [rot ? `rotate(${rot}deg)` : '', fh || fv ? `scale(${fh ? -1 : 1}, ${fv ? -1 : 1})` : ''].filter(Boolean).join(' ')
  const style: React.CSSProperties = {
    left: def.x + (st.dx ?? 0) + cx, top: def.y + (st.dy ?? 0) + cy, width: cw, height: ch, zIndex: 1000 + z,
    opacity: 1 - (st.t ?? def.t ?? 0) / 100, ['--f' as string]: fillVar, transform: tf || undefined,
    clipPath: st.crop === 'circle' ? 'ellipse(50% 50%)' : st.crop === 'square' ? `inset(0 ${Math.max(0, (cw - ch) / 2)}px)` : undefined,
  }
  const svgMarkup = v.svg ?? def.svg
  const clipped = cw !== def.w || ch !== def.h
  return (
    <div className={'ws-obj' + (def.cctv ? ' box' : '') + (clipped ? ' crop' : '')} data-id={def.id} style={style} onPointerDown={onDown ? (e) => onDown(e, def.id) : undefined}>
      {def.cctv ? (
        <>
          <div className="scene" style={{ filter: filters.join(' ') || undefined }} dangerouslySetInnerHTML={{ __html: def.svg }} />
          {def.hud && <div className="hud" dangerouslySetInnerHTML={{ __html: def.hud.replace(/id="scan"/, `id="scan-${uid}"`).replace(/url\(#scan\)/, `url(#scan-${uid})`) }} />}
        </>
      ) : (
        <svg viewBox={`0 0 ${def.w} ${def.h}`} width={def.w} height={def.h} style={{ filter: filters.join(' ') || undefined, overflow: 'visible', position: clipped ? 'absolute' : undefined, left: -cx, top: -cy }}
          dangerouslySetInnerHTML={{ __html: defs + svgMarkup }} />
      )}
      {selected && <i className="ws-sel" />}
    </div>
  )
}

/** 잘린 그림이면 보이는 영역 (개체 기준 x, y, w, h) */
function cropBox(def: ObjDef, st: ObjState): [number, number, number, number] {
  return def.crop && st.crop !== 'orig' ? def.crop : [0, 0, def.w, def.h]
}

function SlideView({ slide, s, uid, sel, onObjDown }: { slide: SlideDef; s: WsState; uid: string; sel?: string[]; onObjDown?: (e: React.PointerEvent, id: string) => void }) {
  const views = viewObjs(slide, s)
  return (
    <div className="ws-slide-inner">
      <svg className="ws-bg" viewBox={`0 0 ${SW} ${SH}`} width={SW} height={SH} dangerouslySetInnerHTML={{ __html: slide.bg }} />
      {views.map((v, i) => (
        <ObjView key={v.def.id} v={v} uid={uid} z={s.objs[v.def.id]?.z ?? i + 1} selected={!!sel?.includes(v.def.id)} onDown={onObjDown} />
      ))}
    </div>
  )
}

/** 관광버스 옆모습 (길이 620) — 창문마다 팀원 얼굴 */
function coach(x: number, y: number, k: number, faces: boolean) {
  const hair = ['#3b2a20', '#1f1a17', '#6b4a2f', '#2b2b2b', '#4a3526', '#1f1a17', '#7a5a3a']
  let win = ''
  for (let i = 0; i < 7; i++) {
    const wx = 70 + i * 66
    win += `<rect x="${wx}" y="34" width="58" height="52" rx="6" fill="#bcd6ea"/><path d="M${wx} 34 h22 l-22 30z" fill="#fff" opacity=".5"/>`
    if (faces) {
      const me = i === 0
      win += `<circle cx="${wx + 29}" cy="${me ? 66 : 70}" r="13" fill="#f0c7a0"/><path d="M${wx + 16} ${me ? 62 : 66} q13 -18 26 0 v-6 q-13 -12 -26 0z" fill="${hair[i]}"/><path d="M${wx + 12} 86 q17 -14 34 0z" fill="${['#c43e1c', '#2f6f8f', '#3f8a4a', '#8a5fb0', '#e0a800', '#2f6f8f', '#c43e1c'][i]}"/>`
      if (me) win += `<path d="M${wx + 44} 70 l8 -22 l6 2 l-6 22z" fill="#f0c7a0"/><path d="M${wx + 40} 50 q3 -6 6 0 q-3 4 -6 0z" fill="#7fc4ef"/><text x="${wx + 29}" y="28" font-size="11" font-weight="800" fill="#c43e1c" text-anchor="middle">나</text>`
      else win += `<circle cx="${wx + 24}" cy="69" r="1.6" fill="#333"/><circle cx="${wx + 34}" cy="69" r="1.6" fill="#333"/><path d="M${wx + 24} 75 q5 4 10 0" stroke="#333" fill="none" stroke-width="1.4"/>`
    }
  }
  return `<g transform="translate(${x} ${y}) scale(${k})">
<rect x="20" y="146" width="600" height="14" rx="7" fill="rgba(0,0,0,.18)"/>
<path d="M20 30 q0 -22 22 -22 h520 q40 0 52 30 l18 60 v62 q0 14 -14 14 h-584 q-14 0 -14 -14z" fill="#f7f7f5" stroke="#9aa3ad" stroke-width="2"/>
<rect x="20" y="100" width="610" height="16" fill="#2f6f8f"/><rect x="20" y="118" width="610" height="5" fill="#c43e1c"/>
${win}
<path d="M548 26 h22 q18 2 26 22 l14 44 h-62z" fill="#3d4654"/><rect x="556" y="38" width="44" height="14" fill="#fff"/><text x="578" y="48" font-size="7" font-weight="800" fill="#c43e1c" text-anchor="middle">△△회사 워크숍</text>
<rect x="500" y="34" width="40" height="122" rx="3" fill="#e6e9ec" stroke="#9aa3ad"/><line x1="520" y1="38" x2="520" y2="152" stroke="#9aa3ad"/>
<text x="290" y="142" font-size="20" font-weight="900" fill="#2f6f8f" text-anchor="middle" letter-spacing="2">○○관광</text>
<rect x="612" y="128" width="16" height="10" rx="2" fill="#ffe28a"/>
${[110, 470].map((cx) => `<circle cx="${cx}" cy="162" r="26" fill="#222"/><circle cx="${cx}" cy="162" r="12" fill="#bbb"/><circle cx="${cx}" cy="162" r="4" fill="#666"/>`).join('')}
</g>`
}

function EndSlide({ late }: { late: boolean }) {
  const scenery = `<defs><linearGradient id="sky-end" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fc6ea"/><stop offset="1" stop-color="#e2f1fa"/></linearGradient></defs>
<rect width="880" height="495" fill="url(#sky-end)"/><circle cx="780" cy="70" r="34" fill="#fff4c2"/>
<path d="M0 250 l120 -90 l90 60 l110 -110 l140 120 l110 -70 l150 110 l160 -60 v120 h-880z" fill="#a9c7a0"/><path d="M0 280 l160 -60 l140 50 l170 -70 l170 80 l240 -40 v100 h-880z" fill="#8db585"/>
${[40, 110, 760, 830].map((tx) => `<rect x="${tx - 4}" y="250" width="8" height="40" fill="#7a5a3a"/><circle cx="${tx}" cy="240" r="26" fill="#3f8a4a"/>`).join('')}
<rect y="300" width="880" height="195" fill="#8e8e8e"/><rect y="300" width="880" height="12" fill="#b5b5b5"/>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="${20 + i * 115}" y="410" width="60" height="7" fill="#eee"/>`).join('')}`
  const safe = `${scenery}${coach(110, 140, 1.05, true)}
<g transform="translate(230 82) rotate(-10)" opacity=".92"><rect x="-130" y="-52" width="260" height="104" rx="14" fill="rgba(255,255,255,.5)" stroke="#d6312a" stroke-width="10"/><text x="0" y="30" font-size="84" font-weight="900" fill="#d6312a" text-anchor="middle" font-family="Arial Black,Arial">SAFE</text></g>`
  const lateSvg = `${scenery}${coach(560, 230, 0.48, false)}
<path d="M520 300 h-70 M530 318 h-110 M522 336 h-60" stroke="#ddd" stroke-width="5" stroke-linecap="round"/><circle cx="866" cy="300" r="10" fill="#ccc" opacity=".7"/><circle cx="878" cy="292" r="7" fill="#ccc" opacity=".5"/>
<g transform="translate(170 250)"><circle cx="0" cy="0" r="24" fill="#f0c7a0"/><path d="M-24 -6 q24 -30 48 0 v-8 q-24 -22 -48 0z" fill="#3b2a20"/><circle cx="-8" cy="2" r="2.2" fill="#333"/><circle cx="8" cy="2" r="2.2" fill="#333"/><ellipse cx="0" cy="13" rx="6" ry="4" fill="#7a3b2a"/><path d="M20 -16 q4 -8 8 0 q-4 6 -8 0z" fill="#7fc4ef"/>
<path d="M-26 26 q26 -12 52 0 l6 70 h-64z" fill="#2f6f8f"/><rect x="-22" y="96" width="14" height="44" fill="#3b4250"/><rect x="8" y="96" width="14" height="44" fill="#3b4250"/>
<path d="M26 34 l30 24" stroke="#f0c7a0" stroke-width="9" stroke-linecap="round"/><rect x="50" y="56" width="44" height="64" rx="7" fill="#b03a48"/><rect x="66" y="40" width="4" height="18" fill="#888"/><rect x="76" y="40" width="4" height="18" fill="#888"/><rect x="64" y="36" width="18" height="5" rx="2" fill="#666"/><circle cx="58" cy="122" r="5" fill="#222"/><circle cx="86" cy="122" r="5" fill="#222"/></g>
<g transform="translate(330 130) rotate(-12)" opacity=".92"><rect x="-120" y="-56" width="240" height="112" rx="14" fill="rgba(255,255,255,.5)" stroke="#d6312a" stroke-width="10"/><text x="0" y="32" font-size="84" font-weight="900" fill="#d6312a" text-anchor="middle">지각</text></g>`
  const cap = late ? '총무: "택시 타고 와… 택시비는 네가 내"' : '번호판 38라 1207, 맨 뒷자리에 무사히 탑승!'
  return (
    <div className="ws-slide-inner">
      <svg className="ws-bg" viewBox={`0 0 ${SW} ${SH}`} width={SW} height={SH} dangerouslySetInnerHTML={{ __html: (late ? lateSvg : safe) + `<rect y="440" width="880" height="55" fill="rgba(0,0,0,.55)"/><text x="440" y="474" font-size="20" fill="#fff" text-anchor="middle">${cap}</text>` }} />
    </div>
  )
}

/* ───────── 게임 ───────── */
export default function WorkshopGame() {
  const nav = useNavigate()
  const [s, setS] = useState<WsState>(() => loadState() ?? freshState())
  const up = useCallback((fn: (d: WsState) => void) => setS((p) => { const d = structuredClone(p); fn(d); return d }), [])
  const flags = useMemo(() => deriveFlags(s), [s])
  const opened = openSections(s)
  const slide: SlideDef | undefined = SLIDES[s.slide]
  const minute = gameMinute(s.activeMs)
  const late = s.activeMs >= LIMIT_MS

  /* 팝업 */
  const [popups, setPopups] = useState<Popup[]>([])
  const [page, setPage] = useState(0)
  const queue = useCallback((pages: StoryPage[], onDone?: () => void) => { if (pages.length) setPopups((q) => [...q, { pages, onDone }]); else onDone?.() }, [])
  const cur = popups[0]
  const [toast, setToast] = useState('')
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? '' : t)), 2600) }

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

  /* 단체방 새 메시지 알림 (휴대폰을 찾은 뒤) */
  const [msgToast, setMsgToast] = useState<{ at: number; text: string } | null>(null)
  const lastMin = useRef(minute)
  useEffect(() => {
    if (minute !== lastMin.current && s.opened.safe && !s.finished) {
      const m = CHAT.find((c) => c.at === minute)
      if (m) { setMsgToast({ at: m.at, text: `${m.from}: ${m.text}` }); window.setTimeout(() => setMsgToast((t) => (t?.at === m.at ? null : t)), 7000) }
    }
    lastMin.current = minute
  }, [minute, s.opened.safe, s.finished])

  /* 선택 */
  const [sel, setSel] = useState<string[]>([])
  const [dropdown, setDropdown] = useState<DD>(null)
  useEffect(() => { setSel([]); setDropdown(null) }, [s.slide])
  const selDefs = sel.map((id) => (id === 'stkM' ? { ...ALL_OBJS.stkA, id: 'stkM', name: '병합된 도형' } : ALL_OBJS[id])).filter(Boolean)
  const ctxTab = selDefs.length === 0 ? '' : selDefs.every((d) => d.kind === 'picture') ? '그림 서식' : '도형 서식'

  /* 실행 취소 */
  const history = useRef<Snap[]>(loadState() ? loadHistory<Snap>() : [])
  const act = (fn: (d: WsState) => void) => {
    history.current.push(structuredClone({ objs: s.objs, merge: s.merge }))
    if (history.current.length > 40) history.current.shift()
    saveHistory(history.current)
    up(fn)
  }
  const undo = () => {
    setDropdown(null)
    const snap = history.current.pop()
    saveHistory(history.current)
    if (!snap) return flash('되돌릴 작업이 없어요')
    setSel([])
    setS((p) => ({ ...p, ...snap }))
  }

  /* 잠금 */
  const [lockFor, setLockFor] = useState<string | null>(null)
  const goSlide = (i: number) => {
    const sl = SLIDES[i]
    if (!sl) return
    if (sl.section > opened) return flash(sl.section === 1 ? '카드키가 없어서 엘리베이터를 못 타요' : '캐리어부터 찾아야 해요')
    up((d) => { d.slide = i })
    const key = `sec${sl.section}`
    if (sl.section > 0 && !s.seenEnter[key]) {
      up((d) => { d.seenEnter[key] = true })
      queue(sl.section === 1 ? LOBBY_ENTER : GATE_ENTER)
    }
  }
  const tryLock = (lock: string, pw: string) => {
    const code = pw.replace(/\s/g, '')
    if (lock === 'safe' && code === '3827') {
      setLockFor(null)
      up((d) => { d.opened.safe = true; d.seenEnter.sec1 = true })
      queue(SAFE_OPEN, () => { up((d) => { d.slide = slideIndex('lobby') }); queue(LOBBY_ENTER) })
      return true
    }
    if (lock === 'locker:07' && code === '0145') {
      setLockFor(null)
      up((d) => { d.opened.locker = true; d.seenEnter.sec2 = true })
      queue(LOCKER_OPEN, () => { up((d) => { d.slide = slideIndex('gate') }); queue(GATE_ENTER) })
      return true
    }
    return false
  }
  const [boardFor, setBoardFor] = useState<number | null>(null)
  const board = (n: number) => {
    setBoardFor(null)
    if (n !== OUR_BUS) { up((d) => { d.activeMs += WRONG_BUS_MS; d.wrongBus = (d.wrongBus ?? 0) + 1 }); queue(WRONG_BUS); return }
    const isLate = s.activeMs >= LIMIT_MS
    track('escape_clear', { game_id: 'workshop', seconds: Math.round(s.activeMs / 1000), hints: hintCount(s), result: isLate ? 'late' : 'safe' })
    up((d) => { d.opened.done = true; d.finished = true; d.late = isLate; d.slide = SLIDES.length })
    queue(isLate ? END_LATE : END_SAFE, () => setShowClear(true))
  }

  /* 개체 클릭 */
  const onObjDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault() // 브라우저 기본 끌기·글자 선택 막기
    setDropdown(null)
    const multi = e.ctrlKey || e.metaKey || e.shiftKey
    if (multi && sel.includes(id)) {
      // 이미 고른 개체를 다시 Ctrl+클릭하면, 그 아래 겹쳐 있는 개체를 추가로 고른다 (겹친 도형 고르기)
      const under = document.elementsFromPoint(e.clientX, e.clientY)
        .map((el) => el.closest('.ws-slide .ws-obj')?.getAttribute('data-id'))
        .find((x): x is string => !!x && !sel.includes(x))
      setSel((p) => (under ? [...p, under] : p.filter((x) => x !== id)))
      return
    }
    setSel((p) => (multi ? [...p, id] : [id]))
    const def = ALL_OBJS[id]
    if (!multi && def?.movable) {
      // 딱 겹쳐 있는 스티커는 한 번 클릭으로 두 장 다 고른다 (끌면 위 장만 움직임)
      if (stacked()) setSel(['stkA', 'stkB'])
      startDrag(e, id); return
    }
    if (!multi && def?.lock?.startsWith('bus:')) { if (!s.finished) setBoardFor(Number(def.lock.slice(4))); return }
    if (!multi && def?.lock) {
      if (def.lock === 'safe' && s.opened.safe) return flash('금고는 이미 열었어요')
      if (def.lock.startsWith('locker') && s.opened.locker) return flash('캐리어는 이미 찾았어요')
      setLockFor(def.lock)
    } else if (!multi && def?.say) flash(def.say)
  }

  /* 스티커 끌어서 옮기기: 다른 스티커와 가까우면 딱 붙는다 */
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; snap: boolean } | null>(null)
  const pos = (id: string, st: WsState = s) => ({ x: ALL_OBJS[id].x + (st.objs[id]?.dx ?? 0), y: ALL_OBJS[id].y + (st.objs[id]?.dy ?? 0) })
  const stacked = () => { const a = pos('stkA'), b = pos('stkB'); return !s.merge.stk && a.x === b.x && a.y === b.y }
  const startDrag = (e: React.PointerEvent, id: string) => {
    const other = id === 'stkA' ? 'stkB' : 'stkA'
    const wasStacked = stacked()
    const k = scale
    const sx = e.clientX, sy = e.clientY
    const d0 = { dx: s.objs[id]?.dx ?? 0, dy: s.objs[id]?.dy ?? 0 }
    const o = pos(other), def = ALL_OBJS[id]
    const calc = (ev: PointerEvent) => {
      let dx = d0.dx + (ev.clientX - sx) / k, dy = d0.dy + (ev.clientY - sy) / k
      dx = Math.max(-def.x, Math.min(SW - def.w - def.x, dx)); dy = Math.max(-def.y, Math.min(SH - def.h - def.y, dy))
      // 겹친 상태에서 떼어낼 때는 조금 멀어질 때까지 다시 붙지 않는다
      const far = Math.hypot(ev.clientX - sx, ev.clientY - sy) / k > 30
      const snap = !s.merge.stk && (!wasStacked || far) && Math.abs(def.x + dx - o.x) < 12 && Math.abs(def.y + dy - o.y) < 12
      if (snap) { dx = o.x - def.x; dy = o.y - def.y }
      return { dx: Math.round(dx), dy: Math.round(dy), snap }
    }
    let moved = false
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return
      moved = true
      setTip(null)
      setDrag({ id, ...calc(ev) })
    }
    const upFn = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', upFn); window.removeEventListener('pointercancel', upFn)
      setDrag(null)
      if (!moved) return
      const r = calc(ev)
      act((d) => { d.objs[id] = d.objs[id] ?? {}; d.objs[id].dx = r.dx; d.objs[id].dy = r.dy; if (r.snap) d.objs[id].z = Math.max(...['stkA', 'stkB'].map((x) => d.objs[x]?.z ?? 0), 20) + 1 })
    }
    try { (e.target as Element).setPointerCapture?.(e.pointerId) } catch { /* 무시 */ }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', upFn); window.addEventListener('pointercancel', upFn)
  }
  const shown: WsState = drag ? { ...s, objs: { ...s.objs, [drag.id]: { ...s.objs[drag.id], dx: drag.dx, dy: drag.dy, z: 99 } } } : s

  /* 마우스를 올리면 설명 */
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)
  const onHover = (e: React.MouseEvent) => {
    if (drag || band) return
    const id = (e.target as HTMLElement).closest?.('.ws-obj')?.getAttribute('data-id')
    const text = id ? ALL_OBJS[id]?.tip ?? TIPS[id] ?? ALL_OBJS[id]?.name : null
    setTip(text ? { text, x: e.clientX, y: e.clientY } : null)
  }

  /* 드래그로 둘러싸서 고르기 (개체 위에서 시작해도 된다) */
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const slideEl = useRef<HTMLDivElement>(null)
  const startBand = (e: React.PointerEvent) => {
    if (e.button !== 0 || !slide) return
    const hit = (e.target as HTMLElement).closest?.('.ws-obj')?.getAttribute('data-id')
    if (hit && ALL_OBJS[hit]?.movable && !(e.ctrlKey || e.metaKey || e.shiftKey)) return // 스티커는 끌어서 옮긴다
    const el = slideEl.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const k = r.width / SW
    const toSlide = (cx: number, cy: number) => ({ x: (cx - r.left) / k, y: (cy - r.top) / k })
    const p0 = toSlide(e.clientX, e.clientY)
    let moved = false
    const move = (ev: PointerEvent) => {
      const p1 = toSlide(ev.clientX, ev.clientY)
      if (!moved && Math.hypot(p1.x - p0.x, p1.y - p0.y) < 6) return
      moved = true
      setBand({ x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y })
    }
    const upFn = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', upFn); window.removeEventListener('pointercancel', upFn)
      setBand(null)
      if (!moved) return
      const p1 = toSlide(ev.clientX, ev.clientY)
      const [ax, bx] = [Math.min(p0.x, p1.x), Math.max(p0.x, p1.x)], [ay, by] = [Math.min(p0.y, p1.y), Math.max(p0.y, p1.y)]
      const inside = viewObjs(slide, s).filter(({ def, st }) => {
        const x = def.x + (st.dx ?? 0), y = def.y + (st.dy ?? 0)
        return x >= ax && y >= ay && x + def.w <= bx && y + def.h <= by
      }).map((v) => v.def.id)
      setLockFor(null)
      setSel(inside)
    }
    try { (e.target as Element).setPointerCapture?.(e.pointerId) } catch { /* 무시 */ }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', upFn); window.addEventListener('pointercancel', upFn)
  }

  /* 서식 적용 */
  const targets = (kinds: ObjDef['kind'][]) => selDefs.filter((d) => kinds.includes(d.kind)).map((d) => d.id)
  const need = (ids: string[], what: string) => { if (!sel.length) { flash('먼저 개체를 클릭해서 선택하세요'); return false } if (!ids.length) { flash(`${what}을(를) 선택하세요`); return false } return true }
  const setProp = (ids: string[], fn: (o: ObjState, id: string) => void) => {
    setDropdown(null)
    act((d) => ids.forEach((id) => { d.objs[id] = d.objs[id] ?? {}; fn(d.objs[id], id) }))
  }
  const applyFill = (c: string) => { const ids = targets(['shape']); if (need(ids, '도형')) setProp(ids, (o) => { if (c === 'auto') delete o.fill; else o.fill = c }) }
  const applyGrad = (g: Grad) => { const ids = targets(['shape']); if (need(ids, '도형')) setProp(ids, (o) => { o.grad = g }) }
  const applyTrans = (t: number) => { if (need(sel, '개체')) setProp(sel, (o) => { o.t = t }) }
  const applyBright = (b: number, c: number) => { const ids = targets(['picture']); if (need(ids, '그림')) setProp(ids, (o) => { o.bri = b; o.con = c }) }
  const applyRecolor = (r: '' | 'gray' | 'sepia') => { const ids = targets(['picture']); if (need(ids, '그림')) setProp(ids, (o) => { o.recolor = r }) }
  const zOf = (id: string) => { const i = slide ? viewObjs(slide, s).findIndex((v) => v.def.id === id) : 0; return s.objs[id]?.z ?? i + 1 }
  const order = (front: boolean) => {
    if (!need(sel, '개체') || !slide) return
    const zs = viewObjs(slide, s).map((v) => zOf(v.def.id))
    const ext = front ? Math.max(...zs) : Math.min(...zs)
    setProp(sel, (o) => { o.z = front ? ext + 1 : ext - 1 })
  }
  const align = (k: string) => {
    if (!need(sel, '개체')) return
    setProp(sel, (o, id) => {
      const d = id === 'stkM' ? ALL_OBJS.stkA : ALL_OBJS[id]
      if (k === 'l') o.dx = -d.x; if (k === 'c') o.dx = (SW - d.w) / 2 - d.x; if (k === 'r') o.dx = SW - d.w - d.x
      if (k === 't') o.dy = -d.y; if (k === 'm') o.dy = (SH - d.h) / 2 - d.y; if (k === 'b') o.dy = SH - d.h - d.y
    })
  }
  const merge = (op: MergeOp) => {
    setDropdown(null)
    if (sel.length < 2) return flash('도형 두 개를 함께 선택하세요 — 드래그로 둘러싸거나 Ctrl+클릭')
    if (selDefs.some((d) => d.kind !== 'shape')) return flash('그림이나 텍스트가 섞여 있으면 병합할 수 없어요')
    const set = [...sel].sort().join(',')
    const group = set === 'stkA,stkB' ? 'stk' : null
    if (!group) return flash('선택한 도형은 서로 겹치지 않아서 병합해도 그대로예요')
    const a = pos('stkA'), b = pos('stkB')
    const overlap = Math.abs(a.x - b.x) < STK_W && Math.abs(a.y - b.y) < STK_H
    if (!overlap) return flash('두 스티커가 떨어져 있어서 병합해도 그대로예요. 먼저 겹쳐 보세요')
    if (a.x !== b.x || a.y !== b.y) return flash('살짝 어긋나 있어요. 스티커를 끌어서 딱 맞게 겹쳐 보세요')
    if (op === 'fragment') return flash('조각났지만 모양은 그대로예요')
    act((d) => { d.merge[group] = { op, first: sel[0] } })
    setSel(['stkM'])
  }
  const rotate = (k: string) => {
    if (!need(sel, '개체')) return
    setProp(sel, (o, id) => {
      const d0 = ALL_OBJS[id === 'stkM' ? 'stkA' : id]
      if (k === 'r90') o.rot = ((o.rot ?? 0) + 90) % 360
      if (k === 'l90') o.rot = ((o.rot ?? 0) + 270) % 360
      if (k === 'fh') o.fh = !(o.fh ?? d0.fh ?? false)
      if (k === 'fv') o.fv = !(o.fv ?? false)
    })
  }
  const cropMenu = (k: '' | 'orig' | 'square' | 'circle') => {
    const ids = targets(['picture'])
    if (!need(ids, '그림')) return
    if (k === 'orig' && !ids.some((id) => ALL_OBJS[id]?.crop)) flash('잘린 부분이 없는 그림이에요')
    setProp(ids, (o) => { o.crop = k })
  }
  const group = () => { setDropdown(null); if (sel.length < 2) return flash('개체를 두 개 이상 선택하세요 (Ctrl+클릭)'); flash('그룹으로 묶었어요') }

  /* 키보드 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo() }
      else if (e.key === 'Escape') { setSel([]); setDropdown(null) }
      else if (e.key === 'Tab' && slide && !cur) {
        // PPT처럼 Tab으로 개체를 차례로 고르기
        e.preventDefault()
        const ids = viewObjs(slide, s).map((v) => v.def.id)
        const i = sel.length ? ids.indexOf(sel[sel.length - 1]) : -1
        setSel([ids[(i + (e.shiftKey ? -1 : 1) + ids.length) % ids.length]])
      }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) { e.preventDefault(); flash('이 파일은 총무 거라 개체를 지울 수 없어요') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* 캔버스 크기 */
  const wrap = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.8)
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const fit = () => setScale(Math.max(0.3, Math.min((el.clientWidth - 40) / SW, (el.clientHeight - 30) / SH)))
    fit()
    const ro = new ResizeObserver(fit); ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* 힌트: 지금 보고 있는 슬라이드가 속한 방의 퍼즐 2개를 목록으로. 연 단계만 횟수에 들어감 */
  const [hint, setHint] = useState<{ sec: number; idx: number | null; level: number } | null>(null)
  const hintList = hint ? HINTS[hint.sec] : []
  const cur0 = hint && hint.idx !== null ? hintList[hint.idx] : undefined
  const seenLv = (sec: number, until: string) => { let n = 0; while (s.hintsSeen[`${sec}:${until}:${n}`]) n++; return n }
  useEffect(() => {
    if (!hint || !cur0 || flags[cur0.until]) return // 이미 푼 퍼즐 다시 보기는 안 셈
    const k = `${hint.sec}:${cur0.until}:${hint.level}`
    if (!s.hintsSeen[k]) up((d) => { d.hintsSeen[k] = true })
  }, [hint, cur0, flags, s.hintsSeen, up])
  const openHint = () => {
    setDropdown(null)
    if (s.finished) return queue([{ title: '힌트', icon: 'info', text: '이미 버스에 탔어요!' }])
    const sec = slide ? slide.section : opened
    const roomDone = [s.opened.safe, s.opened.locker, s.opened.done][sec]
    if (roomDone) return queue([{ title: '힌트', icon: 'info', text: `${SECTIONS[sec]} 구역은 다 풀었어요. 다음 구역으로 가세요.` }])
    setHint({ sec, idx: null, level: 0 })
  }

  /* 처음부터 / 결과 */
  const [confirmReset, setConfirmReset] = useState(false)
  const [showClear, setShowClear] = useState(false)
  const reset = () => {
    clearState(); history.current = []; setSel([]); setShowClear(false); setConfirmReset(false); setHint(null); setPopups([]); setPage(0)
    setS(freshState())
    queue(INTRO, () => up((d) => { d.introDone = true }))
  }
  const [nick, setNick] = useState(loadNickname)
  const rival = useMemo(() => loadRival(), [showClear])
  const mySec = Math.round(s.activeMs / 1000)
  const myHints = hintCount(s)
  const safe = s.finished && !s.late
  const copyShare = async () => {
    const n = nick.trim()
    if (!n) return flash('닉네임을 입력하세요')
    saveNickname(n)
    const url = resultUrl(n, mySec, myHints, safe)
    const text = `[${EP_TITLE}] ${n} 님 ${safe ? '세이프! 10시 버스 탑승 성공' : '지각… 버스를 놓쳤어요'} · 걸린 시간 ${fmtSec(mySec)} · ${fmtHints(myHints)}\n너도 해봐 → ${url}`
    track('share_result', { game_id: 'workshop' })
    try { await navigator.clipboard.writeText(text); flash('자랑 링크를 복사했어요. 메신저에 붙여넣으세요!') } catch { flash(url) }
  }

  const phone = !!s.opened.safe
  const chat = CHAT.filter((c) => c.at <= 21 || c.at <= minute)

  return (
    <div className="ws" onMouseDown={() => setDropdown(null)}>
      <div className="ws-title"><span className="ws-logo">P</span><span className="ws-tmid">{FILE_NAME}</span><button className="ws-exit" onClick={() => nav('/games')}>나가기</button></div>
      <div className="ws-tabs">
        {['파일', '홈', '삽입', '디자인', '전환', '애니메이션', '슬라이드 쇼', '검토', '보기'].map((t) => <span key={t} className={t === '홈' ? 'on' : ''}>{t}</span>)}
        {ctxTab && <span className="ctx">{ctxTab}</span>}
      </div>

      <div className="ws-ribbon" onMouseDown={(e) => e.stopPropagation()}>
        <div className="grp"><div className="row"><button onClick={undo} title="실행 취소 (Ctrl+Z)">↶ 실행 취소</button></div><b>실행 취소</b></div>
        <div className="grp">
          <div className="row">
            <Drop open={dropdown === 'fill'} label="도형 채우기 ▾" onToggle={() => setDropdown(dropdown === 'fill' ? null : 'fill')}>
              {FILLS.map(([c, n]) => <button key={n} onClick={() => applyFill(c)}><i className="sw" style={{ background: c === 'auto' ? 'linear-gradient(135deg,#fff 45%,#999 45% 55%,#fff 55%)' : c || 'repeating-linear-gradient(45deg,#fff 0 3px,#ddd 3px 6px)' }} />{n}</button>)}
            </Drop>
            <Drop open={dropdown === 'grad'} label="그라데이션 ▾" onToggle={() => setDropdown(dropdown === 'grad' ? null : 'grad')}>
              {GRADS.map(([g, n]) => <button key={g} onClick={() => applyGrad(g)}><i className="sw" style={{ background: g === 'none' ? '#fff' : `linear-gradient(${g === 'lr' ? '90deg' : g === 'rl' ? '270deg' : '180deg'}, #888, #fff)` }} />{n}</button>)}
            </Drop>
          </div><b>도형</b>
        </div>
        <div className="grp">
          <div className="row">
            <Drop open={dropdown === 'trans'} label="투명도 ▾" onToggle={() => setDropdown(dropdown === 'trans' ? null : 'trans')}>
              {TRANS.map((t) => <button key={t} onClick={() => applyTrans(t)}>{t}%</button>)}
            </Drop>
          </div><b>투명도</b>
        </div>
        <div className="grp">
          <div className="row">
            <button onClick={() => order(true)}>맨 앞으로</button><button onClick={() => order(false)}>맨 뒤로</button>
            <Drop open={dropdown === 'align'} label="맞춤 ▾" onToggle={() => setDropdown(dropdown === 'align' ? null : 'align')}>
              {ALIGN.map(([k, n]) => <button key={k} onClick={() => align(k)}>{n}</button>)}
            </Drop>
            <Drop open={dropdown === 'rotate'} label="회전 ▾" onToggle={() => setDropdown(dropdown === 'rotate' ? null : 'rotate')}>
              <button onClick={() => rotate('r90')}>⟳ 오른쪽으로 90도 회전</button><button onClick={() => rotate('l90')}>⟲ 왼쪽으로 90도 회전</button>
              <button onClick={() => rotate('fv')}>⇅ 상하 대칭</button><button onClick={() => rotate('fh')}>⇆ 좌우 대칭</button>
            </Drop>
            <button onClick={group}>그룹</button>
          </div><b>정렬</b>
        </div>
        <div className="grp">
          <div className="row">
            <Drop open={dropdown === 'merge'} label="도형 병합 ▾" onToggle={() => setDropdown(dropdown === 'merge' ? null : 'merge')}>
              {MERGES.map(([op, n, d]) => <button key={op} onClick={() => merge(op)}><MergeIcon op={op} /><span>{n}<small className="mdesc">{d}</small></span></button>)}
            </Drop>
          </div><b>도형 병합</b>
        </div>
        <div className="grp">
          <div className="row">
            <Drop open={dropdown === 'bright'} label="밝기/대비 ▾" wide onToggle={() => setDropdown(dropdown === 'bright' ? null : 'bright')}>
              <div className="ws-gal-t">밝기/대비 (가로: 밝기 · 세로: 대비)</div>
              <div className="ws-gal">
                {CON.map((c) => BRI.map((b) => {
                  const pic = selDefs.find((d) => d.kind === 'picture')
                  const st0 = pic ? s.objs[pic.id] ?? {} : {}
                  const on = pic && (st0.bri ?? 0) === b && (st0.con ?? 0) === c
                  const f = `brightness(${pic ? brightnessOf(pic.id, { bri: b, con: c }) : 1 + b / 100}) contrast(${1 + c / 100})`
                  const html = !pic ? '' : pic.cctv ? pic.svg : `<svg viewBox="0 0 ${pic.w} ${pic.h}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">${pic.svg}</svg>`
                  return (
                    <button key={`${b}:${c}`} className={on ? 'on' : ''} onClick={() => applyBright(b, c)}>
                      <span className={'pv' + (pic ? '' : ' blank')} style={{ filter: f }} dangerouslySetInnerHTML={{ __html: html }} />
                      <small>밝기 {b > 0 ? '+' : ''}{b}% · 대비 {c > 0 ? '+' : ''}{c}%</small>
                    </button>
                  )
                }))}
              </div>
            </Drop>
            <Drop open={dropdown === 'crop'} label="자르기 ▾" onToggle={() => setDropdown(dropdown === 'crop' ? null : 'crop')}>
              <button onClick={() => cropMenu('square')}>가로 세로 비율 1:1</button><button onClick={() => cropMenu('circle')}>도형에 맞춰 자르기 (타원)</button>
              <button onClick={() => cropMenu('')}>처음 자른 대로</button><button onClick={() => cropMenu('orig')}>↺ 자르기 원래대로</button>
            </Drop>
            <Drop open={dropdown === 'recolor'} label="다시 칠하기 ▾" onToggle={() => setDropdown(dropdown === 'recolor' ? null : 'recolor')}>
              <button onClick={() => applyRecolor('')}>색 없음</button><button onClick={() => applyRecolor('gray')}>회색조</button><button onClick={() => applyRecolor('sepia')}>세피아</button>
            </Drop>
          </div><b>그림</b>
        </div>
        <div className="grp end"><div className="row"><button onClick={openHint}>힌트</button><button onClick={() => setConfirmReset(true)}>처음부터 다시 하기</button></div><b>&nbsp;</b></div>
      </div>

      <div className="ws-main">
        <div className="ws-thumbs">
          {SECTIONS.map((name, si) => (
            <div key={name}>
              <div className="sec">▾ {si + 1}. {name}</div>
              {SLIDES.map((sl, i) => sl.section !== si ? null : (
                <div key={sl.id} className={'th' + (i === s.slide ? ' on' : '') + (si > opened ? ' lock' : '')} onClick={() => goSlide(i)}>
                  <i>{i + 1}</i>
                  <div className="s">{si <= opened && <div className="mini"><SlideView slide={sl} s={s} uid={`t${i}`} /></div>}</div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="ws-edit">
          <div className="ws-canvas" ref={wrap} onPointerDownCapture={startBand} onPointerDown={(e) => { e.preventDefault(); setSel([]); setDropdown(null) }}
            onDragStart={(e) => e.preventDefault()}>
            <div className="ws-slide" ref={slideEl} style={{ width: SW * scale, height: SH * scale }}
              onMouseMove={onHover} onMouseLeave={() => setTip(null)} onDragStart={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}>
              <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0', width: SW, height: SH }}>
                {slide ? <SlideView slide={slide} s={shown} uid="main" sel={sel} onObjDown={onObjDown} /> : <EndSlide late={s.late} />}
                {drag?.snap && (() => { const o = pos(drag.id === 'stkA' ? 'stkB' : 'stkA'); return <><i className="ws-guide v" style={{ left: o.x }} /><i className="ws-guide v" style={{ left: o.x + STK_W }} /><i className="ws-guide h" style={{ top: o.y }} /><i className="ws-guide h" style={{ top: o.y + STK_H }} /></> })()}
                {band && <i className="ws-band" style={{ left: Math.min(band.x0, band.x1), top: Math.min(band.y0, band.y1), width: Math.abs(band.x1 - band.x0), height: Math.abs(band.y1 - band.y0) }} />}
              </div>
            </div>
            {msgToast && <div className="ws-msg"><b>💬 하반기 워크숍 · {clockText((msgToast.at - START_MIN) * 60000)}</b><span>{msgToast.text}</span></div>}
          </div>
          <div className="ws-notes"><span className="lbl">슬라이드 노트</span>{slide?.notes ? slide.notes.split('\n').map((l, i) => <div key={i}>{l}</div>) : <span className="ph">클릭하여 노트 추가</span>}</div>
        </div>

        <div className="ws-pane">
          <h4>내 소지품</h4>
          <Item ico="📱" name="휴대폰" sub={phone ? `배터리 ${Math.max(1, 12 - Math.floor(s.activeMs / 150000))}%` : '어디 있지…?'} on={phone} />
          <Item ico="💳" name="카드키" sub={phone ? '1207호' : '어디 있지…?'} on={phone} />
          <Item ico="🧳" name="캐리어" sub={s.opened.locker ? '07번 보관함에서 찾음' : '어디 있지…?'} on={!!s.opened.locker} />
          {phone && (
            <div className="ws-chat">
              <div className="hd">💬 하반기 워크숍 (24)</div>
              <div className="msgs">
                {chat.map((c, i) => <div key={i} className="m"><b>{c.from}</b>{c.text}<span className="tm">{c.at >= 60 ? '10:00' : `9:${String(c.at).padStart(2, '0')}`}</span></div>)}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="ws-status">
        <span>{slide ? `슬라이드 ${s.slide + 1}/${SLIDES.length}` : '슬라이드 쇼'}</span>
        <span className="bus">🚌 {s.finished ? (s.late ? '지각' : '세이프') : late ? '버스 출발함' : `버스 출발까지 ${leftText(s.activeMs)}`} (현재 {clockText(s.activeMs)})</span>
        <span>힌트 사용 {myHints}회</span>
        <span className="r">노트　　{Math.round(scale * 100)}%</span>
      </div>

      {cur && (
        <Dialog title={cur.pages[page].title}>
          <div className="ws-story"><StoryIcon kind={cur.pages[page].icon} /><p>{cur.pages[page].text}</p></div>
          <div className="ws-btns">
            {cur.pages.length > 1 && <span className="pg">{page + 1} / {cur.pages.length}</span>}
            {page > 0 && <button onClick={() => setPage(page - 1)}>{'< 이전'}</button>}
            <button className="pri" autoFocus onClick={() => {
              if (page + 1 < cur.pages.length) setPage(page + 1)
              else { setPage(0); setPopups((q) => q.slice(1)); cur.onDone?.() }
            }}>{page + 1 < cur.pages.length ? '다음 >' : '확인'}</button>
          </div>
        </Dialog>
      )}
      {!cur && boardFor !== null && (
        <Dialog title="관광버스" onClose={() => setBoardFor(null)}>
          <div className="ws-story"><StoryIcon kind="info" /><p>{['맨 왼쪽', '가운데', '맨 오른쪽'][boardFor - 1]} 버스에 탈까요?{'\n'}다른 회사 버스면 내리느라 2분을 날려요!</p></div>
          <div className="ws-btns"><button className="pri" onClick={() => board(boardFor)}>탄다</button><button onClick={() => setBoardFor(null)}>취소</button></div>
        </Dialog>
      )}
      {!cur && lockFor && <LockDialog lock={lockFor} onCancel={() => setLockFor(null)} onSubmit={(pw) => tryLock(lockFor, pw)} />}
      {!cur && confirmReset && (
        <Dialog title={FILE_NAME} onClose={() => setConfirmReset(false)}>
          <div className="ws-story"><StoryIcon kind="warn" /><p>처음부터 다시 할까요?{'\n'}지금까지의 진행 상황과 시간, 힌트 기록이 모두 초기화돼요.</p></div>
          <div className="ws-btns"><button className="pri" onClick={reset}>처음부터</button><button onClick={() => setConfirmReset(false)}>취소</button></div>
        </Dialog>
      )}
      {!cur && hint && !cur0 && (
        <Dialog title={`힌트 · ${hint.sec + 1}. ${SECTIONS[hint.sec]}`} onClose={() => setHint(null)}>
          <div className="ws-hlist">
            <p>어떤 퍼즐의 힌트를 볼까요? <b>힌트를 열어서 처음 본 단계만</b> 힌트 사용 횟수에 들어가요. 이미 푼 퍼즐은 다시 봐도 안 세요.</p>
            {hintList.map((h, i) => {
              const solved = flags[h.until], seen = seenLv(hint.sec, h.until)
              return (
                <button key={h.until} className={'hl-item' + (solved ? ' solved' : '')} onClick={() => setHint({ ...hint, idx: i, level: solved ? h.steps.length - 1 : Math.max(0, seen - 1) })}>
                  <span className="nm">{h.label}<small>{h.sub} · {h.steps.length}단계{seen ? ` 중 ${seen}단계까지 봄` : ''}</small></span>
                  <span className={'tag' + (solved ? ' done' : h.slide === slide?.id ? ' here' : '')}>{solved ? '해결함' : h.slide === slide?.id ? '지금 슬라이드' : `${slideIndex(h.slide) + 1}번 슬라이드`}</span>
                </button>
              )
            })}
            <div className="cnt">지금까지 힌트 사용 {myHints}회</div>
          </div>
          <div className="ws-btns"><button className="pri" onClick={() => setHint(null)}>닫기</button></div>
        </Dialog>
      )}
      {!cur && hint && cur0 && (
        <Dialog title={`힌트 · ${cur0.label}`} onClose={() => setHint(null)}>
          <div className="ws-story"><StoryIcon kind="info" /><p>{cur0.steps[hint.level]}<span className="ws-hstep">{hint.level + 1} / {cur0.steps.length}단계</span></p></div>
          <div className="ws-btns">
            <button className="left" onClick={() => setHint({ ...hint, idx: null, level: 0 })}>‹ 퍼즐 목록</button>
            {hint.level > 0 && <button onClick={() => setHint({ ...hint, level: hint.level - 1 })}>{'< 이전'}</button>}
            {hint.level + 1 < cur0.steps.length && <button onClick={() => setHint({ ...hint, level: hint.level + 1 })}>더 자세히</button>}
            <button className="pri" onClick={() => setHint(null)}>확인</button>
          </div>
        </Dialog>
      )}
      {!cur && showClear && (
        <Dialog title="Microsoft PowerPoint" onClose={() => setShowClear(false)}>
          <div className="ws-clear">
            <p>{safe ? '버스 출발 전, 맨 뒷자리에 무사히 탑승!' : '버스는 이미 떠났다… 총무: "택시 타고 와… 택시비는 네가 내"'}</p>
            <div className="big">{safe ? '탈출 성공 · 세이프' : '탈출 실패 · 지각'}</div>
            <div className="stats">
              <div>걸린 시간<b>{fmtSec(mySec)}</b></div>
              <div>힌트<b>{myHints ? `${myHints}번 사용` : '사용 안 함'}</b></div>
              <div>결과<b className="res">{safe ? '세이프' : '지각'}</b></div>
            </div>
            {rival && (() => {
              const c = compare({ t: mySec, safe }, rival)
              return (
                <p className="vs">
                  {rival.n} 님 {rival.safe ? '세이프' : '지각'} {fmtSec(rival.t)}{rival.h !== undefined ? ` (${fmtHints(rival.h)})` : ''} vs 나 {safe ? '세이프' : '지각'} {fmtSec(mySec)}<br />
                  <b>{c > 0 ? '내가 이겼어요! 🎉' : c < 0 ? `${rival.n} 님이 이겼어요 ㅠ` : '똑같아요!'}</b>
                </p>
              )
            })()}
            <label className="nick">닉네임<input value={nick} maxLength={10} onChange={(e) => setNick(e.target.value)} placeholder="자랑할 이름 (최대 10자)" /></label>
          </div>
          <div className="ws-btns">
            <button onClick={() => nav('/games')}>게임 목록</button><button onClick={reset}>처음부터 다시 하기</button>
            <button className="pri" onClick={copyShare}>자랑 링크 복사</button>
          </div>
        </Dialog>
      )}
      {toast && <div className="ws-toast">{toast}</div>}
      {tip && !cur && <div className="ws-tip" style={{ left: tip.x + 14, top: tip.y + 18 }}>{tip.text}</div>}
    </div>
  )
}

function Drop({ open, label, wide, onToggle, children }: { open: boolean; label: string; wide?: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <span className="ws-drop">
      <button className={open ? 'on' : ''} onClick={onToggle}>{label}</button>
      {open && <div className={'dd' + (wide ? ' wide' : '')}>{children}</div>}
    </span>
  )
}

function MergeIcon({ op }: { op: MergeOp }) {
  const a = 'M2 3h9v9H2z', b = 'M6 6h9v9H6z'
  const inner: Record<MergeOp, string> = {
    union: `<path d="${a}" fill="#c43e1c"/><path d="${b}" fill="#c43e1c"/>`,
    combine: `<path d="${a}" fill="#c43e1c"/><path d="${b}" fill="#c43e1c"/><path d="M6 6h5v6H6z" fill="#fff"/>`,
    fragment: `<path d="${a}" fill="#e7a08f" stroke="#c43e1c"/><path d="${b}" fill="#e7a08f" stroke="#c43e1c"/>`,
    intersect: `<path d="${a}" fill="none" stroke="#bbb"/><path d="${b}" fill="none" stroke="#bbb"/><path d="M6 6h5v6H6z" fill="#c43e1c"/>`,
    subtract: `<path d="${a}" fill="#c43e1c"/><path d="M6 6h5v6H6z" fill="#fff"/><path d="${b}" fill="none" stroke="#bbb"/>`,
  }
  return <svg className="mi" width="17" height="17" viewBox="0 0 17 17" dangerouslySetInnerHTML={{ __html: inner[op] }} />
}

function Item({ ico, name, sub, on }: { ico: string; name: string; sub: string; on: boolean }) {
  return <div className={'ws-item' + (on ? '' : ' off')}><span className="ico">{ico}</span><div>{name}<small>{sub}</small></div></div>
}

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="ws-dim" onMouseDown={(e) => e.stopPropagation()}>
      <div className="ws-dlg" role="dialog" aria-label={title}>
        <div className="ws-dt"><span>{title}</span>{onClose && <button className="x" onClick={onClose}>✕</button>}</div>
        {children}
      </div>
    </div>
  )
}

function LockDialog({ lock, onCancel, onSubmit }: { lock: string; onCancel: () => void; onSubmit: (pw: string) => boolean }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)
  const title = lock === 'safe' ? '객실 금고' : `${lock.split(':')[1]}번 짐 보관함`
  return (
    <Dialog title={title} onClose={onCancel}>
      <form onSubmit={(e) => { e.preventDefault(); if (!onSubmit(pw)) { setErr(true); setPw('') } }}>
        <div className="ws-body">
          <p>비밀번호 4자리를 입력하세요.</p>
          <input className="pw" autoFocus inputMode="numeric" maxLength={4} value={pw} onChange={(e) => { setPw(e.target.value.replace(/\D/g, '')); setErr(false) }} />
          {err && <p className="err">삐빅- 비밀번호가 틀렸어요.</p>}
        </div>
        <div className="ws-btns"><button className="pri" type="submit" disabled={pw.length !== 4}>확인</button><button type="button" onClick={onCancel}>취소</button></div>
      </form>
    </Dialog>
  )
}

function StoryIcon({ kind }: { kind: StoryPage['icon'] }) {
  const map = { warn: ['!', '#f2b400'], info: ['i', '#2b6cb0'], error: ['✕', '#c42b1c'], ok: ['✓', '#217346'] } as const
  const [ch, bg] = map[kind]
  return <span className="ws-ic" style={{ background: bg }}>{ch}</span>
}

