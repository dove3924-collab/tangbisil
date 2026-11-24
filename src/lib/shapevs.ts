/** 도형 배치 대결 상태 (서버 shv_state) */
import type { Level, Puzzle } from '../shapes/logic'

export interface ShvChat { id: number; userId: string | null; body: string; at: string }
export interface ShvLast {
  round: number; winner: string | null; ms: number | null; reason: 'done' | 'time' | 'draw' | 'skip'; occ: number[] | null
  ranks: { id: string; placed: number; cells: number }[]; puzzle: Puzzle; at: string
}
export interface ShvState {
  roundNo: number
  phase: 'play' | 'result'
  playerIds: string[]
  level: Level
  target: number
  sec: number
  round: number
  startedAt: string
  deadline: string | null
  now: string
  version: number
  puzzle: Puzzle | null
  progress: Record<string, { placed: number }> // 남의 진행은 놓은 도형 수만
  points: Record<string, number>
  last: ShvLast | null
  winner: string | null
  result: { reason: 'target' | 'alone'; rounds: number; players: Record<string, { points: number; best: number | null; avg: number | null }> } | null
  scores: Record<string, number>
  inGame: boolean
  skipVotes: string[] // 넘기기 제안·동의한 사람
  chats: ShvChat[]
  people: Record<string, { nickname: string; color: number }>
}
