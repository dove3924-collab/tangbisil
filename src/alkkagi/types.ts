import type { Stone } from './physics'

export interface AlkChat { id: number; userId: string | null; body: string; at: string }
export interface AlkShot { seq: number; by: string; stone: number; vx: number; vy: number; before: Stone[]; after: Stone[]; knocked: number; lost: number; skip?: undefined }
export interface AlkSkip { seq: number; skip: true; by: string }
export interface AlkStats { knocked?: number; lost?: number; shots?: number; hits?: number }
export interface AlkState {
  gameNo: number
  phase: 'place' | 'play' | 'between' | 'result'
  playerIds: string[]
  n: number
  target: number
  turnSec: number
  placeMode: 'free' | 'line'
  round: number
  first: number
  turn: number
  deadline: string | null
  now: string
  stones: Stone[]
  seq: number
  last: AlkShot | AlkSkip | null
  placeDone: Record<string, boolean>
  wins: Record<string, number>
  stats: Record<string, AlkStats>
  roundEnd: { round: number; winner: string | null; at: string } | null
  winner: string | null
  result: { reason: 'target' | 'alone' | 'resign'; rounds: number; players: Record<string, AlkStats & { wins: number }> } | null
  scores: Record<string, number>
  version: number
  me: number | null // 0 = 아래(파랑), 1 = 위(주황), null = 구경
  myPlace: [number, number][] | null
  chats: AlkChat[]
  people: Record<string, { nickname: string; color: number }>
}
