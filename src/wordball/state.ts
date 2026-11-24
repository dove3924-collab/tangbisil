import { REGULAR } from './logic'

/** 브라우저에 저장 (로그인 없음). 실패가 없어서 '플레이 = 성공' */
export interface Stats {
  played: number // 맞힌 판 수
  regular: number // 정규 9회 안에 맞힌 판
  extra: number // 연장전까지 간 판
  sum: number // 시도 횟수 합 (평균 이닝용)
  hist: Record<string, number> // 시도 횟수별 판 수
  streak: number // 오늘의 단어: 연속으로 맞힌 날 / 무한 모드: 연속 정규 이닝 승리
  best: number
  lastDay?: number // 오늘의 단어: 마지막으로 맞힌 날 번호
}
export interface Board { answer: string; guesses: string[]; done: boolean; won: boolean }
export interface WbSave {
  v: 2
  daily: (Board & { day: number }) | null
  infinite: Board | null
  stats: { daily: Stats; infinite: Stats }
}

const KEY = 'wollu.wordball'
const emptyStats = (): Stats => ({ played: 0, regular: 0, extra: 0, sum: 0, hist: {}, streak: 0, best: 0 })
export const freshSave = (): WbSave => ({ v: 2, daily: null, infinite: null, stats: { daily: emptyStats(), infinite: emptyStats() } })

/** v1(6번 제한) 저장분 옮기기: 맞힌 기록만 살리고, 못 맞힌 판은 이어서 할 수 있게 */
interface V1Stats { won: number; streak: number; best: number; dist: number[]; lastDay?: number }
function fromV1(s: V1Stats): Stats {
  const hist: Record<string, number> = {}
  let sum = 0
  s.dist.forEach((n, i) => { if (n) { hist[i + 1] = n; sum += n * (i + 1) } })
  return { played: s.won, regular: s.won, extra: 0, sum, hist, streak: s.streak, best: s.best, lastDay: s.lastDay }
}
const reopen = <B extends Board>(b: B | null): B | null => (b && b.done && !b.won ? { ...b, done: false } : b)

export function loadSave(): WbSave {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (s && s.v === 2) return s
    if (s && s.v === 1) {
      return { v: 2, daily: reopen(s.daily), infinite: reopen(s.infinite), stats: { daily: fromV1(s.stats.daily), infinite: fromV1(s.stats.infinite) } }
    }
  } catch { /* 무시 */ }
  return freshSave()
}
export function storeSave(s: WbSave) { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* 무시 */ } }

/** 맞혔을 때 기록 반영 */
export function recordResult(stats: Stats, tries: number, day?: number): Stats {
  const regular = tries <= REGULAR
  const next: Stats = {
    ...stats,
    hist: { ...stats.hist, [tries]: (stats.hist[tries] ?? 0) + 1 },
    played: stats.played + 1,
    regular: stats.regular + (regular ? 1 : 0),
    extra: stats.extra + (regular ? 0 : 1),
    sum: stats.sum + tries,
  }
  if (day !== undefined) {
    // 오늘의 단어: 어제도 맞혔으면 이어짐
    next.streak = stats.lastDay === day - 1 ? stats.streak + 1 : 1
    next.lastDay = day
  } else {
    // 무한 모드: 정규 이닝 안에 연속으로 맞힌 판
    next.streak = regular ? stats.streak + 1 : 0
  }
  next.best = Math.max(next.best, next.streak)
  return next
}

/** 하루 이상 건너뛰었으면 오늘의 단어 연속 기록은 끊긴 것으로 보여줌 */
export const shownStreak = (s: Stats, today: number) => (s.lastDay !== undefined && s.lastDay >= today - 1 ? s.streak : 0)
