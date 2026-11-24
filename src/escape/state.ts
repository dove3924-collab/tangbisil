import type { CellDef, CellIn, Flags } from './types'

export interface EscState {
  v: 2
  room: number // 0~2, 3 = 숨긴 시트
  unlocked: number
  giftShown: boolean
  zoom: Record<number, number>
  fills: Record<string, string> // room:x:y
  fmts: Record<string, string> // room:table:row:col
  unhidden: Record<string, boolean> // room:y
  sorts: Record<string, { col: number; dir: 1 | -1 }>
  cf: Record<string, string> // 표 id → 조건부 서식 규칙 (scale | bar | icon | top10 | gt:n | lt:n)
  fonts: Record<string, string> // room:x:y → 글꼴 색
  autofit: Record<string, boolean>
  widen: Record<string, number> // 표 id → 좁은 열을 드래그로 넓힌 칸 수
  opened: Record<string, boolean>
  seenEnter: Record<number, boolean>
  introDone: boolean
  finished: boolean
  activeMs: number
  hintsSeen: Record<string, boolean> // 본 힌트 (방:단계:자세히)
}

export const freshState = (): EscState => ({
  v: 2, room: 0, unlocked: 1, giftShown: false, zoom: {},
  fills: {}, fmts: {}, unhidden: {}, sorts: {}, cf: {}, fonts: {}, autofit: {}, widen: {}, opened: {},
  seenEnter: { 0: true }, introDone: false, finished: false, activeMs: 0, hintsSeen: {},
})

const KEY = 'wollu.escape.ep1'
export function loadState(): EscState | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (!s || s.v !== 2) return null
    s.hintsSeen ??= {}
    s.fonts ??= {}
    s.widen ??= {}
    for (const k of Object.keys(s.cf ?? {})) if (typeof s.cf[k] !== 'string') s.cf[k] = 'scale' // 예전 저장분
    return s
  } catch { return null }
}
export function saveState(s: EscState) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* 저장 불가 환경 */ }
}
export function clearState() {
  try { localStorage.removeItem(KEY) } catch { /* 무시 */ }
}

export const asCell = (c: CellIn): CellDef => (c === null ? {} : typeof c === 'object' ? c : { v: c })

const DARK = new Set(['#000000', '#595959', '#808080', '#1f4e79', '#217346', '#c00000'])
export const isDark = (fill?: string) => !!fill && DARK.has(fill)

export function deriveFlags(s: EscState): Flags {
  const sort = s.sorts.roster
  return {
    r1_rows: !!s.unhidden['0:9'],
    r1_date: s.fmts['0:birth:3:1'] === 'date',
    r1_locker: !!s.opened.locker,
    r1_white: [27, 28, 29].some((y) => isDark(s.fills[`0:96:${y}`]) || (!!s.fonts[`0:96:${y}`] && s.fonts[`0:96:${y}`] !== '#ffffff')),
    room2: s.unlocked >= 2,
    r2_login: !!s.opened.login,
    r2_autofit: !!s.autofit.clip,
    r2_release: !!s.opened.release,
    room3: s.unlocked >= 3,
    r3_sort: !!sort && sort.col === 0 && sort.dir === 1,
    r3_cf: cfSolvesTiles(s.cf.tiles), // 바닥 타일 숫자가 드러나는 서식
    r3_gate: !!s.opened.gate,
  }
}

/** 바닥 타일(작은 수 10~30, 큰 수 70~99)에서 숫자가 드러나는 규칙인지. 엑셀을 아는 사람의 다른 정답도 인정 */
export function cfSolvesTiles(rule?: string) {
  if (!rule) return false
  if (rule === 'scale') return true
  const m = rule.match(/^(gt|lt):(-?\d+(?:\.\d+)?)$/)
  if (!m) return false
  const n = Number(m[2])
  return m[1] === 'gt' ? n >= 30 && n < 70 : n > 30 && n <= 70
}

/** 표시 형식 */
export function formatNumber(n: number, f: string) {
  switch (f) {
    case 'number': return n.toLocaleString('ko-KR')
    case 'currency': return '₩' + n.toLocaleString('ko-KR')
    case 'percent': return (n * 100).toLocaleString('ko-KR') + '%'
    case 'date': return serialToDate(n)
    case 'time': { const t = Math.round((((n % 1) + 1) % 1) * 86400); return `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` }
    default: return String(n)
  }
}

export function serialToDate(n: number) {
  return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10)
}

export const hintCount = (s: EscState) => Object.keys(s.hintsSeen ?? {}).length

export const fmtTime = (ms: number) => {
  const t = Math.floor(ms / 1000)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

export const colName = (c: number) => {
  let s = ''
  c += 1
  while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26) }
  return s
}
