import { NavLink, Link } from 'react-router-dom'
import './site.css'

const NAV = [
  { to: '/status', label: '상태창', icon: '🕒' },
  { to: '/games', label: '게임', icon: '🎮' },
  { to: '/fortune', label: '운세', icon: '🔮' },
  { to: '/lunch', label: '점심 추천', icon: '🍱' },
]

/** 탕비실 공통 머리글 */
export default function SiteHeader() {
  return (
    <header className="ts-head">
      <div className="ts-in ts-head-in">
        <Link to="/" className="ts-logo">☕ 탕비실</Link>
        <nav className="ts-nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'on' : '')}>
              <span className="ts-ni">{n.icon}</span>{n.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  )
}

export function SiteFoot() {
  return (
    <footer className="ts-foot">
      <div className="ts-in">☕ 탕비실 · 일하다 잠깐 쉬어 가는 곳 · 개인 설정은 모두 이 브라우저에만 저장돼요</div>
    </footer>
  )
}
