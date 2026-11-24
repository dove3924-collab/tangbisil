import { createContext, useContext } from 'react'
import type { EvId } from './data'
import type { FrState } from './state'

export interface Game {
  s: FrState
  up: (fn: (d: FrState) => void) => void
  /** 'mail', 'explorer:pc', 'file:report' 처럼 열기 */
  open: (what: string) => void
  saveEv: (id: EvId) => void
  toast: (text: string, onClick?: () => void) => void
  alert: (title: string, text: string) => void
  openPhone: () => void
}
export const GameCtx = createContext<Game | null>(null)
export const useGame = () => {
  const g = useContext(GameCtx)
  if (!g) throw new Error('GameCtx 없음')
  return g
}
