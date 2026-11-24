/** 영단어 야구 규칙: 5글자 영단어를 맞힐 때까지. 정규 9회, 넘기면 연장전. S = 위치·글자 일치, B = 글자만 일치, O = 아웃 */
export type Mark = 'S' | 'B' | 'O'
export const LEN = 5
export const REGULAR = 9 // 정규 이닝

/** 같은 글자가 여러 번이면 정답에 있는 개수만큼만: 스트라이크를 먼저 세고 남은 개수로 볼 */
export function judge(guess: string, answer: string): Mark[] {
  const res: Mark[] = Array(LEN).fill('O')
  const left: Record<string, number> = {}
  for (let i = 0; i < LEN; i++) {
    if (guess[i] === answer[i]) res[i] = 'S'
    else left[answer[i]] = (left[answer[i]] ?? 0) + 1
  }
  for (let i = 0; i < LEN; i++) {
    if (res[i] !== 'S' && left[guess[i]]) { res[i] = 'B'; left[guess[i]]-- }
  }
  return res
}

/** "2S 1B" · "3S" · "OUT" · 다 맞으면 "5S ⚾" */
export function summary(marks: Mark[]) {
  const s = marks.filter((m) => m === 'S').length
  const b = marks.filter((m) => m === 'B').length
  if (s === LEN) return '5S ⚾'
  if (!s && !b) return 'OUT'
  return [s && `${s}S`, b && `${b}B`].filter(Boolean).join(' ')
}

/** 글자별 가장 좋은 판정 (S > B > O) — 아래 알파벳 표 색칠용 */
export function letterStates(guesses: string[], answer: string) {
  const rank: Record<Mark, number> = { O: 1, B: 2, S: 3 }
  const out: Record<string, Mark> = {}
  for (const g of guesses) {
    judge(g, answer).forEach((m, i) => {
      const c = g[i]
      if (!out[c] || rank[m] > rank[out[c]]) out[c] = m
    })
  }
  return out
}

export const splitWords = (packed: string) => {
  const out: string[] = []
  for (let i = 0; i < packed.length; i += LEN) out.push(packed.slice(i, i + LEN))
  return out
}

/** 내 컴퓨터 날짜 기준 하루 번호 (2026-01-01 = 0) */
export function dayIndex(d = new Date()) {
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2026, 0, 1)) / 86400000)
}
export const dayLabel = (d = new Date()) => `${d.getMonth() + 1}/${d.getDate()}`
export const dateText = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 오늘의 단어: 고정 시드로 섞은 정답 목록을 하루에 하나씩 → 모두에게 같은 단어, 목록을 다 돌기 전엔 반복 없음 */
export function dailyAnswer(answers: string[], day: number) {
  const order = answers.map((_, i) => i)
  const rnd = mulberry32(20261112)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]]
  }
  const n = order.length
  return answers[order[((day % n) + n) % n]]
}

export function randomAnswer(answers: string[], not?: string) {
  let w = answers[Math.floor(Math.random() * answers.length)]
  if (w === not && answers.length > 1) w = answers[(answers.indexOf(w) + 1) % answers.length]
  return w
}

/** "7회" · "연장 12회" */
export const inningText = (tries: number) => (tries <= REGULAR ? `${tries}회` : `연장 ${tries}회`)

/** 공유 텍스트: 몇 이닝 만에 맞혔는지만 (정답·색 없음) */
export function shareText(title: string, tries: number) {
  return `영단어 야구 ${title} · ${inningText(tries)} 성공 ⚾\n${location.origin}/wordball`
}
