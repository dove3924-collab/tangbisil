import { useEffect, useRef, useState } from 'react'

/** 1:52.3 */
export const fmtMs = (ms: number) => {
  const s = Math.max(0, ms) / 1000
  const m = Math.floor(s / 60)
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`
}

/** 엑셀 열 이름 (0 → A, 26 → AA) */
export const colName = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)))

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return } catch { /* 아래로 */ }
  const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select()
  try { document.execCommand('copy') } catch { /* 무시 */ }
  ta.remove()
}

/** 보스 화면이거나 다른 탭을 보고 있으면 "자리 비움" */
export const isAway = () => document.hidden || !!document.querySelector('.boss')

/**
 * 스톱워치: running 동안만 흐르고, 보스 화면·다른 탭에 있는 동안은 멈춘다.
 * extraPaused 가 true 면 (일시정지 버튼) 역시 멈춤.
 */
export function useStopwatch(running: boolean, extraPaused = false) {
  const [elapsed, setElapsed] = useState(0)
  const [away, setAway] = useState(false)
  const last = useRef(performance.now())
  useEffect(() => {
    last.current = performance.now()
    if (!running) return
    const iv = window.setInterval(() => {
      const now = performance.now()
      const delta = now - last.current // 갱신 함수 안에서 읽으면 이미 바뀐 값이라 미리 계산
      last.current = now
      const a = isAway()
      setAway(a)
      if (!a && !extraPaused) setElapsed((e) => e + delta)
    }, 100)
    return () => window.clearInterval(iv)
  }, [running, extraPaused])
  return { elapsed, setElapsed, away }
}

/** 레벨별 최고 기록 등 (브라우저 저장) */
export function loadJSON<T>(key: string, fallback: T): T {
  try { const v = JSON.parse(localStorage.getItem(key) ?? 'null'); return v ?? fallback } catch { return fallback }
}
export function saveJSON(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* 무시 */ } }
