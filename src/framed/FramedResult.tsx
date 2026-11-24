import { useLocation, useNavigate } from 'react-router-dom'
import { EP_TITLE, GRADE_NAME } from './data'
import { parseResult, saveRival } from './state'
import { fmtSec } from '../escape/share'
import './framed.css'

/** 친구가 보낸 기록 링크를 열었을 때 보이는 화면 */
export default function FramedResult() {
  const nav = useNavigate()
  const r = parseResult(useLocation().search)
  return (
    <div className="fr-result">
      <div className="card">
        {r ? (
          <>
            <p style={{ margin: '0 0 10px' }}><b>{r.n}</b> 님의 {EP_TITLE} 결과</p>
            <div className={'gr g' + r.g}>{r.g}</div>
            <h2>{GRADE_NAME[r.g]}</h2>
            <div className="stats">
              <div>걸린 시간<b>{fmtSec(r.t)}</b></div>
              <div>찾은 증거<b>{r.e} / 7</b></div>
              <div>힌트<b>{r.h === undefined ? '-' : r.h ? `${r.h}번` : '안 씀'}</b></div>
              <div>등급<b>{r.g}</b></div>
            </div>
            <p className="muted">법인카드 부정 사용 누명을 쓴 금요일 밤. 새벽 3시 본사 감사위원회 회의 전에<br />감사팀 PC에서 진짜 범인을 찾아 소명서를 보내세요.</p>
          </>
        ) : <p>기록 링크가 올바르지 않아요.</p>}
        <div className="fr-btns">
          <button onClick={() => nav('/games')}>게임 목록</button>
          <button className="pri" onClick={() => { if (r) saveRival(r); nav('/framed') }}>{r ? `나도 도전하기 (${r.n} 님과 비교)` : '도전하기'}</button>
        </div>
      </div>
    </div>
  )
}
