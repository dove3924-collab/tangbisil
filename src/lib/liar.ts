/** 라이어 게임 주제 목록 (제시어 자체는 서버에만 둔다. supabase/seed/liar_words.json 과 맞출 것) */
export const LIAR_CATEGORIES = ['음식', '음료', '과일', '동물', '직업', '장소', '스포츠', '사무용품', '나라', '회사 생활']

export type LiarPhase = 'hint' | 'discuss' | 'vote' | 'defense' | 'revote' | 'guess' | 'result' | 'appeal'

export interface LiarMessage {
  id: number
  kind: 'system' | 'hint' | 'timeout' | 'chat' | 'guess'
  userId: string | null
  body: string
  at: string
  reactions?: Record<string, string[]> | null // 힌트에 단 이모지 → 누른 사람들
}

export interface LiarResult {
  firstVotes?: Record<string, number>
  firstVoteDetail?: { voter: string; target: string }[]
  votes?: Record<string, number>
  voteDetail?: { voter: string; target: string }[]
  accusedId?: string | null
  winner?: 'liar' | 'citizen'
  reason?: string
  liarId?: string
  word?: string
  guess?: string | null
  appeal?: { open?: boolean; accepted?: boolean; yes?: number; no?: number; eligible?: number }
}

export interface LiarState {
  roundNo: number
  phase: LiarPhase
  category: string
  playerIds: string[]
  turnIndex: number
  hintRounds: number
  hintSeconds: number
  discussSeconds: number
  deadline: string | null
  now: string
  discussDone: string[]
  tieIds: string[]
  result: LiarResult | null
  scores: Record<string, number>
  inGame: boolean
  role: 'liar' | 'citizen' | null
  word: string | null
  liarId: string | null
  myVote: string | null
  votedCount: number
  appealVotedCount: number
  myAppeal: boolean | null
  people: Record<string, { nickname: string; color: number }>
  messages: LiarMessage[]
}

export const VOTE_SECONDS = 30
export const GUESS_SECONDS = 30
export const APPEAL_SECONDS = 20
export const DEFENSE_SECONDS = 20
export const REVOTE_SECONDS = 20
