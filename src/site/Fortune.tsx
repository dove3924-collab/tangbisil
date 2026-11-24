import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import SiteHeader, { SiteFoot } from './SiteHeader'
import { fortuneFor, stars, zodiacLines, zodiacOf, ZODIAC, ZODIAC_EMOJI } from './fortune'
import { lsGet, lsSet } from './rand'

export default function FortunePage() {
  const [birth, setBirth] = useState(() => lsGet<string>('tbs.fortune.birth', ''))
  const [copied, setCopied] = useState(false)
  const f = fortuneFor(birth)
  const zs = zodiacLines()
  const my = birth ? zodiacOf(Number(birth.slice(0, 4))) : -1
  const d = new Date()

  useEffect(() => { document.title = '오늘의 직장 운세 — 탕비실' }, [])

  const save = (b: string) => { setBirth(b); lsSet('tbs.fortune.birth', b) }
  const copy = async () => {
    const text = `🔮 오늘의 직장 운세 ${stars(f.score)}\n${f.head}\n${f.areas.map((a) => `${a.name} ${stars(a.score)}`).join('\n')}\n행운의 점심: ${f.lunch}\n— 탕비실 ${location.origin}/fortune`
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* 무시 */ }
  }

  return (
    <div className="ts-page">
      <SiteHeader />
      <main className="ts-in ts-narrow">
        <div className="ts-ptitle"><h1>🔮 오늘의 직장 운세</h1><small>{d.getMonth() + 1}월 {d.getDate()}일 {'일월화수목금토'[d.getDay()]}요일</small></div>

        <section className="ts-card ts-birth">
          <label>생년월일
            <input type="date" value={birth} max="2015-12-31" onChange={(e) => save(e.target.value)} />
          </label>
          <small>{birth ? `${ZODIAC_EMOJI[my]} ${ZODIAC[my]}띠 · 이 브라우저에만 저장돼요` : '넣으면 나만의 운세가 나와요. 안 넣어도 매일 바뀌어요.'}</small>
          {birth && <button className="ts-link" onClick={() => save('')}>지우기</button>}
        </section>

        <section className="ts-card ts-fmain">
          <div className="ts-fstar ts-big">{stars(f.score)}</div>
          <p className="ts-fhead ts-big">{f.head}</p>
          <div className="ts-areas">
            {f.areas.map((a) => (
              <div key={a.name} className="ts-area">
                <div><b>{a.name}</b><span className="ts-fstar">{stars(a.score)}</span></div>
                <p>{a.text}</p>
              </div>
            ))}
          </div>
          <h3>오늘의 행운</h3>
          <div className="ts-lucky">
            <div><small>행운의 색</small><b><i style={{ background: f.color.hex }} />{f.color.name}</b></div>
            <div><small>행운의 숫자</small><b>{f.number}</b></div>
            <div><small>행운의 점심</small><b><Link to="/lunch">{f.lunch}</Link></b></div>
            <div><small>행운의 물건</small><b>{f.item}</b></div>
            <div><small>좋은 일이 생길 시간</small><b>{f.time}</b></div>
          </div>
          <div className="ts-row-end"><button className="ts-btn ts-o" onClick={copy}>{copied ? '✔ 복사됐어요' : '📋 결과 복사해서 공유'}</button></div>
        </section>

        <section className="ts-card">
          <h3>띠별 한 줄 운세</h3>
          <div className="ts-zgrid">
            {zs.map((z, i) => (
              <div key={z.name} className={'ts-z' + (i === my ? ' on' : '')}>
                <div><span>{z.emoji}</span><b>{z.name}띠</b><em className="ts-fstar">{stars(z.score)}</em></div>
                <p>{z.text}</p>
              </div>
            ))}
          </div>
          <small className="ts-mut">띠는 태어난 해 기준이에요 (설날 이전 생일은 앞 해 띠일 수 있어요)</small>
        </section>
        <p className="ts-mut ts-center">재미로만 봐 주세요 · 매일 자정에 바뀌어요</p>
      </main>
      <SiteFoot />
    </div>
  )
}
