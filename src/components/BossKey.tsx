import { useEffect, useRef, useState, type ReactNode } from 'react'
import BossScreen from './BossScreen'

const DOUBLE_PRESS_MS = 500

/** Esc 두 번 → 업무 화면으로 덮기. 게임은 언마운트하지 않고 뒤에서 계속 돈다. */
export default function BossKey({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false)
  const last = useRef(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const now = Date.now()
      if (now - last.current < DOUBLE_PRESS_MS) {
        setHidden((h) => !h)
        last.current = 0
      } else {
        last.current = now
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <div style={hidden ? { display: 'none' } : undefined} aria-hidden={hidden}>
        {children}
      </div>
      {hidden && <BossScreen />}
    </>
  )
}
