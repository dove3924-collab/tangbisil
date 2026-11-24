const KEY = 'wollu.nickname'

export function loadNickname(): string {
  try { return localStorage.getItem(KEY) ?? '' } catch { return '' }
}
export function saveNickname(n: string) {
  try { localStorage.setItem(KEY, n) } catch { /* 저장 불가 환경 무시 */ }
}
