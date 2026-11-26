import type { Level } from './logic'

export interface LkvPuzzle { n: number; ends: [number, number][] }
export interface LkvState {
  roundNo: number
  phase: 'play' | 'result'
  playerIds: string[]
  level: Level
  target: number
  round: number
  startedAt: string
  deadline: string | null
  now: string
  version: number
  puzzle: LkvPuzzle | null
  progress: Record<string, { placed: number; pct: number }> // 연결한 쌍 수 · 칸 채움 %
  points: Record<string, number>
  last: { round: number; winner: string | null; ms: number | null; reason: 'done' | 'skip' | 'draw' | 'time'; paths: number[][] | null; ranks: { id: string; placed: number; pct: number }[]; puzzle: LkvPuzzle; at: string } | null
  winner: string | null
  result: { reason: 'target' | 'alone'; rounds: number; players: Record<string, { points: number; best: number | null; avg: number | null }> } | null
  scores: Record<string, number>
  inGame: boolean
  skipVotes: string[]
  chats: { id: number; userId: string | null; body: string; at: string }[]
  people: Record<string, { nickname: string; color: number }>
}
