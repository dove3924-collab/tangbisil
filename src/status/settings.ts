import { useCallback, useEffect, useState } from 'react'

export type Skin = 'widget' | 'rpg' | 'stock' | 'badge'
export type Field = 'end' | 'pay' | 'payday' | 'leave' | 'name'
export type Onboard = 1 | 2 | 3 | 'done' | 'closed'

export const SKINS: { id: Skin; label: string }[] = [
  { id: 'widget', label: '윈도우 위젯' },
  { id: 'rpg', label: '픽셀 RPG' },
  { id: 'stock', label: '주식 앱' },
  { id: 'badge', label: '사원증' },
]

export interface StatusSettings {
  name: string
  start: string // 'HH:MM'
  end: string
  lunchStart: string
  lunchEnd: string
  workDays: number[] // 0=일 … 6=토
  /** 한 달 실수령(원). null = 안 알려줌 */
  pay: number | null
  /** 1~31, 0 = 말일 */
  payday: number
  leaveTotal: number
  leaveUsed: number
  joinDate: string // 'YYYY-MM-DD' 또는 ''
  skin: Skin
  /** 돈 숫자 가리기 */
  hideMoney: boolean
  /** 사용자가 직접 정한 항목 (없으면 '기본값' 표시) */
  set: Partial<Record<Field, true>>
  onboard: Onboard
}

export const DEFAULTS: StatusSettings = {
  name: '익명의 사원',
  start: '09:00',
  end: '18:00',
  lunchStart: '12:00',
  lunchEnd: '13:00',
  workDays: [1, 2, 3, 4, 5],
  pay: 3_000_000,
  payday: 25,
  leaveTotal: 15,
  leaveUsed: 0,
  joinDate: '',
  skin: 'widget',
  hideMoney: false,
  set: {},
  onboard: 1,
}

const KEY = 'tbs.status'
const EVT = 'tbs-status'

function load(): StatusSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch { /* 저장소 막힘 */ }
  return DEFAULTS
}

/** 상태창 설정. 브라우저(localStorage)에만 저장하고, 탭·창 사이에 바로 동기화 */
export function useStatus(): [StatusSettings, (patch: Partial<StatusSettings>) => void] {
  const [s, setS] = useState<StatusSettings>(load)

  useEffect(() => {
    const sync = () => setS(load())
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) sync() }
    window.addEventListener(EVT, sync)
    window.addEventListener('storage', onStorage)
    return () => { window.removeEventListener(EVT, sync); window.removeEventListener('storage', onStorage) }
  }, [])

  const update = useCallback((patch: Partial<StatusSettings>) => {
    const next = { ...load(), ...patch }
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* 무시 */ }
    setS(next)
    window.dispatchEvent(new Event(EVT))
  }, [])

  return [s, update]
}
