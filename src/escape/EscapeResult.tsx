import { useLocation, useNavigate } from 'react-router-dom'
import { EP_TITLE, FILE_NAME } from './episode1'
import { fmtHints, fmtSec, parseResult, saveRival } from './share'
import './escape.css'

/** 친구가 보낸 기록 링크를 열었을 때 보이는 화면 */
export default function EscapeResult() {
  const nav = useNavigate()
  const r = parseResult(useLocation().search)
  return (
    <div className="xe xe-result">
      <div className="xe-title"><span className="xe-logo">X</span><span className="xe-tmid">{FILE_NAME}</span><span className="xe-win">—  ☐  ✕</span></div>
      <div className="xe-result-bg">
        <div className="xe-dlg">
          <div className="xe-dt"><span>{EP_TITLE}</span></div>
          {r ? (
            <div className="xe-story">
              <span className="xe-ic" style={{ background: '#217346' }}>✓</span>
              <div>
                <p><b>{r.n}</b> 님이 야근 탈출에 성공했어요.</p>
                <div className="xe-big">{fmtSec(r.t)}</div>
                {r.h !== undefined && <p className="xe-hints">{fmtHints(r.h)}</p>}
                <p className="dim">금요일 밤 11시, 아무도 없는 줄 알고 잠겨버린 사무실.<br />엑셀 기능으로 단서를 찾아 퇴근하세요.</p>
              </div>
            </div>
          ) : (
            <div className="xe-story"><span className="xe-ic" style={{ background: '#c42b1c' }}>!</span><p>기록 링크가 올바르지 않아요.</p></div>
          )}
          <div className="xe-btns">
            <button onClick={() => nav('/')}>로비로</button>
            <button className="pri" onClick={() => { if (r) saveRival(r); nav('/escape') }}>{r ? `나도 도전하기 (${r.n} 님과 비교)` : '도전하기'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
