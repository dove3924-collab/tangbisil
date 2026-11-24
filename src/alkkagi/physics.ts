/**
 * 알까기 물리. 판 좌표: 바둑판 줄 0~18 (한 칸 = 1). 판 테두리는 줄 바깥 EDGE 만큼.
 * 같은 입력이면 어느 브라우저에서도 같은 결과가 나오게: 고정 시간 간격, 덧셈·곱셈·sqrt 만 사용, 순서 고정.
 */

export const LINES = 19
export const EDGE_MIN = -0.6
export const EDGE_MAX = 18.6
export const R = 0.45 // 돌 반지름 (지름 ≈ 판의 1/19)
const FRICTION = 7 // 감속 (칸/초²)
export const MAX_TRAVEL = 27 // 혼자 굴러가는 최대 거리 ≈ 판 길이의 1.5배
export const VMAX = Math.sqrt(2 * FRICTION * MAX_TRAVEL)
export const DT = 1 / 240
const RESTITUTION = 0.9
const STOP = 0.02

export interface Stone { id: number; owner: 0 | 1; x: number; y: number; out: boolean }
interface Body extends Stone { vx: number; vy: number }

export const round4 = (v: number) => Math.round(v * 10000) / 10000

export class Sim {
  bodies: Body[]
  t = 0
  outAt: { id: number; x: number; y: number }[] = []
  constructor(stones: Stone[], shot: { stone: number; vx: number; vy: number }) {
    this.bodies = stones.map((s) => ({ ...s, vx: 0, vy: 0 })).sort((a, b) => a.id - b.id)
    const b = this.bodies.find((x) => x.id === shot.stone)
    if (b && !b.out) { b.vx = shot.vx; b.vy = shot.vy }
  }
  get moving() { return this.bodies.some((b) => !b.out && (b.vx !== 0 || b.vy !== 0)) }
  step() {
    const bs = this.bodies
    for (const b of bs) {
      if (b.out) continue
      b.x += b.vx * DT
      b.y += b.vy * DT
    }
    // 충돌 (같은 질량, 거의 탄성)
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i]
      if (a.out) continue
      for (let j = i + 1; j < bs.length; j++) {
        const c = bs[j]
        if (c.out) continue
        const dx = c.x - a.x, dy = c.y - a.y
        const d2 = dx * dx + dy * dy
        if (d2 >= 4 * R * R || d2 === 0) continue
        const d = Math.sqrt(d2)
        const nx = dx / d, ny = dy / d
        const rel = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny
        if (rel > 0) {
          const k = ((1 + RESTITUTION) / 2) * rel
          a.vx -= k * nx; a.vy -= k * ny
          c.vx += k * nx; c.vy += k * ny
        }
        const push = (2 * R - d) / 2
        a.x -= nx * push; a.y -= ny * push
        c.x += nx * push; c.y += ny * push
      }
    }
    // 마찰·떨어짐
    for (const b of bs) {
      if (b.out) continue
      const s = Math.sqrt(b.vx * b.vx + b.vy * b.vy)
      if (s > 0) {
        const s2 = s - FRICTION * DT
        if (s2 <= STOP) { b.vx = 0; b.vy = 0 } else { b.vx *= s2 / s; b.vy *= s2 / s }
      }
      if (b.x < EDGE_MIN || b.x > EDGE_MAX || b.y < EDGE_MIN || b.y > EDGE_MAX) {
        b.out = true; b.vx = 0; b.vy = 0
        this.outAt.push({ id: b.id, x: b.x, y: b.y })
      }
    }
    this.t += DT
  }
  /** 끝까지 (최대 20초) */
  run() { let n = 0; while (this.moving && n < 20 * 240) { this.step(); n++ } return this.result() }
  result(): Stone[] { return this.bodies.map(({ id, owner, x, y, out }) => ({ id, owner, x: round4(x), y: round4(y), out })) }
}

/** 기본 배치: 가장자리에서 4번째 줄에 2칸 간격 */
export function linePositions(n: number, owner: 0 | 1): [number, number][] {
  const xs = Array.from({ length: n }, (_, i) => 9 + (i - (n - 1) / 2) * 2)
  return xs.map((x) => [x, owner === 0 ? 15 : 3])
}

/** 자기 진영 (아래쪽 = 0번): y 10~18 / 위쪽 = 1번: y 0~8 */
export const inZone = (owner: 0 | 1, x: number, y: number) =>
  x >= 0 && x <= 18 && (owner === 0 ? y >= 10 && y <= 18 : y >= 0 && y <= 8)
export const MIN_GAP = 2 * R + 0.1

export function randomPositions(n: number, owner: 0 | 1): [number, number][] {
  for (let t = 0; t < 200; t++) {
    const out: [number, number][] = []
    for (let k = 0; k < 400 && out.length < n; k++) {
      const x = round4(1 + Math.random() * 16), y = round4(owner === 0 ? 11 + Math.random() * 6 : 1 + Math.random() * 6)
      if (out.every(([a, b]) => Math.hypot(a - x, b - y) >= MIN_GAP + 0.4)) out.push([x, y])
    }
    if (out.length === n) return out
  }
  return linePositions(n, owner)
}
