/** 지뢰찾기 규칙 */
export type Level = 'easy' | 'normal' | 'hard'
export const LEVELS: Record<Level, { label: string; w: number; h: number; mines: number }> = {
  easy: { label: '초급', w: 9, h: 9, mines: 10 },
  normal: { label: '중급', w: 16, h: 16, mines: 40 },
  hard: { label: '고급', w: 30, h: 16, mines: 99 },
}
export const LEVEL_ORDER: Level[] = ['easy', 'normal', 'hard']

export interface MineBoard {
  w: number
  h: number
  mines: boolean[] // 첫 클릭 전에는 전부 false
  counts: number[]
  open: boolean[]
  flag: boolean[]
  placed: boolean
}

export const emptyBoard = (level: Level): MineBoard => {
  const { w, h } = LEVELS[level]
  const n = w * h
  return { w, h, mines: Array(n).fill(false), counts: Array(n).fill(0), open: Array(n).fill(false), flag: Array(n).fill(false), placed: false }
}

export function neighbors(b: { w: number; h: number }, i: number) {
  const x = i % b.w, y = Math.floor(i / b.w)
  const out: number[] = []
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue
    const nx = x + dx, ny = y + dy
    if (nx >= 0 && ny >= 0 && nx < b.w && ny < b.h) out.push(ny * b.w + nx)
  }
  return out
}

/** 첫 클릭한 칸과 그 주변 8칸에는 지뢰를 두지 않는다 (첫 클릭은 항상 빈 칸이 열림) */
export function placeMines(b: MineBoard, count: number, safe: number, rnd = Math.random): MineBoard {
  const n = b.w * b.h
  const banned = new Set([safe, ...neighbors(b, safe)])
  const pool: number[] = []
  for (let i = 0; i < n; i++) if (!banned.has(i)) pool.push(i)
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]] }
  const mines = Array(n).fill(false)
  pool.slice(0, count).forEach((i) => { mines[i] = true })
  const counts = mines.map((_, i) => neighbors(b, i).filter((j) => mines[j]).length)
  return { ...b, mines, counts, placed: true }
}

/** 칸 열기 (0이면 주변까지 퍼짐). 지뢰를 열면 hit 반환 */
export function reveal(b: MineBoard, start: number): { board: MineBoard; hit: number | null } {
  if (b.open[start] || b.flag[start]) return { board: b, hit: null }
  if (b.mines[start]) return { board: { ...b, open: b.open.map((o, i) => o || i === start) }, hit: start }
  const open = [...b.open]
  const stack = [start]
  while (stack.length) {
    const i = stack.pop()!
    if (open[i] || b.flag[i]) continue
    open[i] = true
    if (b.counts[i] === 0) for (const j of neighbors(b, i)) if (!open[j] && !b.mines[j]) stack.push(j)
  }
  return { board: { ...b, open }, hit: null }
}

/** 숫자 칸 주변 열기: 깃발 수가 숫자와 같을 때만. 깃발을 잘못 꽂았으면 지뢰를 밟음 */
export function chord(b: MineBoard, i: number): { board: MineBoard; hit: number | null; did: boolean } {
  if (!b.open[i] || b.counts[i] === 0) return { board: b, hit: null, did: false }
  const ns = neighbors(b, i)
  if (ns.filter((j) => b.flag[j]).length !== b.counts[i]) return { board: b, hit: null, did: false }
  let board = b
  let hit: number | null = null
  for (const j of ns) {
    if (board.open[j] || board.flag[j]) continue
    const r = reveal(board, j)
    board = r.board
    if (r.hit !== null && hit === null) hit = r.hit
  }
  return { board, hit, did: true }
}

export const isWon = (b: MineBoard) => b.placed && b.open.every((o, i) => o || b.mines[i])
