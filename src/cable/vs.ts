import type { Level } from './logic'

export interface CbvPuzzle { w: number; h: number; server: number; cells: number[] }
export interface CbvState {
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
  puzzle: CbvPuzzle | null
  progress: Record<string, { placed: number }> // 연결된 PC 수 (999 = 완성)
  points: Record<string, number>
  last: { round: number; winner: string | null; ms: number | null; reason: 'done' | 'skip' | 'draw' | 'time'; occ: number[] | null; ranks: { id: string; placed: number }[]; puzzle: CbvPuzzle; at: string } | null
  winner: string | null
  result: { reason: 'target' | 'alone'; rounds: number; players: Record<string, { points: number; best: number | null; avg: number | null }> } | null
  scores: Record<string, number>
  inGame: boolean
  skipVotes: string[]
  chats: { id: number; userId: string | null; body: string; at: string }[]
  people: Record<string, { nickname: string; color: number }>
}
