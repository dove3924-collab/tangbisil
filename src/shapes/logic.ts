/** 도형 배치: 조각(3~5칸 도형)을 판에 빈틈없이 채우는 퍼즐 */

export type Level = 'easy' | 'normal' | 'hard' | 'expert'
export const LEVEL_ORDER: Level[] = ['easy', 'normal', 'hard', 'expert']
export const LEVELS: Record<Level, { label: string; pieces: number }> = {
  easy: { label: '초급', pieces: 3 },
  normal: { label: '중급', pieces: 4 },
  hard: { label: '고급', pieces: 5 },
  expert: { label: '전문가', pieces: 6 },
}

export type Cell = [number, number] // [행, 열]

/** 기본 도형 (이름은 코드용) */
const SHAPES: Record<string, Cell[]> = {
  // 3칸
  I3: [[0, 0], [0, 1], [0, 2]],
  V3: [[0, 0], [1, 0], [1, 1]],
  // 4칸
  I4: [[0, 0], [0, 1], [0, 2], [0, 3]],
  O4: [[0, 0], [0, 1], [1, 0], [1, 1]],
  T4: [[0, 0], [0, 1], [0, 2], [1, 1]],
  S4: [[0, 1], [0, 2], [1, 0], [1, 1]],
  L4: [[0, 0], [1, 0], [2, 0], [2, 1]],
  // 5칸
  F5: [[0, 1], [0, 2], [1, 0], [1, 1], [2, 1]],
  L5: [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1]],
  N5: [[0, 1], [1, 1], [2, 0], [2, 1], [3, 0]],
  P5: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0]],
  T5: [[0, 0], [0, 1], [0, 2], [1, 1], [2, 1]],
  U5: [[0, 0], [0, 2], [1, 0], [1, 1], [1, 2]],
  V5: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]],
  W5: [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]],
  X5: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]],
  Y5: [[0, 1], [1, 0], [1, 1], [2, 1], [3, 1]],
  Z5: [[0, 0], [0, 1], [1, 1], [2, 1], [2, 2]],
}
const POOL: Record<Level, { small: string[]; big: string[]; bigCount: number }> = {
  easy: { small: ['I3', 'V3'], big: ['O4', 'T4', 'S4', 'L4', 'I4'], bigCount: 2 },
  normal: { small: ['O4', 'T4', 'S4', 'L4', 'I4'], big: ['F5', 'L5', 'N5', 'P5', 'T5', 'U5', 'V5', 'W5', 'Y5', 'Z5'], bigCount: 2 },
  hard: { small: ['T4', 'S4', 'L4'], big: ['F5', 'L5', 'N5', 'P5', 'T5', 'U5', 'V5', 'W5', 'X5', 'Y5', 'Z5'], bigCount: 4 },
  expert: { small: ['T4', 'S4', 'L4'], big: ['F5', 'L5', 'N5', 'P5', 'T5', 'U5', 'V5', 'W5', 'X5', 'Y5', 'Z5'], bigCount: 5 },
}

/** 방향: 먼저 뒤집고(flip) 시계방향으로 rot번 회전 */
export interface Orient { rot: number; flip: boolean }

export function normalize(cells: Cell[]): Cell[] {
  const r0 = Math.min(...cells.map((c) => c[0]))
  const c0 = Math.min(...cells.map((c) => c[1]))
  return cells.map(([r, c]) => [r - r0, c - c0] as Cell).sort((a, b) => a[0] - b[0] || a[1] - b[1])
}
export function shapeCells(shape: string, o: Orient): Cell[] {
  let cells = SHAPES[shape].map(([r, c]) => [r, o.flip ? -c : c] as Cell)
  for (let i = 0; i < ((o.rot % 4) + 4) % 4; i++) cells = cells.map(([r, c]) => [c, -r] as Cell)
  return normalize(cells)
}
export const dims = (cells: Cell[]) => ({ h: Math.max(...cells.map((c) => c[0])) + 1, w: Math.max(...cells.map((c) => c[1])) + 1 })

/** 조작: 시계·반시계 회전, 좌우·상하 대칭 (화면에 보이는 모양 기준) */
export const turnCW = (o: Orient): Orient => ({ ...o, rot: (o.rot + 1) % 4 })
export const turnCCW = (o: Orient): Orient => ({ ...o, rot: (o.rot + 3) % 4 })
export const flipH = (o: Orient): Orient => ({ flip: !o.flip, rot: (4 - o.rot) % 4 })
export const flipV = (o: Orient): Orient => ({ flip: !o.flip, rot: (6 - o.rot) % 4 })

export interface Piece { id: number; shape: string; orient: Orient; at: Cell | null } // at = 판 위 왼쪽 위 칸 (없으면 대기 중)
export interface Puzzle { h: number; w: number; mask: boolean[]; pieces: Piece[]; color: number[]; sol: { orient: Orient; at: Cell }[] }

const rnd = (n: number) => Math.floor(Math.random() * n)
const shuffle = <T,>(a: T[]) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = rnd(i + 1); [b[i], b[j]] = [b[j], b[i]] } return b }
const ALL_ORIENTS: Orient[] = [0, 1, 2, 3].flatMap((rot) => [{ rot, flip: false }, { rot, flip: true }])

