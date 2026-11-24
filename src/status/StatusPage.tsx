import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { SKINS, useStatus } from './settings'
import Widget, { MiniBar } from './Widget'
import Onboard from './Onboard'
import SettingsPanel from './SettingsPanel'
import { PipPortal, pipSupported, useNow, usePip } from './pip'
import './status.css'
import SiteHeader from '../site/SiteHeader'

const READY = new Set(['/', '/games', '/fortune', '/lunch'])

export default function StatusPage() {
  const [s, update] = useStatus()
  const now = useNow()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const popup = params.get('popup') === '1'
  const { win, open } = usePip()
  const [settings, setSettings] = useState(false)
  const [bar, setBar] = useState(false)
  const [toast, setToast] = useState('')
  const skinsRef = useRef<HTMLDivElement>(null)

  useEffect(() => { document.title = '탕비실 상태창' }, [])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2200); return () => clearTimeout(t) }, [toast])

  const go = (p: string) => {
    if (!READY.has(p)) { setToast('운세·점심은 곧 열려요!'); return }
    if (popup && window.opener) { window.opener.location.href = p; window.opener.focus(); return }
    nav(p)
  }

  // 일반 팝업 창(작은 창을 지원 안 하는 브라우저)
  if (popup) {
    return (
      <div className="st-page st-popup" data-skin={s.skin}>
        <Widget s={s} update={update} now={now} onNav={go} />
        {toast && <div className="st-toast">{toast}</div>}
      </div>
    )
  }

  return (
    <div className="st-page">
      <SiteHeader />

      <main className="st-main">
        <div className={'st-stage st-stage-' + s.skin}>
          {bar
            ? <MiniBar s={s} update={update} now={now} onExpand={() => setBar(false)} />
            : <Widget s={s} update={update} now={now} onPin={() => open()} onBar={() => setBar(true)} onSettings={() => setSettings(true)} onNav={go} />}
        </div>

        <div className="st-side">
          <Onboard s={s} update={update} onPin={() => open()} onSkins={() => skinsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })} />

          <section className="st-box">
            <h4>📌 화면에 띄워 두기</h4>
            <p>{pipSupported()
              ? '다른 창 위에 항상 떠 있는 작은 상태창을 열어요. 엑셀 위에 올려 두고 일하세요.'
              : '이 브라우저는 \'항상 위\' 창을 지원하지 않아서 일반 작은 창으로 열려요. 크롬·엣지에서는 항상 위에 떠 있어요.'}</p>
            <div className="st-r st-left">
              <button className="st-btn" onClick={() => open()}>📌 작은 창으로 띄우기</button>
              {pipSupported() && <button className="st-btn st-o" onClick={() => open(true)}>➖ 한 줄 바로 띄우기</button>}
            </div>
            {win && <p className="st-ok">✔ 작은 창이 열려 있어요. 이 탭을 닫으면 작은 창도 닫혀요.</p>}
          </section>

          <section className="st-box" ref={skinsRef}>
            <h4>🎨 스킨</h4>
            <div className="st-skins">
              {SKINS.map((k) => (
                <button key={k.id} className={'st-sk st-sk-' + k.id + (s.skin === k.id ? ' on' : '')} onClick={() => update({ skin: k.id })}>{k.label}</button>
              ))}
            </div>
          </section>

          <section className="st-box st-tips">
            <b>쓰는 법</b>
            <ul>
              <li>숫자를 누르면 바로 고칠 수 있어요</li>
              <li>👁 를 누르면 금액을 가려요 (옆자리 눈치 보일 때)</li>
              <li>작은 창에서 <kbd>Esc</kbd> 두 번 → 얌전한 위젯 + 금액 가리기</li>
              <li>모든 값은 이 브라우저에만 저장돼요</li>
            </ul>
          </section>
        </div>
      </main>

      {settings && <SettingsPanel s={s} update={update} onClose={() => setSettings(false)} />}
      {win && <PipPortal win={win} onNav={go} onSettings={() => setSettings(true)} />}
      {toast && <div className="st-toast">{toast}</div>}
    </div>
  )
}
