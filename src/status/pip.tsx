import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStatus } from './settings'
import Widget, { MiniBar } from './Widget'

/** win 의 타이머로 1초마다 갱신 (메인 탭이 가려져도 작은 창 시계는 계속 돌게) */
export function useNow(win: Window = window) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = win.setInterval(() => setNow(new Date()), 1000)
    return () => win.clearInterval(id)
  }, [win])
  return now
}

const FULL = { width: 340, height: 500 }
const BAR = { width: 520, height: 64 }

declare global {
  interface Window {
    documentPictureInPicture?: { requestWindow(o: { width: number; height: number }): Promise<Window>; window: Window | null }
  }
}

export const pipSupported = () => typeof window !== 'undefined' && 'documentPictureInPicture' in window

function copyStyles(to: Document) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules).map((r) => r.cssText).join('\n')
      const st = to.createElement('style')
      st.textContent = css
      to.head.appendChild(st)
    } catch {
      if (sheet.href) {
        const l = to.createElement('link')
        l.rel = 'stylesheet'
        l.href = sheet.href
        to.head.appendChild(l)
      }
    }
  }
}

/** 항상 위 작은 창 (Document Picture-in-Picture). 지원 안 하는 브라우저는 일반 팝업 창 */
export function usePip() {
  const [win, setWin] = useState<Window | null>(null)

  const open = useCallback(async (bar = false) => {
    const dpip = window.documentPictureInPicture
    if (!dpip) {
      window.open('/status?popup=1', 'tbs-status', `popup,width=${FULL.width},height=${FULL.height + 40}`)
      return
    }
    if (dpip.window) { dpip.window.focus(); return }
    const w = await dpip.requestWindow(bar ? BAR : FULL)
    copyStyles(w.document)
    w.document.title = '탕비실 상태창'
    w.document.body.className = 'st-pipbody'
    w.addEventListener('pagehide', () => setWin(null))
    setWin(w)
  }, [])

  return { win, open }
}

/** 작은 창 안의 내용 (메인 창의 React 트리를 그대로 portal 로 그림) */
export function PipPortal({ win, onNav, onSettings }: { win: Window; onNav: (p: string) => void; onSettings: () => void }) {
  return createPortal(<PipBody win={win} onNav={onNav} onSettings={onSettings} />, win.document.body)
}

function PipBody({ win, onNav, onSettings }: { win: Window; onNav: (p: string) => void; onSettings: () => void }) {
  const [s, update] = useStatus()
  const now = useNow(win)
  const [bar, setBar] = useState(win.innerHeight < 120)
  const last = useRef(0)

  // Esc 두 번 → 들키지 않게 윈도우 위젯 + 금액 가리기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = Date.now()
      if (t - last.current < 500) { update({ skin: 'widget', hideMoney: true }); last.current = 0 } else last.current = t
    }
    win.addEventListener('keydown', onKey)
    return () => win.removeEventListener('keydown', onKey)
  }, [win, update])

  useEffect(() => { win.document.body.dataset.skin = bar ? 'bar' : s.skin }, [win, s.skin, bar])

  const resize = (b: boolean) => {
    setBar(b)
    const sz = b ? BAR : FULL
    try { win.resizeTo(sz.width, sz.height) } catch { /* 브라우저가 막으면 그대로 */ }
  }
  const nav = (p: string) => { window.focus(); onNav(p) }

  return bar
    ? <MiniBar s={s} update={update} now={now} onExpand={() => resize(false)} />
    : <Widget s={s} update={update} now={now} onBar={() => resize(true)} onNav={nav} onSettings={() => { window.focus(); onSettings() }} />
}
