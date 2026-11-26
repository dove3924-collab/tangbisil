/** 결재선 잇기 (넘버링크): 같은 글자 둘을 선으로 잇고, 선끼리 겹치지 않게 판 전체를 채우기 */

export type Level = 'easy' | 'normal' | 'hard'
export const LEVEL_ORDER: Level[] = ['easy', 'normal', 'hard']
export const LEVELS: Record<Level, { label: string; n: number; pairs: [number, number] }> = {
  easy: { label: '초급', n: 5, pairs: [4, 5] },
  normal: { label: '중급', n: 7, pairs: [6, 7] },
  hard: { label: '고급', n: 9, pairs: [8, 9] },
}

export const COLORS = ['#e5484d', '#3e7bfa', '#2f9e44', '#f08c00', '#8e5bd9', '#0c9fae', '#e64980', '#8d6e63', '#5c6bc0']
export const LETTERS = 'ABCDEFGHI'
export const DEPTS = ['기획팀', '재무팀', '인사팀', '영업팀', '개발팀', '총무팀', '마케팅팀', '법무팀', '구매팀']

export interface Puzzle {
  n: number
  /** 색마다 끝점 두 칸 */
  ends: [number, number][]
  /** 정답 경로 (대결 넘기기 때 공개용, 혼자 하기에선 안 씀) */
  sol?: number[][]
}

/** 플레이 상태: 색마다 한쪽 끝점에서 시작하는 칸 목록 */
export type Paths = number[][]

const rnd = (k: number) => Math.floor(Math.random() * k)

function neighbors(n: number, i: number) {
  const x = i % n, y = Math.floor(i / n), r: number[] = []
  if (y > 0) r.push(i - n)
  if (x < n - 1) r.push(i + 1)
  if (y < n - 1) r.push(i + n)
  if (x > 0) r.push(i - 1)
  return r
}
export const adjacent = (n: number, a: number, b: number) => neighbors(n, a).includes(b)

/** 판 전체를 한 번씩 지나는 길을 무작위로 섞기 (backbite) */
function randomHamiltonian(n: number) {
  let path: number[] = []
  for (let y = 0; y < n; y++) for (let k = 0; k < n; k++) path.push(y * n + (y % 2 ? n - 1 - k : k))
  for (let t = 0; t < n * n * 80; t++) {
    if (Math.random() < 0.5) path.reverse()
    const end = path[path.length - 1]
    const nb = neighbors(n, end).filter((q) => q !== path[path.length - 2])
    const q = nb[rnd(nb.length)]
    const i = path.indexOf(q)
    path = path.slice(0, i + 1).concat(path.slice(i + 1).reverse())
  }
  return path
}

/** 새 판. 정답 경로를 먼저 깔고 끝점만 남기므로 항상 풀 수 있다 */
export function generate(level: Level): Puzzle {
  const { n, pairs } = LEVELS[level]
  const total = n * n
  for (;;) {
    const k = pairs[0] + rnd(pairs[1] - pairs[0] + 1)
    const path = randomHamiltonian(n)
    const avg = total / k
    for (let tries = 0; tries < 200; tries++) {
      const cuts = new Set<number>()
      while (cuts.size < k - 1) cuts.add(3 + rnd(total - 5))
      const cs = [...cuts].sort((a, b) => a - b)
      const segs: number[][] = []
      let prev = 0
      for (const c of [...cs, total]) { segs.push(path.slice(prev, c)); prev = c }
      const ok = segs.every((s) => s.length >= 3 && s.length <= avg * 2.1 && !adjacent(n, s[0], s[s.length - 1]))
      if (ok) {
        // 색 순서 섞기
        const sol = [...segs].sort(() => Math.random() - 0.5)
        return { n, ends: sol.map((s) => [s[0], s[s.length - 1]] as [number, number]), sol }
      }
    }
  }
}

export const emptyPaths = (p: Puzzle): Paths => p.ends.map(() => [])

/** 칸 i 가 어느 색의 끝점인지 (-1 = 아님) */
export function endColor(p: Puzzle, i: number) {
  return p.ends.findIndex(([a, b]) => a === i || b === i)
}

/** 칸 i 를 지나는 선의 색 (-1 = 없음) */
export function owner(paths: Paths, i: number) {
  return paths.findIndex((ps) => ps.includes(i))
}

