import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import SiteHeader, { SiteFoot } from './SiteHeader'
import { useStatus } from '../status/settings'
import { useNow } from '../status/pip'
import { compute, dday, fmtDays, hms, won } from '../status/calc'
import { GAMES } from '../lib/games'
import { fortuneFor, stars } from './fortune'
import { candidates, randomPick, todayPick } from './lunch'
import { lsGet } from './rand'
import '../status/status.css'

const PICK_GAMES = ['liar', 'bell', 'alkkagi', 'mines', 'sudoku', 'escape']
const GAME_ICON: Record<string, string> = { liar: '🕵️', bell: '🔔', alkkagi: '⚫', mines: '💣', sudoku: '🔢', escape: '🚪' }

export default function Home() {
  const nav = useNavigate()
  const [s, update] = useStatus()
  const v = compute(s, useNow())
  const birth = lsGet<string>('tbs.fortune.birth', '')
  const f = fortuneFor(birth)
  const [lunch, setLunch] = useState(todayPick)
  const games = PICK_GAMES.map((id) => GAMES.find((g) => g.id === id)).filter(Boolean)

  useEffect(() => { document.title = '탕비실 — 일하다 잠깐 쉬어 가는 곳' }, [])

  const left = v.phase === 'after' ? '퇴근 완료 🎉' : v.phase === 'off' ? '오늘은 쉬는 날' : hms(v.remainSec)
  const isDefault = !s.set.end && !s.set.pay

  return (
    <div className="ts-page">
      <SiteHeader />
      <main className="ts-in">
        <section className="ts-hero">
          <div className="ts-hello">
            <h1>오늘도 출근하셨군요 ☕</h1>
            <p>퇴근까지 남은 시간 보면서<br />잠깐 게임 한 판, 운세 한 줄, 점심 고민까지.</p>
          </div>

          <div className="ts-stat">
            <div className="ts-stat-main">
              <small>{v.phase === 'after' || v.phase === 'off' ? '오늘' : `퇴근까지 · ${s.end}`}</small>
              <b className="st-num">{left}</b>
              <div className="ts-prog"><i style={{ width: `${v.progress * 100}%` }} /></div>
            </div>
            <div className="ts-stat-cells">
              <div><small>오늘 번 돈 {s.pay != null && <button className="ts-eye" title={s.hideMoney ? '금액 보이기' : '금액 가리기'} onClick={() => update({ hideMoney: !s.hideMoney })}>{s.hideMoney ? '🙈' : '👁'}</button>}</small>
                <b className="st-num">{s.pay == null ? `${Math.floor(v.workedSec / 3600)}시간째` : s.hideMoney ? '₩ ••••••' : won(v.earned ?? 0)}</b></div>
              <div><small>월급날</small><b>{dday(v.paydayD)}</b></div>
              <div><small>주말까지</small><b>{v.weekendD === 0 ? '주말 🎉' : `${v.weekendD}일`}</b></div>
              <div><small>남은 연차</small><b>{fmtDays(v.leaveLeft)}</b></div>
            </div>
            <div className="ts-stat-foot">
              {isDefault ? <span>지금은 기본값(9–18시·월 300만 원)이에요</span> : <span>{s.name}님의 상태창</span>}
              <Link to="/status" className="ts-btn">{isDefault ? '내 상태창 만들기 ›' : '📌 상태창 띄우기 ›'}</Link>
            </div>
          </div>
        </section>

        <section className="ts-cats">
          <article className="ts-cat ts-cat-game">
            <div className="ts-cat-h"><span className="ts-cat-i">🎮</span><div><h2>게임</h2><small>회사에서 몰래 하는 게임 {GAMES.filter((g) => g.playable).length}개</small></div></div>
            <ul className="ts-glist">
              {games.map((g) => g && (
                <li key={g.id}><Link to="/games"><span>{GAME_ICON[g.id]}</span><b>{g.title}</b><small>{g.players}</small></Link></li>
              ))}
            </ul>
            <Link to="/games" className="ts-more">게임 전체 보기 ›</Link>
          </article>

          <article className="ts-cat ts-cat-fortune">
            <div className="ts-cat-h"><span className="ts-cat-i">🔮</span><div><h2>오늘의 운세</h2><small>{birth ? '내 생일 기준' : '직장인 운세'}</small></div></div>
            <div className="ts-fstar">{stars(f.score)}</div>
            <p className="ts-fhead">{f.head}</p>
            <ul className="ts-frows">
              {f.areas.map((a) => <li key={a.name}><span>{a.name}</span><b>{stars(a.score)}</b></li>)}
            </ul>
            <Link to="/fortune" className="ts-more">내 운세 자세히 ›</Link>
          </article>

          <article className="ts-cat ts-cat-lunch">
            <div className="ts-cat-h"><span className="ts-cat-i">🍱</span><div><h2>오늘 점심</h2><small>고민은 탕비실이 대신</small></div></div>
            <div className="ts-lpick">
              <span className="ts-lemoji">{lunch.emoji}</span>
              <b>{lunch.name}</b>
              <small>{lunch.cat} · {lunch.say}</small>
            </div>
            <div className="ts-lbtns">
              <button className="ts-btn ts-o" onClick={() => setLunch(randomPick(candidates([], []), lunch.name))}>🎲 다른 거</button>
              <button className="ts-btn" onClick={() => nav('/lunch')}>조건 걸고 고르기</button>
            </div>
            <Link to="/lunch" className="ts-more">점심 고르기 ›</Link>
          </article>
        </section>
      </main>
      <SiteFoot />
    </div>
  )
}
