import { ensureSession, supabase } from './supabase'
import type { LiarState } from './liar'
import type { BingoState } from './bingo'
import type { BellState } from './bell'
import type { ShvState } from './shapevs'
import type { CbvState } from '../cable/vs'
import type { LkvState } from '../link/vs'
import type { AlkState } from '../alkkagi/types'

export interface Player {
  id: string
  nickname: string
  color: number
  online: boolean
}

export interface RoomSettings {
  category: string
  hintRounds: number
  hintSeconds: number
  discussSeconds: number
  size: number
  lines: number
  limitMin?: number
  shLevel?: 'easy' | 'normal' | 'hard' | 'expert'
  shTarget?: number
  alkN?: number
  alkTarget?: number
  alkSec?: number
  alkPlace?: 'free' | 'line'
  cbLevel?: 'easy' | 'normal' | 'hard'
  cbTarget?: number
  lkLevel?: 'easy' | 'normal' | 'hard'
  lkTarget?: number
  shSec?: number
}

export interface RoomPublic {
  code: string
  game: string
  status: string
  member: false
  playerCount: number
  maxPlayers: number
  hasEntryCode: boolean
  isHost: boolean
}

export interface RoomFull {
  code: string
  game: string
  status: string
  member: true
  me: string
  hostId: string
  settings: RoomSettings
  hasEntryCode: boolean
  entryCode: string | null
  maxPlayers: number
  players: Player[]
}

export type RoomView = RoomPublic | RoomFull

const MESSAGES: Record<string, string> = {
  NO_ROOM: '없는 방이거나 이미 끝난 방이에요.',
  BAD_NICKNAME: '닉네임은 1~10자로 입력해 주세요.',
  NICKNAME_TAKEN: '이 방에서 이미 쓰고 있는 닉네임이에요.',
  ROOM_FULL: '방이 꽉 찼어요.',
  BAD_ENTRY_CODE: '비밀번호가 맞지 않아요.',
  IN_PROGRESS: '이미 게임이 진행 중이에요.',
  NOT_HOST: '방장만 할 수 있어요.',
  BAD_GAME: '아직 열리지 않은 게임이에요.',
  NEED_PLAYERS_2: '2명 이상이어야 시작할 수 있어요.',
  NEED_PLAYERS: '3명 이상이어야 시작할 수 있어요.',
  NOT_ON_BOARD: '내 판에 있는 단어만 부를 수 있어요.',
  ALREADY_CALLED: '이미 불린 단어예요.',
  NOT_BINGO: '아직 빙고가 아니에요.',
  TOO_MANY_CUSTOM: '직접 입력 칸이 너무 많아요.',
  DUPLICATE_WORD: '같은 단어가 두 번 들어갔어요.',
  BOARD_NOT_FULL: '빈 칸을 모두 채워야 준비 완료할 수 있어요.',
  BAD_BOARD: '판 크기가 맞지 않아요.',
  NO_WORDS: '제시어 데이터가 없어요. (DB 스크립트 확인)',
  NOT_YOUR_TURN: '내 차례가 아니에요.',
  WRONG_PHASE: '지금은 할 수 없어요.',
  BAD_TEXT: '글자 수를 확인해 주세요.',
  HAS_WORD: '제시어는 그대로 쓸 수 없어요. 돌려서 말해 보세요.',
  TOO_FAST: '너무 빨라요. 잠깐 쉬었다 보내 주세요.',
  BAD_TARGET: '자기 자신에게는 투표할 수 없어요.',
  NOT_MEMBER: '방에 참가한 사람만 할 수 있어요.',
  CANNOT_APPEAL: '지금은 이의 신청할 수 없어요.',
  ALREADY_APPEALED: '이미 이의 신청했어요.',
  NOT_LIAR: '라이어만 할 수 있어요.',
  MAX_PLAYERS_4: '이 게임은 4명까지 할 수 있어요.',
  OUT: '카드가 없어서 승인할 수 없어요.',
  NOT_PLAYER: '이번 판 참가자가 아니에요.',
  BAD_LAYOUT: '배치가 맞지 않아요. 다시 확인해 주세요.',
  BAD_PUZZLE: '판을 만들지 못했어요. 다시 시작해 주세요.',
  NEED_PLAYERS_EXACT_2: '알까기는 딱 2명이 있어야 시작할 수 있어요.',
  BAD_PLACE: '배치가 맞지 않아요. 내 진영 안에 겹치지 않게 놓아 주세요.',
  BAD_SHOT: '발사가 맞지 않아요. 다시 쏴 주세요.',
  BAD_TIME: '기록이 너무 빨라서 순위에 올릴 수 없어요.',
}