export function complete(p: Puzzle, paths: Paths, c: number) {
  const ps = paths[c], [a, b] = p.ends[c]
  return ps.length >= 2 && ((ps[0] === a && ps[ps.length - 1] === b) || (ps[0] === b && ps[ps.length - 1] === a))
}

export function stats(p: Puzzle, paths: Paths) {
  const total = p.n * p.n
  const used = new Set<number>()
  paths.forEach((ps) => ps.forEach((i) => used.add(i)))
  p.ends.forEach(([a, b]) => { used.add(a); used.add(b) })
  const linked = p.ends.filter((_, c) => complete(p, paths, c)).length
  const free = total - p.ends.length * 2
  /** 칸 채움 % (글자 칸은 빼고 셈) */
  const pct = free > 0 ? Math.round(((used.size - p.ends.length * 2) / free) * 100) : 100
  return { linked, pairs: p.ends.length, filled: used.size, total, pct, solved: linked === p.ends.length && used.size === total }
}

/** 칸 i 를 눌렀을 때: 그릴 색과 새 상태 (null = 그릴 수 없음) */
export function startAt(p: Puzzle, paths: Paths, i: number): { c: number; paths: Paths } | null {
  const e = endColor(p, i)
  if (e >= 0) return { c: e, paths: paths.map((ps, k) => (k === e ? [i] : ps)) }
  const o = owner(paths, i)
  if (o >= 0) return { c: o, paths: paths.map((ps, k) => (k === o ? ps.slice(0, ps.indexOf(i) + 1) : ps)) }
  return null
}

/** 색 c 의 선을 이웃 칸 j 로 한 칸 늘리기 (되돌아가면 줄이기, 다른 선을 지나면 그 선을 자름) */
export function stepTo(p: Puzzle, paths: Paths, c: number, j: number): Paths | null {
  const ps = paths[c]
  if (ps.length === 0) return null
  const last = ps[ps.length - 1]
  if (j === last) return paths
  if (!adjacent(p.n, last, j)) return null
  const at = ps.indexOf(j)
  if (at >= 0) return paths.map((q, k) => (k === c ? q.slice(0, at + 1) : q))
  if (complete(p, paths, c)) return null
  const e = endColor(p, j)
  if (e >= 0 && e !== c) return null
  if (e === c && j === ps[0]) return null
  const o = owner(paths, j)
  return paths.map((q, k) => {
    if (k === c) return [...q, j]
    if (k === o) return q.slice(0, q.indexOf(j))
    return q
  })
}

/** 멀리 떨어진 칸으로 끌었을 때 한 칸씩 따라가기 */
export function dragTo(p: Puzzle, paths: Paths, c: number, j: number): Paths {
  let cur = paths
  for (let guard = 0; guard < p.n * 2; guard++) {
    const ps = cur[c]
    const last = ps[ps.length - 1]
    if (last === j || last === undefined) break
    if (ps.includes(j)) { cur = cur.map((q, k) => (k === c ? q.slice(0, q.indexOf(j) + 1) : q)); break }
    const lx = last % p.n, ly = Math.floor(last / p.n), jx = j % p.n, jy = Math.floor(j / p.n)
    const dx = Math.sign(jx - lx), dy = Math.sign(jy - ly)
    const opts = Math.abs(jx - lx) >= Math.abs(jy - ly) ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]]
    let moved = false
    for (const [ax, ay] of opts) {
      if (!ax && !ay) continue
      const nxt = stepTo(p, cur, c, (ly + ay) * p.n + lx + ax)
      if (nxt && nxt !== cur) { cur = nxt; moved = true; break }
    }
    if (!moved) break
  }
  return cur
}

/** 대결용 판 묶음: 판(끝점만)과 정답 경로를 따로 */
export function battleBoards(level: Level, k = 24): { puzzles: { n: number; ends: [number, number][] }[]; answers: number[][][] } {
  const puzzles: { n: number; ends: [number, number][] }[] = []
  const answers: number[][][] = []
  for (let i = 0; i < k; i++) {
    const g = generate(level)
    puzzles.push({ n: g.n, ends: g.ends })
    answers.push(g.sol ?? [])
  }
  return { puzzles, answers }
}
