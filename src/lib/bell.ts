/** 할리갈리: 카드 = 종류*10 + 개수 (종류 0 인원 · 1 실적 · 2 아이디어 · 3 목표) */

export interface BellHand { deck: number; face: number; top: number | null; won: number; ok: number; bad: number }
export interface BellChat { id: number; userId: string | null; body: string; at: string }
export interface BellLast { type: 'flip' | 'ring'; by: string; card?: number; auto?: boolean; ok?: boolean; kind?: number; gained?: number; given?: number; at: string
  prev?: number | null; until?: string; tops?: Record<string, number> }

export interface BellState {
  roundNo: number
  phase: 'play' | 'result'
  playerIds: string[]
  turnIndex: number
  deadline: string | null
  endsAt: string | null
  now: string
  version: number
  last: BellLast | null
  winner: string | null
  result: { reason: 'last' | 'nodeck' | 'time'; players: Record<string, { cards: number; won: number; ok: number; bad: number }> } | null
  scores: Record<string, number>
  inGame: boolean
  hands: Record<string, BellHand>
  chats: BellChat[]
  people: Record<string, { nickname: string; color: number }>
}

export const TURN_SECONDS = 5
export const KIND_NAME = ['인원', '실적', '아이디어', '목표']
export const cardKind = (c: number) => Math.floor(c / 10)
export const cardCount = (c: number) => c % 10
