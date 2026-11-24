import { useLocation, useNavigate } from 'react-router-dom'
import { EP_TITLE, FILE_NAME } from './episode'
import { parseResult, saveRival } from './state'
import { fmtSec } from '../escape/share'
import './workshop.css'

/** 친구가 보낸 기록 링크를 열었을 때 보이는 화면 */
export default function WorkshopResult() {
  const nav = useNavigate()
  const r = parseResult(useLocation().search)
  return (
    <div className="ws">
      <div className="ws-title"><span className="ws-logo">P</span><span className="ws-tmid">{FILE_NAME}</span><span>—　☐　✕</span></div>
      <div className="ws-result-bg">
        <div className="ws-dlg">
          <div className="ws-dt"><span>{EP_TITLE}</span></div>
          {r ? (
            <div className="ws-clear">
              <p><b>{r.n}</b> 님의 워크숍 조난기 결과</p>
              <div className="big">{r.safe ? '탈출 성공 · 세이프' : '탈출 실패 · 지각'}</div>
              <div className="stats">
                <div>걸린 시간<b>{fmtSec(r.t)}</b></div>
                <div>힌트<b>{r.h === undefined ? '-' : r.h ? `${r.h}번 사용` : '사용 안 함'}</b></div>
                <div>결과<b className="res">{r.safe ? '세이프' : '지각'}</b></div>
              </div>
              <p style={{ marginTop: 12, color: '#666' }}>워크숍 둘째 날 아침 9시 40분, 늦잠을 잤다.<br />10시 버스를 놓치기 전에 PPT 기능으로 단서를 찾아 탈출하세요.</p>
            </div>
          ) : (
            <div className="ws-story"><span className="ws-ic" style={{ background: '#c42b1c' }}>!</span><p>기록 링크가 올바르지 않아요.</p></div>
          )}
          <div className="ws-btns">
            <button onClick={() => nav('/')}>로비로</button>
            <button className="pri" onClick={() => { if (r) saveRival(r); nav('/workshop') }}>{r ? `나도 도전하기 (${r.n} 님과 비교)` : '도전하기'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
