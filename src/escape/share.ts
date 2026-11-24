/** 기록 공유 링크: /escape/result?n=닉네임&t=초&h=힌트 사용 횟수 */

export interface Rival { n: string; t: number; h?: number }
const RIVAL_KEY = 'wollu.escape.rival'

export function parseResult(search: string): Rival | null {
  const q = new URLSearchParams(search)
  const n = (q.get('n') ?? '').trim().slice(0, 10)
  const t = Number(q.get('t'))
  if (!n || !Number.isInteger(t) || t < 1 || t > 86400) return null
  const h = Number(q.get('h'))
  return { n, t, h: q.has('h') && Number.isInteger(h) && h >= 0 && h < 100 ? h : undefined }
}

export function resultUrl(n: string, sec: number, hints: number) {
  return `${location.origin}/escape/result?n=${encodeURIComponent(n.trim().slice(0, 10))}&t=${Math.round(sec)}&h=${hints}`
}

export function saveRival(r: Rival) {
  try { localStorage.setItem(RIVAL_KEY, JSON.stringify(r)) } catch { /* 무시 */ }
}
export function loadRival(): Rival | null {
  try { const r = JSON.parse(localStorage.getItem(RIVAL_KEY) ?? 'null'); return r && r.n && r.t ? r : null } catch { return null }
}

export const fmtHints = (h?: number) => (h === undefined ? '' : h === 0 ? '힌트 사용 안 함' : `힌트 ${h}번 사용`)

export const fmtSec = (sec: number) => `${Math.floor(sec / 60)}분 ${String(sec % 60).padStart(2, '0')}초`
