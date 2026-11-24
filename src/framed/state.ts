import { CHARGES, EVENTS, PROOFS, LIMIT_MS, START_MIN, type EvId, type Grade } from './data'

export interface EvState { shown?: boolean; at?: number; replied?: number; timedOut?: boolean }
export interface FrState {
  v: 1
  introDone: boolean
  finished: boolean
  grade?: Grade
  ms: number // 게임 시작 뒤 흐른 시간 (순찰 손해 포함)
  login: boolean
  pinFails: number
  pinLockUntil?: number // ms 기준
  ev: EvId[] // 저장한 증거 (순서대로)
  zipOpen: boolean
  unhid: boolean // 발급대장 14행 숨기기 취소
  drawer: boolean
  lamp: boolean
  phoneTaken: boolean // (예전) 서랍에서 휴대폰을 꺼냄
  printOk?: boolean // 프린터 보안 인쇄 문서 열림
  phone: boolean // 휴대폰 잠금 해제
  patFails: number
  patLockUntil?: number
  code?: string // 예약 메일 취소 인증번호
  cancelled: boolean
  sus: number // 의심
  patrol: boolean
  events: Record<string, EvState>
  readMail: Record<string, true>
  readChat: Record<string, number> // 대화방별 읽은 메시지 수
  slots: Record<number, EvId | undefined>
  culprit?: string
  hintsSeen: Record<string, true>
  sentAt?: number
}
const KEY = 'wollu.framed.ep1'

export const freshState = (): FrState => ({
  v: 1, introDone: false, finished: false, ms: 0, login: false, pinFails: 0, ev: [], zipOpen: false, unhid: false, drawer: false, lamp: false,
  phoneTaken: false, phone: false, patFails: 0, cancelled: false, sus: 0, patrol: false, events: {}, readMail: {}, readChat: {}, slots: {}, hintsSeen: {},
})
export function loadState(): FrState | null {
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return s && s.v === 1 ? { ...freshState(), ...s } : null } catch { return null }
}
export function saveState(s: FrState) { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* 무시 */ } }
export function clearState() { try { localStorage.removeItem(KEY) } catch { /* 무시 */ } }

export const hintCount = (s: FrState) => Object.keys(s.hintsSeen).length
export const timeUp = (s: FrState) => s.ms >= LIMIT_MS

/** 02:37 형식 (새벽) */
export function clock(ms: number, sec = false) {
  const t = START_MIN * 60 + Math.floor(Math.min(ms, LIMIT_MS) / 1000)
  const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}${sec ? ':' + String(s).padStart(2, '0') : ''}`
}
export function leftText(ms: number) {
  const left = Math.max(0, Math.ceil((LIMIT_MS - ms) / 1000))
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
}

/** 반박에 성공한 사유 수 */
export const rebutted = (s: FrState) => CHARGES.filter((c) => { const e = s.slots[c.n]; return !!e && c.ok.includes(e) }).length
/** 진범 근거 칸에 맞는 증거를 붙인 수 */
export const proved = (s: FrState) => PROOFS.filter((c) => { const e = s.slots[c.n]; return !!e && c.ok.includes(e) }).length

export function gradeOf(s: FrState, sent: boolean): Grade {
  if (!sent) return s.cancelled ? 'D' : 'F'
  if (s.culprit !== 'park') return 'C'
  const r = rebutted(s), p = proved(s)
  if (r === CHARGES.length && p === PROOFS.length && s.cancelled) return 'S'
  if (r >= 4 && p >= 1) return 'A'
  return 'B'
}
export const GRADE_RANK: Record<Grade, number> = { S: 6, A: 5, B: 4, C: 3, D: 2, F: 1 }

/** 아직 안 나온 메신저 이벤트 중 지금 띄울 것 */
export const dueEvent = (s: FrState) => EVENTS.find((e) => !s.events[e.id]?.shown && s.ms >= e.at)

/* 기록 공유: /framed/result?n=닉네임&t=초&h=힌트&g=등급&e=증거 수 */
export interface Rival { n: string; t: number; h?: number; g: Grade; e: number }
const RIVAL_KEY = 'wollu.framed.rival'
const GRADES: Grade[] = ['S', 'A', 'B', 'C', 'D', 'F']
export function parseResult(search: string): Rival | null {
  const q = new URLSearchParams(search)
  const n = (q.get('n') ?? '').trim().slice(0, 10)
  const t = Number(q.get('t'))
  const g = q.get('g') as Grade
  if (!n || !Number.isInteger(t) || t < 1 || t > 86400 || !GRADES.includes(g)) return null
  const h = Number(q.get('h')), e = Number(q.get('e'))
  return { n, t, g, h: q.has('h') && Number.isInteger(h) && h >= 0 && h < 100 ? h : undefined, e: Number.isInteger(e) && e >= 0 && e <= 7 ? e : 0 }
}
export const resultUrl = (n: string, sec: number, hints: number, g: Grade, e: number) =>
  `${location.origin}/framed/result?n=${encodeURIComponent(n.trim().slice(0, 10))}&t=${Math.round(sec)}&h=${hints}&g=${g}&e=${e}`
export function saveRival(r: Rival) { try { localStorage.setItem(RIVAL_KEY, JSON.stringify(r)) } catch { /* 무시 */ } }
export function loadRival(): Rival | null {
  try { const r = JSON.parse(localStorage.getItem(RIVAL_KEY) ?? 'null'); return r && r.n && r.g ? r : null } catch { return null }
}
/** 등급이 먼저, 같으면 시간이 짧은 쪽. 1 = 내가 이김 */
export function compare(me: { t: number; g: Grade }, r: Rival) {
  if (me.g !== r.g) return GRADE_RANK[me.g] > GRADE_RANK[r.g] ? 1 : -1
  return me.t < r.t ? 1 : me.t > r.t ? -1 : 0
}
