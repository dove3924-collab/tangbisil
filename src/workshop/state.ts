import { ALL_OBJS, CCTV_LV, LIMIT_MS, START_MIN, type Grad } from './episode'

/** 개체마다 바꾼 서식 */
export interface ObjState {
  t?: number // 투명도 0~100
  z?: number // 쌓는 순서 (맨 뒤로 = 음수)
  fill?: string // '' = 채우기 없음
  grad?: Grad
  bri?: number // 밝기 -40~40
  con?: number // 대비 -20~20
  recolor?: '' | 'gray' | 'sepia'
  dx?: number; dy?: number // 맞춤으로 옮긴 거리
  rot?: number // 회전 (0/90/180/270)
  fh?: boolean; fv?: boolean // 좌우·상하 대칭
  crop?: '' | 'orig' | 'square' | 'circle' // 자르기 상태
}
export type MergeOp = 'union' | 'combine' | 'fragment' | 'intersect' | 'subtract'
export interface WsState {
  v: 2 // 스티커 배치가 바뀌어 예전(v1) 저장분은 새로 시작
  slide: number
  objs: Record<string, ObjState>
  merge: Record<string, { op: MergeOp; first: string }> // 'stk'
  opened: Record<string, boolean> // safe, locker, done
  introDone: boolean
  finished: boolean
  late: boolean
  activeMs: number
  hintsSeen: Record<string, true>
  seenEnter: Record<string, true>
  wrongBus?: number // 다른 버스에 탄 횟수
}
const KEY = 'wollu.workshop.ep1'

export const freshState = (): WsState => ({
  v: 2, slide: 1, objs: {}, merge: {}, opened: {}, introDone: false, finished: false, late: false, activeMs: 0, hintsSeen: {}, seenEnter: {},
})
export function loadState(): WsState | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return s && s.v === 2 ? s : null
  } catch { return null }
}
export function saveState(s: WsState) { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* 무시 */ } }
export function clearState() { try { localStorage.removeItem(KEY); localStorage.removeItem(HIST_KEY) } catch { /* 무시 */ } }

/** 실행 취소 기록도 저장해서 새로고침 뒤에도 되돌릴 수 있게 */
const HIST_KEY = 'wollu.workshop.ep1.undo'
export function loadHistory<T>(): T[] { try { const h = JSON.parse(localStorage.getItem(HIST_KEY) ?? '[]'); return Array.isArray(h) ? h : [] } catch { return [] } }
export function saveHistory<T>(h: T[]) { try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(-40))) } catch { /* 무시 */ } }

export const hintCount = (s: WsState) => Object.keys(s.hintsSeen).length
export const gameMinute = (ms: number) => START_MIN + Math.floor(ms / 60000) // 9시 몇 분 (60 = 10:00)
export const clockText = (ms: number) => { const m = gameMinute(ms); return `${m >= 60 ? 10 : 9}:${String(m % 60).padStart(2, '0')}` }
export const leftText = (ms: number) => { const left = Math.max(0, Math.ceil((LIMIT_MS - ms) / 1000)); return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` }

/** 투명도 50% 이상이거나 채우기 없음이거나 뒤로 숨었으면 "가린 게 치워짐" */
const cleared = (o: ObjState | undefined) => !!o && ((o.t ?? 0) >= 50 || o.fill === '' || (o.z ?? 1) <= 0)

/** 회전·대칭을 합쳐서 원래 방향으로 보이는지 (fh0 = 처음부터 좌우 대칭) */
export function readable(o: ObjState | undefined, fh0 = false) {
  const fh = o?.fh ?? fh0, fv = o?.fv ?? false, rot = ((o?.rot ?? 0) % 360 + 360) % 360
  return fh === fv && (rot + (fh ? 180 : 0)) % 360 === 0
}

export function cctvBright(o?: ObjState) {
  const b = o?.bri ?? 0, c = o?.con ?? 0
  return b >= 40 || (b >= 20 && c >= 20)
}

export function deriveFlags(s: WsState): Record<string, boolean> {
  const stk = s.merge.stk
  return {
    quiz: cleared(s.objs.cover),
    sticker: stk?.op === 'intersect' || cleared(s.objs.stkA),
    safe: !!s.opened.safe,
    cctv: cctvBright(s.objs.cctv),
    clock: cleared(s.objs.plant) || (s.objs.plant?.dx ?? 0) !== 0 || (s.objs.plant?.dy ?? 0) !== 0,
    locker: !!s.opened.locker,
    photo: s.objs.photo?.crop === 'orig',
    mirror: ['pane1', 'pane2', 'pane3'].some((id) => readable(s.objs[id], true) && (s.objs[id]?.t ?? 85) <= 40),
    done: !!s.opened.done,
  }
}

/** 열린 구역 수 (0: 숙소만, 1: 로비까지, 2: 정문까지) */
export const openSections = (s: WsState) => (s.opened.locker ? 2 : s.opened.safe ? 1 : 0)

/** CCTV 실제 밝기 (그 외 그림은 일반 밝기) */
export function brightnessOf(id: string, o?: ObjState) {
  const b = o?.bri ?? 0, c = o?.con ?? 0
  if (ALL_OBJS[id]?.cctv) return Math.max(0.02, CCTV_LV[b] * (1 + (c / 100) * 1.5))
  return 1 + b / 100
}

export const isLate = (ms: number) => ms >= LIMIT_MS

/* 기록 공유: /workshop/result?n=닉네임&t=초&h=힌트&s=1(세이프)|0(지각) */
export interface Rival { n: string; t: number; h?: number; safe: boolean }
const RIVAL_KEY = 'wollu.workshop.rival'
export function parseResult(search: string): Rival | null {
  const q = new URLSearchParams(search)
  const n = (q.get('n') ?? '').trim().slice(0, 10)
  const t = Number(q.get('t'))
  if (!n || !Number.isInteger(t) || t < 1 || t > 86400) return null
  const h = Number(q.get('h'))
  return { n, t, h: q.has('h') && Number.isInteger(h) && h >= 0 && h < 100 ? h : undefined, safe: q.get('s') === '1' }
}
export const resultUrl = (n: string, sec: number, hints: number, safe: boolean) =>
  `${location.origin}/workshop/result?n=${encodeURIComponent(n.trim().slice(0, 10))}&t=${Math.round(sec)}&h=${hints}&s=${safe ? 1 : 0}`
export function saveRival(r: Rival) { try { localStorage.setItem(RIVAL_KEY, JSON.stringify(r)) } catch { /* 무시 */ } }
export function loadRival(): Rival | null {
  try { const r = JSON.parse(localStorage.getItem(RIVAL_KEY) ?? 'null'); return r && r.n && r.t ? r : null } catch { return null }
}
/** 세이프가 먼저, 같으면 시간이 짧은 쪽이 이김. 1 = 내가 이김 */
export function compare(me: { t: number; safe: boolean }, r: Rival) {
  if (me.safe !== r.safe) return me.safe ? 1 : -1
  return me.t < r.t ? 1 : me.t > r.t ? -1 : 0
}
