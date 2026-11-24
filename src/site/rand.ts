/** 문자열 → 32비트 해시 */
export function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/** 시드 고정 난수 (같은 시드면 같은 결과) */
export function rng(seed: number) {
  let a = seed || 1
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const pickOne = <T,>(r: () => number, arr: readonly T[]) => arr[Math.floor(r() * arr.length)]

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function lsGet<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback } catch { return fallback }
}
export function lsSet(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* 무시 */ }
}

/** 이 브라우저 고유 값 (생일 안 넣은 사람의 운세 시드) */
export function deviceSeed() {
  let id = lsGet<string>('tbs.device', '')
  if (!id) { id = Math.random().toString(36).slice(2, 10); lsSet('tbs.device', id) }
  return id
}