export class ApiError extends Error {}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  await ensureSession()
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    const key = Object.keys(MESSAGES).filter((k) => error.message.includes(k)).sort((x, y) => y.length - x.length)[0]
    if (key) throw new ApiError(MESSAGES[key])
    if (/function .* does not exist|Could not find the function/i.test(error.message)) {
      throw new ApiError('서버 설정이 아직 안 됐어요. (DB 스크립트 미적용)')
    }
    throw new ApiError('연결에 문제가 있어요. 잠시 후 다시 시도해 주세요.')
  }
  return data as T
}

/** 퍼즐 전사 기록 */
export interface PuzzleEntry { name: string; ms: number; at: string; me: boolean }
export interface PuzzleMe { ms: number; name: string | null; hidden: boolean; rank: number }
export interface PuzzleBoard { top: PuzzleEntry[]; me: PuzzleMe | null; better?: boolean }
export type PuzzleGame = 'sudoku' | 'mines'
export type PuzzleLevel = 'easy' | 'normal' | 'hard'

export const api = {
  puzzleTop: (game: PuzzleGame) => rpc<Record<PuzzleLevel, PuzzleBoard>>('puzzle_top', { p_game: game }),
  puzzleSubmit: (game: PuzzleGame, level: PuzzleLevel, ms: number, name: string | null) =>
    rpc<PuzzleBoard>('puzzle_submit', { p_game: game, p_level: level, p_ms: Math.round(ms), p_name: name }),
  puzzleName: (game: PuzzleGame, level: PuzzleLevel, name: string | null) =>
    rpc<PuzzleBoard>('puzzle_name', { p_game: game, p_level: level, p_name: name }),
  createRoom: (game: string) => rpc<string>('create_room', { p_game: game }),
  getRoom: (code: string) => rpc<RoomView | null>('get_room', { p_code: code }),
  joinRoom: (code: string, nickname: string, entryCode?: string) =>
    rpc<void>('join_room', { p_code: code, p_nickname: nickname, p_entry_code: entryCode ?? null }),
  heartbeat: (code: string) => rpc<void>('heartbeat', { p_code: code }),
  leaveRoom: (code: string) => rpc<void>('leave_room', { p_code: code }),
  updateSettings: (code: string, settings: Partial<RoomSettings>) =>
    rpc<void>('update_room_settings', { p_code: code, p_settings: settings }),
  setEntryCode: (code: string, enabled: boolean) =>
    rpc<string | null>('set_entry_code', { p_code: code, p_enabled: enabled }),

  liarStart: (code: string) => rpc<void>('liar_start', { p_code: code }),
  liarState: (code: string) => rpc<LiarState | null>('liar_state', { p_code: code }),
  liarTick: (code: string) => rpc<void>('liar_tick', { p_code: code }),
  liarHint: (code: string, text: string) => rpc<void>('liar_hint', { p_code: code, p_text: text }),
  liarChat: (code: string, text: string) => rpc<void>('liar_chat', { p_code: code, p_text: text }),
  liarReact: (code: string, msg: number, emoji: string) => rpc<void>('liar_react', { p_code: code, p_msg: msg, p_emoji: emoji }),
  liarEndDiscussion: (code: string) => rpc<void>('liar_end_discussion', { p_code: code }),
  liarVote: (code: string, target: string) => rpc<void>('liar_vote', { p_code: code, p_target: target }),
  liarGuess: (code: string, text: string) => rpc<void>('liar_guess', { p_code: code, p_text: text }),
  liarToWaiting: (code: string) => rpc<void>('liar_to_waiting', { p_code: code }),
  bingoStart: (code: string) => rpc<void>('bingo_start', { p_code: code }),
  bingoState: (code: string) => rpc<BingoState | null>('bingo_state', { p_code: code }),
  bingoSetBoard: (code: string, cells: string[], ready: boolean) => rpc<void>('bingo_set_board', { p_code: code, p_cells: cells, p_ready: ready }),
  bingoCall: (code: string, word: string) => rpc<void>('bingo_call', { p_code: code, p_word: word }),
  bingoClaim: (code: string) => rpc<void>('bingo_claim', { p_code: code }),
  bingoTick: (code: string) => rpc<void>('bingo_tick', { p_code: code }),
  bingoChat: (code: string, text: string) => rpc<void>('bingo_chat', { p_code: code, p_text: text }),
  bingoToWaiting: (code: string) => rpc<void>('bingo_to_waiting', { p_code: code }),
  bellStart: (code: string) => rpc<void>('bell_start', { p_code: code }),
  bellState: (code: string) => rpc<BellState | null>('bell_state', { p_code: code }),
  bellFlip: (code: string) => rpc<void>('bell_flip', { p_code: code }),
  bellRing: (code: string, seen: number) => rpc<{ late: boolean; ok?: boolean }>('bell_ring', { p_code: code, p_seen: seen }),
  bellTick: (code: string) => rpc<void>('bell_tick', { p_code: code }),
  bellChat: (code: string, text: string) => rpc<void>('bell_chat', { p_code: code, p_text: text }),
  bellToWaiting: (code: string) => rpc<void>('bell_to_waiting', { p_code: code }),
  shvStart: (code: string, b: { puzzles: unknown[]; answers: number[][] }) => rpc<void>('shv_start', { p_code: code, p_puzzles: b.puzzles, p_answers: b.answers }),
  shvSkip: (code: string, round: number, vote: boolean) => rpc<void>('shv_skip', { p_code: code, p_round: round, p_vote: vote }),
  shvState: (code: string) => rpc<ShvState | null>('shv_state', { p_code: code }),
  shvProgress: (code: string, round: number, filled: number[], placed: number) => rpc<void>('shv_progress', { p_code: code, p_round: round, p_filled: filled, p_placed: placed }),
  shvDone: (code: string, round: number, occ: number[]) => rpc<{ ok: boolean; late?: boolean; ms?: number }>('shv_done', { p_code: code, p_round: round, p_occ: occ }),
  shvTick: (code: string) => rpc<void>('shv_tick', { p_code: code }),
  shvChat: (code: string, text: string) => rpc<void>('shv_chat', { p_code: code, p_text: text }),
  shvToWaiting: (code: string) => rpc<void>('shv_to_waiting', { p_code: code }),
  cbvStart: (code: string, b: { puzzles: unknown[]; answers: number[][] }) => rpc<void>('cbv_start', { p_code: code, p_puzzles: b.puzzles, p_answers: b.answers }),
  cbvState: (code: string) => rpc<CbvState | null>('cbv_state', { p_code: code }),
  cbvProgress: (code: string, round: number, pcs: number) => rpc<void>('cbv_progress', { p_code: code, p_round: round, p_pcs: pcs }),
  cbvDone: (code: string, round: number, cells: number[]) => rpc<{ ok: boolean; late?: boolean; ms?: number }>('cbv_done', { p_code: code, p_round: round, p_cells: cells }),
  cbvTick: (code: string) => rpc<void>('cbv_tick', { p_code: code }),
  cbvSkip: (code: string, round: number, vote: boolean) => rpc<void>('cbv_skip', { p_code: code, p_round: round, p_vote: vote }),
  cbvChat: (code: string, text: string) => rpc<void>('cbv_chat', { p_code: code, p_text: text }),
  cbvToWaiting: (code: string) => rpc<void>('cbv_to_waiting', { p_code: code }),
  lkvStart: (code: string, b: { puzzles: unknown[]; answers: number[][][] }) => rpc<void>('lkv_start', { p_code: code, p_puzzles: b.puzzles, p_answers: b.answers }),
  lkvState: (code: string) => rpc<LkvState | null>('lkv_state', { p_code: code }),
  lkvProgress: (code: string, round: number, linked: number, pct: number) => rpc<void>('lkv_progress', { p_code: code, p_round: round, p_linked: linked, p_pct: pct }),
  lkvDone: (code: string, round: number, paths: number[][]) => rpc<{ ok: boolean; late?: boolean; ms?: number }>('lkv_done', { p_code: code, p_round: round, p_paths: paths }),
  lkvTick: (code: string) => rpc<void>('lkv_tick', { p_code: code }),
  lkvSkip: (code: string, round: number, vote: boolean) => rpc<void>('lkv_skip', { p_code: code, p_round: round, p_vote: vote }),
  lkvChat: (code: string, text: string) => rpc<void>('lkv_chat', { p_code: code, p_text: text }),
  lkvToWaiting: (code: string) => rpc<void>('lkv_to_waiting', { p_code: code }),
  alkStart: (code: string) => rpc<void>('alk_start', { p_code: code }),
  alkState: (code: string) => rpc<AlkState | null>('alk_state', { p_code: code }),
  alkPlace: (code: string, round: number, pos: [number, number][], done: boolean) => rpc<void>('alk_place', { p_code: code, p_round: round, p_pos: pos, p_done: done }),
  alkShoot: (code: string, seq: number, stone: number, vx: number, vy: number, after: unknown[]) =>
    rpc<{ ok: boolean; late?: boolean; knocked?: number; lost?: number }>('alk_shoot', { p_code: code, p_seq: seq, p_stone: stone, p_vx: vx, p_vy: vy, p_after: after }),
  alkTick: (code: string) => rpc<void>('alk_tick', { p_code: code }),
  alkResign: (code: string) => rpc<void>('alk_resign', { p_code: code }),
  alkChat: (code: string, text: string) => rpc<void>('alk_chat', { p_code: code, p_text: text }),
  alkToWaiting: (code: string) => rpc<void>('alk_to_waiting', { p_code: code }),
  liarAppeal: (code: string) => rpc<void>('liar_appeal', { p_code: code }),
  liarAppealVote: (code: string, accept: boolean) => rpc<void>('liar_appeal_vote', { p_code: code, p_accept: accept }),
}
