/**
 * Google Analytics 4. 본서버(production) 빌드에서만 데이터를 보낸다.
 * 테스트 서버(Preview)·로컬에서는 아무것도 보내지 않아 통계가 섞이지 않는다.
 * 닉네임이 들어가는 주소 뒤 ?n=… 같은 값과 방 코드는 보내지 않는다.
 */
// 탕비실 전용 GA 속성은 아직 없음 (월루 통계와 섞이지 않게 비워 둠). 만들면 ID 를 넣을 것
const GA_ID = ''
const enabled = !!GA_ID && !__PREVIEW__ && typeof window !== 'undefined'

type Gtag = (...args: unknown[]) => void
declare global { interface Window { dataLayer?: unknown[]; gtag?: Gtag } }

export function initAnalytics() {
  if (!enabled || window.gtag) return
  window.dataLayer = window.dataLayer || []
  window.gtag = function gtag() { window.dataLayer!.push(arguments) } // eslint-disable-line prefer-rest-params
  window.gtag('js', new Date())
  window.gtag('config', GA_ID, { send_page_view: false }) // 페이지 이동은 직접 보낸다 (SPA)
  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
  document.head.appendChild(s)
}

/** 주소를 화면 단위로 묶는다: /r/K7Q2 → /r/:code, 쿼리(닉네임 등)는 버림 */
function cleanPath(pathname: string) {
  return pathname.replace(/^\/r\/[^/]+/, '/r/:code')
}
const PAGE_TITLE: Record<string, string> = {
  '/': '홈', '/games': '게임 목록', '/status': '상태창', '/fortune': '운세', '/lunch': '점심', '/r/:code': '게임 방', '/escape': '야근 탈출', '/escape/result': '야근 탈출 결과 공유',
  '/workshop': '워크숍 조난기', '/workshop/result': '워크숍 조난기 결과 공유', '/wordball': '영단어 야구', '/mines': '지뢰찾기', '/sudoku': '스도쿠', '/framed': '누명 탈출', '/framed/result': '누명 탈출 결과 공유',
}

export function trackPage(pathname: string) {
  if (!enabled || !window.gtag) return
  const path = cleanPath(pathname)
  window.gtag('event', 'page_view', { page_path: path, page_location: location.origin + path, page_title: PAGE_TITLE[path] ?? path })
}

export function track(event: string, params: Record<string, string | number | boolean> = {}) {
  if (!enabled || !window.gtag) return
  window.gtag('event', event, params)
}
