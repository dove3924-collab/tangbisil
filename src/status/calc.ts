import type { StatusSettings } from './settings'

export type Phase = 'before' | 'work' | 'lunch' | 'after' | 'off'

export interface View {
  phase: Phase
  /** 퇴근까지 남은 초 (출근 전이면 근무시간 전체) */
  remainSec: number
  /** 0~1 */
  progress: number
  /** 오늘 일한 초 (점심 제외) */
  workedSec: number
  /** 오늘 번 돈 / 이번 달 번 돈 (pay 없으면 null) */
  earned: number | null
  monthEarned: number | null
  perSec: number | null
  paydayD: number
  weekendD: number // 0 = 주말
  leaveLeft: number
  joinDays: number | null
}

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** 하루 실근무 분 (점심 제외) */
function workMinutes(s: StatusSettings) {
  const a = toMin(s.start), b = toMin(s.end)
  return Math.max(1, b - a - overlap(a, b, toMin(s.lunchStart), toMin(s.lunchEnd)))
}

function workDaysInMonth(y: number, m: number, days: number[]) {
  const last = new Date(y, m + 1, 0).getDate()
  let n = 0
  for (let d = 1; d <= last; d++) if (days.includes(new Date(y, m, d).getDay())) n++
  return Math.max(1, n)
}

/** 해당 달의 월급날 (주말이면 앞의 금요일로) */
function paydayOf(y: number, m: number, payday: number) {
  const last = new Date(y, m + 1, 0).getDate()
  const d = new Date(y, m, payday === 0 ? last : Math.min(payday, last))
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1)
  return d
}

export function compute(s: StatusSettings, now: Date): View {
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60
  const a = toMin(s.start), b = Math.max(toMin(s.end), a + 1)
  const ls = toMin(s.lunchStart), le = toMin(s.lunchEnd)
  const total = workMinutes(s)
  const isWorkDay = s.workDays.includes(now.getDay())

  let phase: Phase
  if (!isWorkDay) phase = 'off'
  else if (nowMin < a) phase = 'before'
  else if (nowMin >= b) phase = 'after'
  else if (nowMin >= ls && nowMin < le) phase = 'lunch'
  else phase = 'work'

  const workedMin = phase === 'off' ? 0
    : Math.max(0, Math.min(nowMin, b) - a - overlap(a, Math.min(nowMin, b), ls, le))
  const remainSec = phase === 'off' || phase === 'after' ? 0 : Math.round((b - Math.max(nowMin, a)) * 60)
  const progress = phase === 'off' ? 0 : Math.min(1, workedMin / total)

  const y = now.getFullYear(), m = now.getMonth()
  let earned: number | null = null, monthEarned: number | null = null, perSec: number | null = null
  if (s.pay != null) {
    const daily = s.pay / workDaysInMonth(y, m, s.workDays)
    perSec = daily / (total * 60)
    earned = Math.floor(workedMin * 60 * perSec)
    let done = 0
    for (let d = 1; d < now.getDate(); d++) if (s.workDays.includes(new Date(y, m, d).getDay())) done++
    monthEarned = Math.floor(done * daily) + earned
  }

  const today = dayStart(now)
  let pd = paydayOf(y, m, s.payday)
  if (pd < today) pd = paydayOf(y, m + 1, s.payday)
  const paydayD = Math.round((pd.getTime() - today.getTime()) / 86400000)

  const dow = now.getDay()
  const weekendD = dow === 0 || dow === 6 ? 0 : 6 - dow

  let joinDays: number | null = null
  if (s.joinDate) {
    const j = new Date(s.joinDate + 'T00:00:00')
    if (!isNaN(j.getTime())) joinDays = Math.round((today.getTime() - j.getTime()) / 86400000) + 1
  }

  return {
    phase, remainSec, progress, workedSec: Math.round(workedMin * 60),
    earned, monthEarned, perSec, paydayD, weekendD,
    leaveLeft: Math.max(0, s.leaveTotal - s.leaveUsed), joinDays,
  }
}

export const hms = (sec: number) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`
}
export const won = (n: number) => '₩' + n.toLocaleString('ko-KR')
export const dday = (d: number) => (d === 0 ? 'D-DAY' : `D-${d}`)
export const fmtDays = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}일`
export const endLabel = (s: StatusSettings) => s.end

export const PHASE_LABEL: Record<Phase, string> = {
  before: '출근 전', work: '근무 중', lunch: '점심시간', after: '퇴근 완료', off: '쉬는 날',
}
