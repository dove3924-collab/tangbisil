import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import '../wordball/wordball.css'
import './puzzle.css'

/** 퍼즐 게임 공통 엑셀 화면 틀 (영단어 야구와 같은 모양) */
export default function ExcelFrame({ fileName, tools, nameBox, formula, tabs, status, children, overlay, side }: {
  fileName: string; tools: ReactNode; nameBox: string; formula: ReactNode; tabs: ReactNode; status: ReactNode; children: ReactNode; overlay?: ReactNode
  side?: ReactNode // 판 오른쪽 작업 창
}) {
  const nav = useNavigate()
  return (
    <div className="wb">
      <div className="wb-title">
        <span className="wb-logo">X</span>
        <span className="wb-tmid">{fileName}<span className="dim"> - 저장됨</span></span>
        <button className="wb-exit" onClick={() => nav('/')}>나가기</button>
      </div>
      <div className="wb-ribbon">{['파일', '홈', '삽입', '페이지 레이아웃', '수식', '데이터', '검토', '보기'].map((t) => <span key={t} className={t === '홈' ? 'on' : ''}>{t}</span>)}</div>
      <div className="wb-tools">{tools}</div>
      <div className="wb-fbar"><span className="wb-name">{nameBox}</span><span className="wb-fx">fx</span><span className="wb-fval">{formula}</span></div>
      {side ? <div className="wb-mid"><div className="wb-sheet">{children}</div>{side}</div> : <div className="wb-sheet">{children}</div>}
      <div className="wb-tabs">{tabs}</div>
      <div className="wb-status">{status}</div>
      {overlay}
    </div>
  )
}

/** 엑셀 알림창 */
export function ExcelDialog({ title, icon = 'i', warn, children, buttons, onClose }: {
  title: string; icon?: string; warn?: boolean; children: ReactNode; buttons: ReactNode; onClose: () => void
}) {
  return (
    <div className="wb-dlg-wrap">
      <div className="wb-dlg" role="dialog">
        <div className="wd-head">{title}<button className="wd-x" onClick={onClose} aria-label="닫기">✕</button></div>
        <div className="wd-body"><span className={'wd-ic' + (warn ? ' warn' : '')}>{icon}</span><div>{children}</div></div>
        <div className="wd-foot">{buttons}</div>
      </div>
    </div>
  )
}