/** 조각들을 이어 붙여 판 모양을 만든다 → 항상 풀림 */
export function generate(level: Level): Puzzle {
  for (let tries = 0; tries < 400; tries++) {
    const pool = POOL[level]
    const n = LEVELS[level].pieces
    const names = [...shuffle(pool.big).slice(0, pool.bigCount), ...shuffle(pool.small).slice(0, n - pool.bigCount)]
    const occ = new Set<string>()
    const key = (r: number, c: number) => `${r},${c}`
    let ok = true
    const sol: { orient: Orient; at: Cell }[] = []
    for (const [i, idx] of shuffle(names.map((_, k) => k)).entries()) {
      const name = names[idx]
      let best: { cells: Cell[]; score: number; o: Orient; a: Cell } | null = null
      for (const o of shuffle(ALL_ORIENTS)) {
        const cells = shapeCells(name, o)
        // 놓을 수 있는 위치 후보: 기존 칸 주변
        const cand = new Set<string>()
        if (i === 0) cand.add('0,0')
        else for (const s of occ) {
          const [r, c] = s.split(',').map(Number)
          for (const [dr, dc] of cells) for (const [ar, ac] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) cand.add(key(r + ar - dr, c + ac - dc))
        }
        for (const a of cand) {
          const [ar, ac] = a.split(',').map(Number)
          const placed = cells.map(([r, c]) => [r + ar, c + ac] as Cell)
          if (placed.some(([r, c]) => occ.has(key(r, c)))) continue
          if (i > 0 && !placed.some(([r, c]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dr, dc]) => occ.has(key(r + dr, c + dc))))) continue
          const all = [...[...occ].map((s) => s.split(',').map(Number) as Cell), ...placed]
          const rs = all.map((x) => x[0]), cs = all.map((x) => x[1])
          const bh = Math.max(...rs) - Math.min(...rs) + 1, bw = Math.max(...cs) - Math.min(...cs) + 1
          // 네모에 가깝고 너무 길쭉하지 않게
          const score = bh * bw + Math.abs(bh - bw) * 2 + Math.random() * 3
          if (!best || score < best.score) best = { cells: placed, score, o, a: [ar, ac] }
        }
      }
      if (!best) { ok = false; break }
      for (const [r, c] of best.cells) occ.add(key(r, c))
      sol[idx] = { orient: best.o, at: best.a }
    }
    if (!ok) continue
    const raw = [...occ].map((s) => s.split(',').map(Number) as Cell)
    const r0 = Math.min(...raw.map((c) => c[0])), c0 = Math.min(...raw.map((c) => c[1]))
    for (const x of sol) x.at = [x.at[0] - r0, x.at[1] - c0]
    const cells = normalize(raw)
    const { h, w } = dims(cells)
    if (Math.max(h, w) > (level === 'expert' ? 7 : level === 'hard' ? 7 : level === 'normal' ? 6 : 5)) continue
    const mask = Array(h * w).fill(false)
    for (const [r, c] of cells) mask[r * w + c] = true
    if (hasHole(mask, h, w)) continue
    if (cells.length === h * w && level !== 'easy') continue // 꽉 찬 직사각형은 너무 쉬워 보여서 제외 (초급은 허용)
    const pieces: Piece[] = names.map((shape, id) => ({ id, shape, orient: ALL_ORIENTS[rnd(8)], at: null }))
    return { h, w, mask, pieces, color: shuffle([0, 1, 2, 3, 4, 5]).slice(0, n), sol }
  }
  throw new Error('generate failed')
}

/** 판 안에 막힌 빈 구멍이 있는지 (바깥에서 못 닿는 빈칸) */
function hasHole(mask: boolean[], h: number, w: number) {
  const H = h + 2, W = w + 2
  const seen = new Set<number>([0])
  const q = [0]
  const filled = (r: number, c: number) => r >= 1 && r <= h && c >= 1 && c <= w && mask[(r - 1) * w + (c - 1)]
  while (q.length) {
    const v = q.pop()!
    const r = Math.floor(v / W), c = v % W
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr, nc = c + dc
      if (nr < 0 || nc < 0 || nr >= H || nc >= W) continue
      const k = nr * W + nc
      if (seen.has(k) || filled(nr, nc)) continue
      seen.add(k); q.push(k)
    }
  }
  const empty = H * W - mask.filter(Boolean).length
  return seen.size !== empty
}

/** 판 위 칸 점유 (조각 id) */
export function occupancy(p: Puzzle, skip?: number): (number | null)[] {
  const g: (number | null)[] = Array(p.h * p.w).fill(null)
  for (const pc of p.pieces) {
    if (!pc.at || pc.id === skip) continue
    for (const [r, c] of shapeCells(pc.shape, pc.orient)) g[(r + pc.at[0]) * p.w + (c + pc.at[1])] = pc.id
  }
  return g
}
export function fits(p: Puzzle, pc: Piece, o: Orient, at: Cell): boolean {
  const g = occupancy(p, pc.id)
  return shapeCells(pc.shape, o).every(([r, c]) => {
    const rr = r + at[0], cc = c + at[1]
    return rr >= 0 && cc >= 0 && rr < p.h && cc < p.w && p.mask[rr * p.w + cc] && g[rr * p.w + cc] === null
  })
}
export const solved = (p: Puzzle) => { const g = occupancy(p); return p.mask.every((m, i) => !m || g[i] !== null) }
export const cellCount = (p: Puzzle) => p.mask.filter(Boolean).length

/** 대결용 판 목록: 판(정답 없이)과 정답 배치(칸마다 조각 번호, 판 밖 -1)를 따로 */
export function battlePuzzles(level: Level, n = 24): { puzzles: Omit<Puzzle, 'sol'>[]; answers: number[][] } {
  const puzzles: Omit<Puzzle, 'sol'>[] = []
  const answers: number[][] = []
  for (let i = 0; i < n; i++) {
    const { sol, ...p } = generate(level)
    const solvedP = { ...p, sol, pieces: p.pieces.map((pc, k) => ({ ...pc, orient: sol[k].orient, at: sol[k].at })) }
    answers.push(occupancy(solvedP).map((v) => (v === null ? -1 : v)))
    puzzles.push(p)
  }
  return { puzzles, answers }
}
