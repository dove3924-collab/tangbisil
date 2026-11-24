import { useEffect } from 'react'

const BASE_ICON = '/favicon.svg'
// 기본 아이콘(초록 시트) + 오른쪽 위 빨간 점
const DOT_ICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="2" y="3" width="28" height="26" rx="3" fill="#1e6b43"/>'
  + '<path d="M2 11h28M2 18h28M12 3v26M21 3v26" stroke="#fff" stroke-width="1.6" opacity=".85"/>'
  + '<circle cx="25" cy="7" r="7" fill="#e5322d" stroke="#fff" stroke-width="2"/></svg>',
)

/**
 * 내 차례인데 다른 탭·다른 창을 보고 있으면 탭 제목 앞에 "(1)", 탭 아이콘에 빨간 점.
 * 이 화면으로 돌아오거나 차례가 끝나면 바로 원래대로. (소리는 회사라 안 냄)
 */
export function useTurnAlert(active: boolean) {
  useEffect(() => {
    if (!active) return
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
    const baseTitle = document.title.replace(/^\(1\) /, '')
    const set = (on: boolean) => {
      document.title = on ? `(1) ${baseTitle}` : baseTitle
      if (link) link.href = on ? DOT_ICON : BASE_ICON
    }
    const sync = () => set(document.hidden || !document.hasFocus())
    sync()
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    window.addEventListener('blur', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
      window.removeEventListener('blur', sync)
      set(false)
    }
  }, [active])
}
