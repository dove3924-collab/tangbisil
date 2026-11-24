/**
 * 케이블 연결: 칸마다 케이블 조각, 돌려서 서버에서 모든 칸을 하나로 잇기.
 * 판 = 서버(가운데)에서 뻗은 나무 모양 연결 → 섞기(칸마다 무작위 회전). 끝 칸(연결 1개) = PC.
 * 방향 비트: 위 1 · 오른쪽 2 · 아래 4 · 왼쪽 8
 */

export type Level = 'easy' | 'normal' | 'hard'
export const LEVEL_ORDER: Level[] = ['easy', 'normal', 'hard']
export const LEVELS: Record<Level, { label: string; w: number; h: number }> = {
  easy: { label: '초급', w: 5, h: 5 },
  normal: { label: '중급', w: 7, h: 6 },
  hard: { label: '고급', w: 9, h: 8 },
}

export const N = 1, E = 2, S = 4, W = 8
const DIRS: [number, number, number, number][] = [[N, 0, -1, S], [E, 1, 0, W], [S, 0, 1, N], [W, -1, 0, E]] // [비트, dx, dy, 반대]

export interface Board { w: number; h: number; server: number; cells: number[]; locked: boolean[]; turns: number; sol: number[] }

export const rotCW = (m: number) => ((m << 1) | (m >> 3)) & 15
export const rotCCW = (m: number) => ((m >> 1) | ((m & 1) << 3)) & 15
export const degree = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1)

const rnd = (n: number) => Math.floor(Math.random() * n)

export function generate(level: Level): Board {
  const { w, h } = LEVELS[level]
  const n = w * h
  const server = Math.floor(h / 2) * w + Math.floor(w / 2)
  for (let tries = 0; tries < 50; tries++) {
    const cells = Array(n).fill(0)
    const inTree = Array(n).fill(false)
    inTree[server] = true
    // 무작위 프림: 나무 가장자리에서 아무 연결이나 붙이기 (서버 말고는 연결 3개까지)
    const frontier: [number, number][] = []
    const addFrontier = (i: number) => {
      const x = i % w, y = Math.floor(i / w)
      for (const [bit, dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        frontier.push([i, bit])
      }
    }
    addFrontier(server)
    let count = 1
    while (frontier.length && count < n) {
      const k = rnd(frontier.length)
      const [i, bit] = frontier[k]
      frontier[k] = frontier[frontier.length - 1]; frontier.pop()
      const d = DIRS.find((x) => x[0] === bit)!
      const j = i + d[1] + d[2] * w
      if (inTree[j]) continue
      if (i !== server && degree(cells[i]) >= 3) continue
      cells[i] |= bit
      cells[j] |= d[3]
      inTree[j] = true
      count++
      addFrontier(j)
    }
    if (count < n) continue
    // PC(끝 칸)가 너무 적거나 많지 않게
    const pcs = cells.filter((m, i) => i !== server && degree(m) === 1).length
    if (pcs < n * 0.2 || pcs > n * 0.45) continue
    // 섞기
    const scrambled = cells.map((m) => { let x = m; for (let r = rnd(4); r > 0; r--) x = rotCW(x); return x })
    const b: Board = { w, h, server, cells: scrambled, locked: Array(n).fill(false), turns: 0, sol: cells }
    if (solved(b)) continue
    return b
  }
  throw new Error('generate failed')
}

/** 서버에서 이어진 칸들 */
export function connected(b: Board): boolean[] {
  const on = Array(b.cells.length).fill(false)
  on[b.server] = true
  const q = [b.server]
  while (q.length) {
    const i = q.pop()!
    const x = i % b.w, y = Math.floor(i / b.w)
    for (const [bit, dx, dy, opp] of DIRS) {
      if (!(b.cells[i] & bit)) continue
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h) continue
      const j = ny * b.w + nx
      if (on[j] || !(b.cells[j] & opp)) continue
      on[j] = true
      q.push(j)
    }
  }
  return on
}

/** 모든 칸이 서버와 이어지고, 어긋난(허공으로 뻗은) 선이 없으면 완료 */
export function solved(b: Board): boolean {
  const on = connected(b)
  if (!on.every(Boolean)) return false
  for (let i = 0; i < b.cells.length; i++) {
    const x = i % b.w, y = Math.floor(i / b.w)
    for (const [bit, dx, dy, opp] of DIRS) {
      if (!(b.cells[i] & bit)) continue
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h) return false
      if (!(b.cells[ny * b.w + nx] & opp)) return false
    }
  }
  return true
}

export const isPc = (b: Board, i: number) => i !== b.server && degree(b.cells[i]) === 1

/** 대결용 판 목록: 섞인 판(정답 없이)과 정답 모양을 따로 */
export function battleBoards(level: Level, n = 24): { puzzles: { w: number; h: number; server: number; cells: number[] }[]; answers: number[][] } {
  const puzzles: { w: number; h: number; server: number; cells: number[] }[] = []
  const answers: number[][] = []
  for (let i = 0; i < n; i++) {
    const b = generate(level)
    puzzles.push({ w: b.w, h: b.h, server: b.server, cells: b.cells })
    answers.push(b.sol)
  }
  return { puzzles, answers }
}
