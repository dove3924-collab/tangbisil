export type BingoPhase = 'fill' | 'call' | 'result'

export interface BingoCall {
  id: number
  userId: string
  word: string
  auto: boolean
  custom: boolean
  tongs: string[]
  at: string
}

export interface BingoChat {
  id: number
  userId: string
  body: string
  at: string
}

export interface BingoState {
  roundNo: number
  phase: BingoPhase
  category: string
  size: number
  linesToWin: number
  customMax: number
  playerIds: string[]
  turnIndex: number
  deadline: string | null
  now: string
  ready: string[]
  winner: string | null
  result: { boards: Record<string, { cells: string[]; custom: boolean[]; lines: number }>; calls: number } | null
  scores: Record<string, number>
  inGame: boolean
  words: string[]
  myCells: string[]
  myCustom: boolean[]
  calls: BingoCall[]
  chats: BingoChat[]
  people: Record<string, { nickname: string; color: number }>
}

export const FILL_SECONDS = 120
export const CALL_SECONDS = 15

/** 서버 _liar_norm 과 같은 규칙: 소문자, 공백·기호 제거 */
export const norm = (t: string) => t.toLowerCase().replace(/[\s\p{P}\p{S}·]/gu, '')

/** 판 크기별 줄 (칸 번호 목록) */
export function allLines(size: number): number[][] {
  const out: number[][] = []
  for (let i = 0; i < size; i++) {
    out.push(Array.from({ length: size }, (_, j) => i * size + j))
    out.push(Array.from({ length: size }, (_, j) => j * size + i))
  }
  out.push(Array.from({ length: size }, (_, i) => i * size + i))
  out.push(Array.from({ length: size }, (_, i) => i * size + (size - 1 - i)))
  return out
}

export function doneLines(cells: string[], size: number, called: Set<string>) {
  if (cells.length !== size * size) return []
  return allLines(size).filter((ln) => ln.every((i) => cells[i] && called.has(norm(cells[i]))))
}
