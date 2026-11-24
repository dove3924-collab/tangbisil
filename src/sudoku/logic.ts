/** 스도쿠: 문제 만들기·풀이·난이도 */
export type Level = 'easy' | 'normal' | 'hard'
export const LEVELS: Record<Level, { label: string; givens: number }> = {
  easy: { label: '초급', givens: 40 }, // 빈칸 하나 남은 칸만 채우면 풀림
  normal: { label: '중급', givens: 32 }, // "이 숫자가 들어갈 곳이 여기뿐" 찾기가 필요
  hard: { label: '고급', givens: 26 }, // 위 두 방법만으로는 안 풀림
}
export const LEVEL_ORDER: Level[] = ['easy', 'normal', 'hard']

export const row = (i: number) => Math.floor(i / 9)
export const col = (i: number) => i % 9
export const box = (i: number) => Math.floor(row(i) / 3) * 3 + Math.floor(col(i) / 3)
const ALL = 0x3fe // 1~9 비트
const bit = (d: number) => 1 << d
const popcount = (m: number) => { let c = 0; while (m) { m &= m - 1; c++ } return c }

export const UNITS: number[][] = [
  ...Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => r * 9 + c)),
  ...Array.from({ length: 9 }, (_, c) => Array.from({ length: 9 }, (_, r) => r * 9 + c)),
  ...Array.from({ length: 9 }, (_, b) => Array.from({ length: 9 }, (_, k) => (Math.floor(b / 3) * 3 + Math.floor(k / 3)) * 9 + (b % 3) * 3 + (k % 3))),
]
export const PEERS: number[][] = Array.from({ length: 81 }, (_, i) =>
  Array.from({ length: 81 }, (_, j) => j).filter((j) => j !== i && (row(j) === row(i) || col(j) === col(i) || box(j) === box(i))))

/** 지금 칸에 들어갈 수 있는 숫자 (비트) */
export function candidates(grid: number[], i: number) {
  let used = 0
  for (const j of PEERS[i]) if (grid[j]) used |= bit(grid[j])
  return ALL & ~used
}
export const maskDigits = (m: number) => [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => m & bit(d))

/** 해답 개수 (limit 개까지만 셈) */
export function countSolutions(grid: number[], limit = 2): number {
  const g = grid.slice()
  const rows = Array(9).fill(0), cols = Array(9).fill(0), boxes = Array(9).fill(0)
  for (let i = 0; i < 81; i++) {
    const d = g[i]
    if (!d) continue
    const b = bit(d)
    if ((rows[row(i)] | cols[col(i)] | boxes[box(i)]) & b) return 0
    rows[row(i)] |= b; cols[col(i)] |= b; boxes[box(i)] |= b
  }
  let count = 0
  const go = (): void => {
    let best = -1, bestMask = 0, bestN = 10
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue
      const m = ALL & ~(rows[row(i)] | cols[col(i)] | boxes[box(i)])
      const n = popcount(m)
      if (n < bestN) { best = i; bestMask = m; bestN = n; if (n <= 1) break }
    }
    if (best < 0) { count++; return }
    if (!bestMask) return
    for (let d = 1; d <= 9 && count < limit; d++) {
      if (!(bestMask & bit(d))) continue
      const b = bit(d), r = row(best), c = col(best), x = box(best)
      g[best] = d; rows[r] |= b; cols[c] |= b; boxes[x] |= b
      go()
      g[best] = 0; rows[r] &= ~b; cols[c] &= ~b; boxes[x] &= ~b
    }
  }
  go()
  return count
}

function shuffle<T>(a: T[], rnd: () => number) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

/** 무작위로 꽉 찬 정답 판 */
export function fullGrid(rnd = Math.random): number[] {
  const g = Array(81).fill(0)
  const go = (i: number): boolean => {
    if (i === 81) return true
    for (const d of shuffle(maskDigits(candidates(g, i)), rnd)) {
      g[i] = d
      if (go(i + 1)) return true
    }
    g[i] = 0
    return false
  }
  go(0)
  return g
}

/** 쉬운 방법만으로 끝까지 풀리는지: naked = 후보가 하나뿐인 칸, hidden = 줄·칸 안에서 그 숫자가 갈 곳이 하나뿐 */
export function solvableWith(grid: number[], hidden: boolean) {
  const g = grid.slice()
  for (;;) {
    let progress = false
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue
      const m = candidates(g, i)
      if (!m) return false
      if (popcount(m) === 1) { g[i] = maskDigits(m)[0]; progress = true }
    }
    if (!progress && hidden) {
      for (const unit of UNITS) {
        for (let d = 1; d <= 9; d++) {
          if (unit.some((i) => g[i] === d)) continue
          const spots = unit.filter((i) => !g[i] && candidates(g, i) & bit(d))
          if (spots.length === 1) { g[spots[0]] = d; progress = true }
        }
      }
    }
    if (!progress) break
  }
  return g.every(Boolean)
}

function grade(puzzle: number[]): Level {
  if (solvableWith(puzzle, false)) return 'easy'
  if (solvableWith(puzzle, true)) return 'normal'
  return 'hard'
}

/** 해답이 하나뿐인 문제 만들기. 레벨에 맞는 문제가 나올 때까지 몇 번 시도 */
export function generate(level: Level, rnd = Math.random): { puzzle: number[]; solution: number[] } {
  const target = LEVELS[level].givens
  let fallback: { puzzle: number[]; solution: number[] } | null = null
  for (let attempt = 0; attempt < 60; attempt++) {
    const solution = fullGrid(rnd)
    const puzzle = solution.slice()
    let givens = 81
    for (const i of shuffle(Array.from({ length: 81 }, (_, k) => k), rnd)) {
      if (givens <= target) break
      const v = puzzle[i]
      puzzle[i] = 0
      if (countSolutions(puzzle) !== 1) puzzle[i] = v
      else givens--
    }
    const g = grade(puzzle)
    if (g === level) return { puzzle, solution }
    // 어려운 쪽으로 빗나간 건 쉬운 레벨에는 안 씀
    if (!fallback || (level === 'hard' && g === 'normal')) fallback = { puzzle, solution }
  }
  return fallback!
}
