import { useEffect, useRef, useState } from 'react'
import SiteHeader, { SiteFoot } from './SiteHeader'
import { CATS, TAGS, candidates, history, markAte, randomPick, todayPick, type Cat, type Menu, type Tag } from './lunch'

export default function LunchPage() {
  const [cats, setCats] = useState<Cat[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [pick, setPick] = useState<Menu>(todayPick)
  const [rolling, setRolling] = useState(false)
  const [hist, setHist] = useState(history)
  const [toast, setToast] = useState('')
  const timer = useRef<number>()
  const list = candidates(cats, tags)

  useEffect(() => { document.title = '점심 추천 — 탕비실' }, [])
  useEffect(() => () => window.clearInterval(timer.current), [])

  const toggle = <T,>(arr: T[], x: T) => (arr.includes(x) ? arr.filter((a) => a !== x) : [...arr, x])

  const roll = () => {
    if (rolling || list.length === 0) return
    setRolling(true)
    let n = 0
    window.clearInterval(timer.current)
    timer.current = window.setInterval(() => {
      n++
      setPick((p) => randomPick(list, p.name))
      if (n >= 12) { window.clearInterval(timer.current); setRolling(false) }
    }, 70)
  }
  const ate = () => {
    markAte(pick.name)
    setHist(history())
    setToast(`${pick.name} 맛있게 드세요! 3일 동안은 추천에서 빼 둘게요`)
    setTimeout(() => setToast(''), 2400)
  }

  return (
    <div className="ts-page">
      <SiteHeader />
      <main className="ts-in ts-narrow">
        <div className="ts-ptitle"><h1>🍱 점심 추천</h1><small>오늘 뭐 먹지? 조건을 고르고 뽑기 버튼을 눌러요</small></div>

        <section className="ts-card">
          <div className="ts-frow"><b>종류</b><div className="ts-chips">
            <button className={cats.length === 0 ? 'on' : ''} onClick={() => setCats([])}>전부</button>
            {CATS.map((c) => <button key={c} className={cats.includes(c) ? 'on' : ''} onClick={() => setCats(toggle(cats, c))}>{c}</button>)}
          </div></div>
          <div className="ts-frow"><b>오늘은</b><div className="ts-chips">
            {TAGS.map((t) => <button key={t} className={tags.includes(t) ? 'on' : ''} onClick={() => setTags(toggle(tags, t))}>{t}</button>)}
          </div></div>
        </section>

        <section className={'ts-card ts-lmain' + (rolling ? ' rolling' : '')}>
          {list.length === 0 ? (
            <p className="ts-mut">조건에 맞는 메뉴가 없어요. 조건을 하나 빼 보세요.</p>
          ) : (
            <>
              <span className="ts-lemoji ts-huge">{pick.emoji}</span>
              <b className="ts-lname">{pick.name}</b>
              <small>{pick.cat} · {pick.tags.join(' · ')}</small>
              <p>{rolling ? '두구두구…' : pick.say}</p>
              <div className="ts-lbtns">
                <button className="ts-btn ts-big" onClick={roll} disabled={rolling}>🎲 {rolling ? '뽑는 중' : '뽑기'}</button>
                <button className="ts-btn ts-o ts-big" onClick={ate} disabled={rolling}>✔ 이걸로 먹을래요</button>
              </div>
              <small className="ts-mut">후보 {list.length}개 · 최근 3일 안에 먹은 메뉴는 빼고 골라요</small>
            </>
          )}
        </section>

        <details className="ts-card ts-fold">
          <summary><h3>후보 메뉴 <small>{list.length}개</small></h3><span className="ts-fold-i">펼치기</span></summary>
          <div className="ts-cands">{list.map((m) => <button key={m.name} className={m.name === pick.name ? 'on' : ''} onClick={() => setPick(m)}>{m.emoji} {m.name}</button>)}</div>
        </details>

        {hist.length > 0 && (
          <section className="ts-card">
            <h3>최근에 먹은 메뉴</h3>
            <ul className="ts-hist">{hist.slice(0, 7).map((h) => <li key={h.day}><span>{h.day.slice(5).replace('-', '/')}</span>{h.name}</li>)}</ul>
          </section>
        )}
      </main>
      {toast && <div className="st-toast">{toast}</div>}
      <SiteFoot />
    </div>
  )
}
