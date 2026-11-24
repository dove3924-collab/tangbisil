import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ATTEND, CAL_EVENTS, CHARGES, PROOFS, CHATS, EVENTS, EVIDENCE, FILES, JUNG_EMPTY, MAILS, PEOPLE, REPORT_NO, REPORT_VERS, SHEETS, SUSPECTS, TXT, ZIP_PW,
  type Charge, type ChatMsg, type EvId, type FNode,
} from './data'
import { CHAT_EXPORT } from './moji'
import { photoSvg, receiptSvg } from './art'
import { useGame } from './ctx'
import { clock } from './state'
import { colName } from '../puzzle/common'

/* ───────── 공통 ───────── */
export const KIND_ICO: Record<string, string> = {
  folder: '📁', drive: '💽', xlsx: '📊', docx: '📝', txt: '📄', img: '🖼️', zip: '🗜️', pdf: '📕', pptx: '📙', app: '🧩',
}
export const KIND_NAME: Record<string, string> = {
  folder: '파일 폴더', drive: '드라이브', xlsx: 'Excel 워크시트', docx: 'Word 문서', txt: '텍스트 문서', img: 'JPG 파일', zip: '압축(ZIP) 폴더', pdf: 'PDF 문서', pptx: 'PowerPoint 프레젠테이션', app: '바로 가기',
}

/** 증거를 찾았을 때 창 아래에 뜨는 띠 */
export function EvBanner({ id }: { id: EvId }) {
  const { s, saveEv } = useGame()
  const ev = EVIDENCE.find((e) => e.id === id)!
  const saved = s.ev.includes(id)
  return (
    <div className={'fr-evb' + (saved ? ' saved' : '')}>
      <span className="ico">{ev.ico}</span>
      <span className="t">{saved ? 'USB에 저장된 증거' : '중요한 증거다!'}<b>{ev.name}</b></span>
      {saved ? <span className="ok">✔ 저장됨 ({s.ev.length}/7)</span> : <button onClick={() => saveEv(id)}>💾 내 USB에 저장</button>}
    </div>
  )
}

function Menu({ items }: { items: string[] }) {
  const { alert } = useGame()
  return (
    <div className="fr-menubar">
      {items.map((m) => <button key={m} onClick={() => alert(m, '이 메뉴에는 쓸 만한 게 없다.')}>{m}</button>)}
    </div>
  )
}

/* ───────── 탐색기 ───────── */
const NAV = [['desk', '🖥️ 바탕 화면'], ['pc', '💻 내 PC'], ['c', '💽 로컬 디스크 (C:)'], ['d', '💽 데이터 (D:)'], ['usb', '💾 내 USB (E:)'], ['trash', '🗑️ 휴지통']]
const DESK_FILES = ['audit', 'report', 'cards', 'memo', 'golf', 'newf']

export function Explorer({ start }: { start: string }) {
  const { s, open, alert } = useGame()
  const [path, setPath] = useState<string[]>([start])
  const [sel, setSel] = useState<string | null>(null)
  const [ctx, setCtx] = useState<{ x: number; y: number; id: string } | null>(null)
  const cur = path[path.length - 1]
  const node = FILES[cur]
  const go = (id: string) => { setPath((p) => [...p, id]); setSel(null) }
  let kids: string[] = cur === 'desk' ? DESK_FILES : [...(node?.children ?? [])]
  if (cur === 'down' && s.zipOpen) kids = ['rz', ...kids]
  const evFiles = cur === 'usb' ? s.ev : []
  const openNode = (f: FNode) => {
    if (f.kind === 'folder' || f.kind === 'drive') go(f.id)
    else open('file:' + f.id)
  }
  const title = cur === 'trash' ? '휴지통' : node?.name ?? ''
  return (
    <div className="fr-exp" onClick={() => setCtx(null)}>
      <div className="fr-exp-bar">
        <button disabled={path.length < 2} onClick={() => setPath((p) => p.slice(0, -1))}>←</button>
        <button onClick={() => alert('앞으로', '앞으로 갈 곳이 없다.')}>→</button>
        <div className="addr">{path.map((p) => (FILES[p]?.name ?? '바탕 화면')).join('  ›  ')}</div>
        <input className="srch" placeholder={`${title} 검색`} onKeyDown={(e) => { if (e.key === 'Enter') alert('검색', '색인 중… 결과가 없습니다.') }} />
      </div>
      <div className="fr-exp-main">
        <nav>{NAV.map(([id, t]) => <button key={id} className={cur === id ? 'on' : ''} onClick={() => { setPath([id]); setSel(null) }}>{t}</button>)}</nav>
        <div className="list">
          <div className="lh"><span>이름</span><span>{cur === 'trash' ? '삭제한 날짜' : '수정한 날짜'}</span><span>유형</span><span>크기</span></div>
          {kids.length === 0 && evFiles.length === 0 && <p className="empty">이 폴더는 비어 있습니다.</p>}
          {kids.map((id) => {
            const f = FILES[id]
            return (
              <div key={id} className={'row' + (sel === id ? ' sel' : '')} onClick={() => setSel(id)} onDoubleClick={() => openNode(f)}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSel(id); setCtx({ x: e.nativeEvent.offsetX + (e.currentTarget as HTMLElement).offsetLeft, y: (e.currentTarget as HTMLElement).offsetTop + 20, id }) }}>
                <span>{KIND_ICO[f.kind]} {f.name}</span><span>{f.deleted ?? f.date ?? ''}</span><span>{KIND_NAME[f.kind]}</span><span>{f.size ?? ''}</span>
              </div>
            )
          })}
          {evFiles.map((id) => {
            const ev = EVIDENCE.find((e) => e.id === id)!
            return (
              <div key={id} className={'row ev' + (sel === id ? ' sel' : '')} onClick={() => setSel(id)} onDoubleClick={() => open('ev:' + id)}>
                <span>{ev.ico} {ev.file}</span><span>방금</span><span>증거</span><span>-</span>
              </div>
            )
          })}
          {ctx && (
            <div className="fr-ctx" style={{ left: Math.min(ctx.x, 420), top: ctx.y }} onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { setCtx(null); openNode(FILES[ctx.id]) }}>열기</button>
              {cur === 'trash' && <button onClick={() => { setCtx(null); alert('복원', '복원하면 팀장이 눈치챌 수도 있다. 그냥 열어서 보자.') }}>복원</button>}
              <button onClick={() => { setCtx(null); alert('복사', '클립보드에 복사했다. …붙여넣을 데가 없다.') }}>복사</button>
              <button onClick={() => { setCtx(null); alert('삭제', '흔적을 남기면 안 된다. 아무것도 지우지 말자.') }}>삭제</button>
              <button onClick={() => { setCtx(null); const f = FILES[ctx.id]; alert('속성', `${f.name}\n\n유형: ${KIND_NAME[f.kind]}\n크기: ${f.size ?? '-'}\n수정한 날짜: ${f.date ?? '-'}${f.deleted ? `\n삭제한 날짜: ${f.deleted}` : ''}`) }}>속성</button>
            </div>
          )}
        </div>
      </div>
      <div className="fr-status">{kids.length + evFiles.length}개 항목{cur === 'usb' ? ` · 증거 ${s.ev.length}/7` : ''}{sel ? ' · 1개 선택함' : ''}</div>
    </div>
  )
}

/* ───────── 엑셀 ───────── */
export function Excel({ id }: { id: string }) {
  const { s, up, alert } = useGame()
  const sh = SHEETS[id]
  const [cell, setCell] = useState<[number, number]>([0, 0])
  const [rowSel, setRowSel] = useState<number | null>(null)
  const [ctx, setCtx] = useState<{ x: number; y: number; r: number } | null>(null)
  const [fmt, setFmt] = useState(false)
  const hidden = id === 'ledger' && !s.unhid ? sh.hidden ?? [] : []
  const unhideAt = (r: number | null) => {
    if (id === 'ledger' && !s.unhid && r !== null && (r === 12 || r === 14 || r === -1)) {
      up((d) => { d.unhid = true })
      return true
    }
    return false
  }
  const val = sh.rows[cell[0]]?.[cell[1]] ?? ''
  const protectedMsg = () => alert('Microsoft Excel', '변경하려는 셀이나 차트가 보호된 시트에 있습니다.\n변경하려면 시트 보호를 해제하세요. (암호가 필요합니다)')
  return (
    <div className="fr-xl" onClick={() => { setCtx(null); setFmt(false) }} tabIndex={0} onKeyDown={(e) => { if (e.key.length === 1 && !e.ctrlKey) protectedMsg() }}>
      <div className="fr-ribbon xl">
        <div className="tabs"><b>파일</b><b className="on">홈</b><b>삽입</b><b>수식</b><b>데이터</b><b>검토</b><b>보기</b></div>
        <div className="tools">
          <button onClick={protectedMsg}>붙여넣기</button><button onClick={protectedMsg}><b>가</b> 굵게</button><button onClick={protectedMsg}>병합</button>
          <button onClick={() => alert('정렬 및 필터', '시트가 보호되어 있어 정렬할 수 없습니다.')}>정렬 및 필터 ▾</button>
          <span className="sep" />
          <div className="fr-dd">
            <button onClick={(e) => { e.stopPropagation(); setFmt(!fmt) }}>서식 ▾</button>
            {fmt && (
              <div className="fr-ctx" style={{ top: 26, left: 0 }} onClick={(e) => e.stopPropagation()}>
                <button onClick={() => { setFmt(false); alert('행 높이', '행 높이: 18') }}>행 높이…</button>
                <button onClick={() => { setFmt(false); alert('열 너비', '열 너비: 자동') }}>열 너비 자동 맞춤</button>
                <button onClick={() => { setFmt(false); alert('숨기기', '숨길 행을 먼저 선택하세요.') }}>행 숨기기</button>
                <button onClick={() => { setFmt(false); if (!unhideAt(rowSel)) alert('행 숨기기 취소', id === 'ledger' && !s.unhid ? '숨겨진 행 바로 위나 아래 행 번호를 선택한 뒤 다시 해 보세요.' : '숨겨진 행이 없습니다.') }}>행 숨기기 취소</button>
                <button onClick={() => { setFmt(false); protectedMsg() }}>시트 보호 해제…</button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="fr-fx"><span className="nm">{colName(cell[1])}{cell[0] + 3}</span><span className="fx">fx</span><span className="v">{val}</span></div>
      <div className="fr-grid">
        <table>
          <thead><tr><th className="corner" onClick={() => setRowSel(-1)} />{sh.cols.map((c, i) => <th key={i} style={{ width: c.w }}>{colName(i)}</th>)}</tr></thead>
          <tbody>
            <tr><th className="rh">1</th><td colSpan={sh.cols.length} className="ttl">{sh.title}</td></tr>
            <tr><th className="rh">2</th>{sh.cols.map((c, i) => <td key={i} className="hd">{c.name}</td>)}</tr>
            {sh.rows.map((r, ri) => {
              if (hidden.includes(ri)) return null
              const nextHidden = hidden.includes(ri + 1)
              return (
                <tr key={ri} className={(rowSel === ri ? 'rsel ' : '') + (nextHidden ? 'hidnext' : '')}>
                  <th className={'rh' + (rowSel === ri ? ' on' : '')} onClick={(e) => { e.stopPropagation(); setRowSel(ri) }}
                    onDoubleClick={() => { if (nextHidden || hidden.includes(ri - 1)) unhideAt(ri) }}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setRowSel(ri); setCtx({ x: 40, y: (e.currentTarget as HTMLElement).offsetTop + 60, r: ri }) }}>{ri + 3}</th>
                  {r.map((v, ci) => (
                    <td key={ci} className={(cell[0] === ri && cell[1] === ci ? 'sel ' : '') + (sh.cols[ci].align ?? '') + (id === 'ledger' && s.unhid && ri === 13 ? ' hl' : '') + (id === 'cards' && ri === sh.rows.length - 1 ? ' sum' : '')}
                      onClick={() => { setCell([ri, ci]); setRowSel(null) }}>{v}</td>
                  ))}
                </tr>
              )
            })}
            {Array.from({ length: 6 }, (_, i) => <tr key={'e' + i}><th className="rh">{sh.rows.length + 3 + i}</th>{sh.cols.map((_, ci) => <td key={ci} />)}</tr>)}
          </tbody>
        </table>
        {ctx && (
          <div className="fr-ctx" style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { setCtx(null); protectedMsg() }}>잘라내기</button>
            <button onClick={() => { setCtx(null); alert('복사', '복사했다. 붙여넣을 곳은 없다.') }}>복사</button>
            <button onClick={() => { setCtx(null); protectedMsg() }}>삽입</button>
            <button onClick={() => { setCtx(null); protectedMsg() }}>삭제</button>
            <button onClick={() => { setCtx(null); alert('행 높이', '행 높이: 18') }}>행 높이…</button>
            <button onClick={() => { setCtx(null); alert('숨기기', '숨기면 나중에 팀장이 눈치챌 것 같다.') }}>숨기기</button>
            <button onClick={() => { setCtx(null); if (!unhideAt(ctx.r)) alert('숨기기 취소', '이 행 주변에는 숨겨진 행이 없습니다.') }}>숨기기 취소</button>
          </div>
        )}
      </div>
      <div className="fr-sheets"><b>Sheet1</b><span>+</span><span className="note">{sh.note}</span></div>
      {id === 'ledger' && s.unhid && <EvBanner id="ledger" />}
    </div>
  )
}

/* ───────── 워드: 조사 보고서 ───────── */
const CARD_ROWS = SHEETS.cards.rows.slice(0, -1)
function ReportBody({ card, user, note }: { card: string; user: string; note?: string }) {
  return (
    <div className="fr-page">
      <div className="no">{REPORT_NO} · 대외비</div>
      <h1>법인카드 부정 사용 조사 보고서</h1>
      <p className="meta">대상: {user} · 작성: 감사팀</p>
      {note && <p className="note">{note}</p>}
      <h3>1. 개요</h3>
      <p>2026년 10월 6일부터 11월 4일까지 아래 카드로 호텔·명품관·상품권 등 업무와 무관한 결제 32,000,000원이 확인되었다.</p>
      <h3>2. 결제 내역 (카드사 원본)</h3>
      <table className="fr-tb"><thead><tr><th>일자</th><th>시각</th><th>가맹점</th><th>금액</th><th>카드</th></tr></thead>
        <tbody>{CARD_ROWS.map((r, i) => <tr key={i}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td className="r">{r[3]}</td><td className={card === '7730' ? 'hot' : ''}>****-{card}</td></tr>)}</tbody></table>
      <h3>3. 11/3 결제 경위 (3쪽)</h3>
      <p>11월 3일 14시 12분 ○○호텔 강남에서 위 카드로 1,280,000원이 결제되었다. {user.startsWith('김') ? '대상자는 당일 강남 일대에 있었던 것으로 판단된다.' : '결제자 확인이 필요하다.'}</p>
      <h3>4. 영수증 대조 (4쪽)</h3>
      <p>{user.startsWith('김') ? '영수증 사본의 카드 번호가 대상자 법인카드(4521)와 일치한다.' : '영수증 원본 스캔 요청 (재무팀).'}</p>
      <h3>5. 상품권 현금화 (5쪽)</h3>
      <p>상품권 20,000,000원어치를 세 차례 구매한 뒤 매입 업체에 되판 것으로 보인다.</p>
      <h3>6. 동료 진술</h3>
      <p>{user.startsWith('김') ? '같은 팀 정○○ 과장: "11월 3일 오후 2시경 대상자가 법인카드를 들고 외출하는 것을 보았다." (첨부)' : '(진술 받기 전)'}</p>
    </div>
  )
}

export function Word({ id }: { id: string }) {
  const { alert } = useGame()
  const [panel, setPanel] = useState<'' | 'file' | 'ver'>('')
  const [ver, setVer] = useState(3)
  if (id === 't_form') {
    return (
      <div className="fr-word"><Menu items={['파일', '홈', '삽입', '레이아웃']} />
        <div className="fr-doc"><div className="fr-page"><h1>진 술 서</h1><p>성명: ____________ 소속: ____________</p><p>진술 내용:</p><p className="blank">　</p><p className="blank">　</p><p>위 내용은 사실과 다름없음을 확인합니다.</p><p style={{ textAlign: 'right' }}>2026년 11월 __일 ________ (서명)</p></div></div>
      </div>
    )
  }
  const v = REPORT_VERS.find((x) => x.v === ver)!
  return (
    <div className="fr-word">
      <div className="fr-ribbon wd">
        <div className="tabs">
          <b className={panel ? 'on' : ''} onClick={() => setPanel(panel ? '' : 'file')}>파일</b>
          <b className={!panel ? 'on' : ''} onClick={() => setPanel('')}>홈</b><b onClick={() => alert('삽입', '읽기 전용 문서입니다.')}>삽입</b>
          <b onClick={() => alert('검토', '변경 내용 추적: 꺼짐\n메모: 0개\n\n(누군가 추적을 꺼 놓고 고친 것 같다…)')}>검토</b><b onClick={() => alert('보기', '읽기 모드')}>보기</b>
        </div>
        {!panel && <div className="tools"><span className="ro">🔒 읽기 전용 — "최종본 확정. 수정하지 마세요."</span>{ver !== 3 && <button onClick={() => setVer(3)}>최신 버전으로 돌아가기</button>}</div>}
      </div>
      {panel ? (
        <div className="fr-back">
          <nav>
            <button className={panel === 'file' ? 'on' : ''} onClick={() => setPanel('file')}>정보</button>
            <button onClick={() => alert('인쇄', '프린터가 오프라인입니다. (3층 복합기 — 용지 없음)')}>인쇄</button>
            <button onClick={() => alert('내보내기', '읽기 전용 문서는 내보낼 수 없습니다.')}>내보내기</button>
            <button onClick={() => alert('다른 이름으로 저장', '팀장 PC에 흔적을 남기면 안 된다.')}>다른 이름으로 저장</button>
            <button onClick={() => setPanel('')}>← 문서로</button>
          </nav>
          {panel === 'file' ? (
            <div className="info">
              <h2>정보</h2>
              <p className="fn">조사보고서_김○○_최종.docx</p>
              <div className="fr-box"><b>🔒 문서 보호</b><p>이 문서는 최종본으로 표시되어 편집할 수 없습니다.</p></div>
              <div className="fr-box"><b>🕘 버전 기록</b><p>이 파일의 이전 버전 3개를 보고 복원할 수 있습니다.</p><button onClick={() => setPanel('ver')}>버전 기록 보기</button></div>
              <div className="props"><div>크기 <span>1.1MB</span></div><div>만든 이 <span>이○○ (재무팀)</span></div><div>마지막으로 수정한 사람 <span>박○○ (감사팀)</span></div><div>만든 날짜 <span>2026-11-02 15:10</span></div><div>수정한 날짜 <span>2026-11-05 23:58</span></div></div>
            </div>
          ) : (
            <div className="info">
              <h2>버전 기록</h2>
              {REPORT_VERS.map((x) => (
                <div key={x.v} className={'verrow' + (ver === x.v ? ' on' : '')}>
                  <b>버전 {x.v}</b><span>{x.date}</span><span>{x.who}</span><span className="m">{x.memo}</span>
                  <button onClick={() => { setVer(x.v); setPanel('') }}>{ver === x.v ? '보는 중' : '열기'}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="fr-doc">
          {ver !== 3 && <div className="verbar">📄 이전 버전 {ver} ({v.date}, {v.who}) 을 보고 있습니다 — 읽기 전용</div>}
          <ReportBody card={v.card} user={v.user} note={v.note} />
        </div>
      )}
      {ver === 1 && !panel && <EvBanner id="ver" />}
    </div>
  )
}

/* ───────── 메모장 ───────── */
type Enc = 'utf8' | 'utf16' | 'latin1' | 'euckr'
const ENCS: [Enc, string][] = [['utf8', 'UTF-8'], ['utf16', 'UTF-16 LE'], ['latin1', 'ANSI (서유럽어)'], ['euckr', 'EUC-KR (한국어)']]
export function Notepad({ id }: { id: string }) {
  const { alert } = useGame()
  const [enc, setEnc] = useState<Enc>('utf8')
  const [dd, setDd] = useState('')
  const text = id === 't_chat' ? CHAT_EXPORT[enc] : TXT[id] ?? ''
  const menu = (m: string, items: [string, () => void][]) => (
    <div className="fr-dd">
      <button className={dd === m ? 'on' : ''} onClick={(e) => { e.stopPropagation(); setDd(dd === m ? '' : m) }}>{m}</button>
      {dd === m && <div className="fr-ctx" style={{ top: 24, left: 0 }}>{items.map(([t, f]) => <button key={t} onClick={() => { setDd(''); f() }}>{t}</button>)}</div>}
    </div>
  )
  const no = (t: string) => () => alert('메모장', t)
  return (
    <div className="fr-np" onClick={() => setDd('')}>
      <div className="fr-menubar">
        {menu('파일', [['새로 만들기', no('흔적을 남기면 안 된다.')], ['저장', no('읽기 전용으로 열었다.')], ['인쇄', no('프린터가 오프라인입니다.')]])}
        {menu('편집', [['찾기', no('찾을 말이 떠오르지 않는다.')], ['모두 선택', no('선택했다. 그래서?')]])}
        {menu('서식', [['자동 줄 바꿈 ✔', no('이미 켜져 있다.')], ['글꼴…', no('맑은 고딕 11pt')]])}
        {menu('인코딩', ENCS.map(([k, t]) => [(enc === k ? '● ' : '　') + t + '로 다시 열기', () => setEnc(k)]))}
      </div>
      <pre className="fr-np-text">{text || ' '}</pre>
      <div className="fr-status">줄 1, 열 1 · 100% · Windows (CRLF) · {ENCS.find((e) => e[0] === enc)![1]}</div>
      {id === 't_chat' && enc === 'euckr' && <EvBanner id="chat" />}
    </div>
  )
}

/* ───────── 사진 보기 ───────── */
const ZOOMS = [25, 35, 50, 75, 100, 150, 200]
export function ImageView({ id }: { id: string }) {
  const isR = id === 'r1' || id === 'r2' || id === 'r3'
  const baseRot = id === 'r2' ? 180 : 0
  const [rot, setRot] = useState(0)
  const [zi, setZi] = useState(id === 'r2' ? 1 : 4)
  const svg = isR ? receiptSvg(id as 'r1' | 'r2' | 'r3') : photoSvg(id)
  const net = (((baseRot + rot) % 360) + 360) % 360
  const zoom = ZOOMS[zi]
  return (
    <div className="fr-img">
      <div className="fr-img-bar">
        <button onClick={() => setZi(Math.max(0, zi - 1))}>－</button><span>{zoom}%</span><button onClick={() => setZi(Math.min(ZOOMS.length - 1, zi + 1))}>＋</button>
        <span className="sep" /><button onClick={() => setRot(rot - 90)}>↺ 왼쪽으로 회전</button><button onClick={() => setRot(rot + 90)}>↻ 오른쪽으로 회전</button>
        <span className="sep" /><span className="fn">{FILES[id]?.name}</span>
      </div>
      <div className="fr-img-view">
        <div style={{ transform: `rotate(${net}deg) scale(${zoom / 100})`, transition: 'transform .2s' }} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
      {id === 'r3' && <div className="fr-cap">흔들려서 카드 번호를 읽을 수 없다.</div>}
      {id === 'r1' && zoom >= 100 && net === 0 && <div className="fr-cap">카드 번호 부분이 인쇄 불량이다. 다른 영수증은?</div>}
      {id === 'r2' && net === 0 && zoom >= 100 && <EvBanner id="rcpt" />}
      {id === 'r2' && !(net === 0 && zoom >= 100) && <div className="fr-cap">스캔이 이상하게 됐다. 글씨가 너무 작고…</div>}
    </div>
  )
}

/* ───────── 압축 파일 ───────── */
export function Zip({ id }: { id: string }) {
  const { s, up, open } = useGame()
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  if (id !== 'zip') return <div className="fr-pad"><p>📦 {FILES[id].name}</p><p className="muted">84MB · 백업 파일. 지금 열어 볼 시간은 없다.</p></div>
  if (!s.zipOpen) {
    return (
      <form className="fr-pad fr-pw" onSubmit={(e) => { e.preventDefault(); if (pw.trim() === ZIP_PW) { up((d) => { d.zipOpen = true }) } else { setErr('암호가 올바르지 않습니다.'); setPw('') } }}>
        <p>🔐 <b>영수증원본.zip</b> 은(는) 암호로 보호되어 있습니다.</p>
        <label>암호 입력<input type="password" autoFocus value={pw} onChange={(e) => { setPw(e.target.value); setErr('') }} /></label>
        {err && <p className="err">{err}</p>}
        <div className="fr-btns"><button type="submit" className="pri">확인</button></div>
      </form>
    )
  }
  return (
    <div className="fr-pad">
      <p>✔ 압축을 풀었습니다 → 다운로드\영수증원본</p>
      {['r1', 'r2', 'r3'].map((f) => <div key={f} className="fr-filelink" onDoubleClick={() => open('file:' + f)} onClick={() => open('file:' + f)}>🖼️ {FILES[f].name}<span>{FILES[f].size}</span></div>)}
    </div>
  )
}

/* ───────── PDF·PPT 미리보기 ───────── */
const DOCS: Record<string, { title: string; body: string }> = {
  manual: { title: '감사업무 매뉴얼 v3', body: '제3장 증빙 관리\n\n3.1 모든 증빙은 원본을 보관한다.\n3.2 보고서는 버전 기록을 지우지 않는다.\n3.3 감사인은 본인이 관련된 건을 조사할 수 없다.\n\n(3.3에 누군가 밑줄을 긋고 "?"를 적어 놓았다.)' },
  h1: { title: '2026 상반기 감사 결과', body: '총 42건 점검, 지적 3건\n\n1. 물류팀 소모품 중복 구매 (경고)\n2. 마케팅팀 행사비 정산 지연 (주의)\n3. 영업2팀 — 지적 사항 없음 (모범 사례)\n\n감사팀장 박○○' },
  statement: { title: '진술서 — 정○○ (영업2팀 과장)', body: '본인은 2026년 11월 3일 오후 2시경, 같은 팀 김○○ 대리가 법인카드를 들고 외출하는 것을 보았습니다.\n그날 김 대리는 강남에 간다고 하였습니다.\n\n위 내용은 사실과 다름없음을 확인합니다.\n\n2026. 11. 4.  정○○ (서명)\n\n…11월 3일은 내 연차였다. 선배는 날 볼 수가 없었다.' },
  kongpdf: { title: '[멍멍살롱] 예약 확인', body: '콩이(말티즈, 5살) 보호자님\n11/7(토) 10:00 전체 미용 예약 확정\n\n※ 늦으시면 다음 손님께 양보됩니다.' },
  golfpdf: { title: '○○CC 예약 확인서', body: '11/8(일) 07:12 · 4인\n동반자: 최○○, (미정), (미정)\n\n그린피는 현장 결제입니다.' },
  plan: { title: '2026 감사 계획 (슬라이드 1/12)', body: '◆ 목표: 투명한 조직, 신뢰받는 감사\n◆ 중점: 법인카드 · 출장비 · 상품권 구매\n◆ 원칙: 증빙은 원본으로, 판단은 공정하게\n\n— 감사팀장 박○○' },
}
export function DocView({ id }: { id: string }) {
  const d = DOCS[id]
  return (
    <div className="fr-pdf"><div className="fr-pdf-bar">{FILES[id]?.name} · 1/1 페이지 · 100%</div>
      <div className="fr-doc"><div className="fr-page"><h2>{d?.title}</h2><p className="pre">{d?.body}</p></div></div>
    </div>
  )
}

export function EvidenceView({ id }: { id: EvId }) {
  const e = EVIDENCE.find((x) => x.id === id)!
  return <div className="fr-pad"><p style={{ fontSize: 30, margin: 0 }}>{e.ico}</p><h3>{e.name}</h3><p>{e.desc}</p><p className="muted">내 USB (E:) · {e.file}</p></div>
}

/* ───────── 메일 ───────── */
const BOXES: [string, string][] = [['in', '받은 편지함'], ['sched', '예약 편지함'], ['sent', '보낸 편지함'], ['spam', '스팸']]
export function Mail() {
  const { s, up, open, alert } = useGame()
  const [box, setBox] = useState('in')
  const [cur, setCur] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [cancelStep, setCancelStep] = useState<'' | 'ask' | 'code'>('')
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const list = MAILS.filter((m) => m.box === box && (!q || m.title.includes(q) || m.body.includes(q) || m.from.includes(q)))
  const m = MAILS.find((x) => x.id === cur && x.box === box)
  const unread = (b: string) => MAILS.filter((x) => x.box === b && x.unread && !s.readMail[x.id]).length
  const read = (id: string) => { setCur(id); if (!s.readMail[id]) up((d) => { d.readMail[id] = true }) }
  return (
    <div className="fr-mail">
      <nav>
        <button className="new" onClick={() => alert('새 메일', '팀장 이름으로 메일을 보내면 바로 들킨다. 소명서는 내 USB에 있다.')}>✉️ 새 메일</button>
        {BOXES.map(([b, t]) => <button key={b} className={box === b ? 'on' : ''} onClick={() => { setBox(b); setCur(null) }}>{t}{b === 'sched' ? <em>{s.cancelled ? 0 : 1}</em> : unread(b) ? <em>{unread(b)}</em> : null}</button>)}
      </nav>
      <div className="mlist">
        <input placeholder="메일 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        {list.length === 0 && <p className="empty">{box === 'sched' && s.cancelled ? '예약된 메일이 없습니다.' : '메일이 없습니다.'}</p>}
        {list.filter((x) => !(x.id === 'sched' && s.cancelled)).map((x) => (
          <div key={x.id} className={'mi' + (cur === x.id ? ' on' : '') + (x.unread && !s.readMail[x.id] ? ' unread' : '')} onClick={() => read(x.id)}>
            <div className="f">{x.box === 'sent' || x.box === 'sched' ? `받는 사람: ${x.to}` : x.from}</div><div className="t">{x.title}</div><div className="d">{x.date}{x.attach ? ' · 📎' : ''}</div>
          </div>
        ))}
      </div>
      <div className="mread">
        {m && !(m.id === 'sched' && s.cancelled) ? (
          <>
            <h3>{m.title}</h3>
            <div className="hd"><b>{m.from}</b>{m.to && <span> → {m.to}</span>}<span className="dt">{m.date}</span></div>
            {m.id === 'sched' && (
              <div className="sched">
                <span>⏰ 이 메일은 <b>11/07(토) 03:00</b>에 자동으로 보내집니다.</span>
                <button onClick={() => alert('수정', '"최종본 잠금" 설정으로 수정할 수 없습니다.')}>수정</button>
                <button className="danger" onClick={() => { setCancelStep('ask'); setErr('') }}>발송 취소</button>
              </div>
            )}
            <pre className="body">{m.body}</pre>
            {m.attach && <div className="att">{m.attach.map((a) => <button key={a.name} onClick={() => a.open && open(a.open)}>📎 {a.name}</button>)}</div>}
          </>
        ) : <p className="empty">메일을 선택하세요.</p>}
      </div>
      {cancelStep && (
        <div className="fr-modal-in">
          <div className="fr-dlg">
            <div className="dt">발송 취소 — 본인 확인</div>
            {cancelStep === 'ask' ? (
              <>
                <p>예약 메일을 취소하려면 본인 확인이 필요합니다.<br />등록된 휴대폰 <b>010-****-8826</b> 으로 인증번호를 보낼까요?</p>
                <div className="fr-btns"><button onClick={() => setCancelStep('')}>닫기</button>
                  <button className="pri" onClick={() => { if (!s.code) up((d) => { d.code = String(100000 + Math.floor(Math.random() * 900000)) }); setCancelStep('code') }}>인증번호 보내기</button></div>
              </>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); if (code.trim() === s.code) { up((d) => { d.cancelled = true }); setCancelStep(''); setCur(null) } else setErr('인증번호가 맞지 않습니다.') }}>
                <p>휴대폰(깨깨오톡 알림톡)으로 받은 6자리 인증번호를 입력하세요.</p>
                <input autoFocus maxLength={6} value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setErr('') }} placeholder="000000" />
                {err && <p className="err">{err}</p>}
                <div className="fr-btns"><button type="button" onClick={() => setCancelStep('')}>닫기</button><button className="pri">확인</button></div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ───────── 메신저 ───────── */
function chatMsgs(id: string, s: ReturnType<typeof useGame>['s']): ChatMsg[] {
  const base = CHATS.find((c) => c.id === id)!.msgs
  const out = [...base]
  EVENTS.filter((e) => e.chat === id && s.events[e.id]?.shown).forEach((e) => {
    const st = s.events[e.id]
    const t = clock(st.at ?? e.at)
    out.push(...e.msgs.map((m) => ({ ...m, t })))
    if (st.replied !== undefined) {
      const r = e.replies[st.replied]
      out.push({ me: true, t: '', text: r.text }, ...r.after)
    } else if (st.timedOut) out.push(...e.timeout)
  })
  return out
}
export const chatCount = (id: string, s: ReturnType<typeof useGame>['s']) => chatMsgs(id, s).length
/** 안 읽은 메시지 (원래 있던 대화는 팀장이 이미 읽은 것) */
export const unreadOf = (id: string, s: ReturnType<typeof useGame>['s']) => Math.max(0, chatCount(id, s) - Math.max(s.readChat[id] ?? 0, CHATS.find((c) => c.id === id)!.msgs.length))

export function Messenger({ start }: { start?: string }) {
  const { s, up, saveEv } = useGame()
  const [cur, setCur] = useState(start || 'team')
  const msgs = chatMsgs(cur, s)
  const pending = EVENTS.find((e) => e.chat === cur && s.events[e.id]?.shown && s.events[e.id].replied === undefined && !s.events[e.id].timedOut)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight }, [msgs.length, cur])
  useEffect(() => { if ((s.readChat[cur] ?? 0) < msgs.length) up((d) => { d.readChat[cur] = msgs.length }) }, [cur, msgs.length, s.readChat, up])
  const reply = (i: number) => {
    if (!pending) return
    const r = pending.replies[i]
    up((d) => {
      d.events[pending.id] = { ...d.events[pending.id], replied: i }
      if (!r.ok) d.sus += 1
      if (r.patrol) d.sus = Math.max(d.sus, 3)
    })
    if (r.gives) saveEv(r.gives)
  }
  const c = CHATS.find((x) => x.id === cur)!
  return (
    <div className="fr-msg">
      <nav>
        <div className="me"><span className="fr-av">박</span><div><b>박○○ 팀장</b><small>사내메신저 · 🟢 온라인</small></div></div>
        {CHATS.map((x) => {
          const n = unreadOf(x.id, s)
          const last = chatMsgs(x.id, s).slice(-1)[0]
          return (
            <button key={x.id} className={cur === x.id ? 'on' : ''} onClick={() => setCur(x.id)}>
              <span className="fr-av">{x.name[0]}</span><div><b>{x.name}</b><small>{last ? last.text.slice(0, 18) : x.sub}</small></div>{n > 0 && cur !== x.id && <em>{n}</em>}
            </button>
          )
        })}
      </nav>
      <div className="chat">
        <div className="ch"><b>{c.name}</b><span>{c.sub}</span>
          <span className="sus" title="상대가 이상하다고 느낀 정도">의심 {[0, 1, 2].map((i) => <i key={i} className={i < s.sus ? 'on' : ''} />)}</span></div>
        <div className="cb" ref={box}>
          {msgs.length === 0 && <p className="empty pre">{cur === 'jung' ? JUNG_EMPTY : '대화 내용이 없습니다.'}</p>}
          {msgs.map((m, i) => (
            <div key={i} className={'bub' + (m.me ? ' me' : '')}>
              {!m.me && <small>{m.who}</small>}
              <p>{m.text}</p>{m.t && <time>{m.t}</time>}
            </div>
          ))}
          {cur === 'jung' && s.events.e2?.replied === 2 && <EvBanner id="chat" />}
        </div>
        {pending ? (
          <div className="replies">
            <div className="rt">⚠️ 팀장인 척 답장해야 한다. 말투와 내용을 맞추자. (의심이 3개 차면 보안팀이 올라온다 · 3분 안에 답하기)</div>
            {pending.replies.map((r, i) => <button key={i} onClick={() => reply(i)}>{r.text}</button>)}
          </div>
        ) : (
          <div className="ci"><input disabled placeholder="팀장 계정이다. 함부로 말을 걸면 안 된다." /><button disabled>전송</button></div>
        )}
      </div>
    </div>
  )
}

/* ───────── 사내 포털 ───────── */
export function Portal() {
  const { alert } = useGame()
  const [tab, setTab] = useState('home')
  const [q, setQ] = useState('')
  const [res, setRes] = useState<string | null>(null)
  const [org, setOrg] = useState('')
  const people = PEOPLE.filter((p) => !org || p.name.includes(org) || p.team.includes(org))
  const lookup = () => {
    const v = q.trim().replace(/\s/g, '')
    if (!v) return
    if (/^\d{8}$/.test(v)) setRes(v)
    else if (v.includes('김')) setRes('dup')
    else setRes('none')
  }
  const rows = res && /^\d+$/.test(res) ? ATTEND[res] : null
  const person = PEOPLE.find((p) => p.id === res)
  return (
    <div className="fr-web">
      <div className="fr-urlbar"><span>🔒 https://portal.company.co.kr/{tab}</span></div>
      <div className="fr-portal">
        <header><b>○○ 사내 포털</b>{[['home', '홈'], ['att', '근태 조회'], ['org', '조직도'], ['appr', '전자결재'], ['card', '법인카드 관리']].map(([k, t]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>)}<span className="who">박○○ 팀장님 (감사팀 · 열람 권한)</span></header>
        {tab === 'home' && (
          <div className="pg">
            <h3>공지사항</h3>
            <ul>
              <li onClick={() => alert('공지', '[보안] 주말 야간 순찰 강화 — 매시 정각 전 층 순찰합니다.')}>[보안] 주말 야간 순찰 강화 안내 <span>11/02</span></li>
              <li onClick={() => alert('공지', '11월 사보가 발간되었습니다. 이달의 칭찬 사원: 영업2팀 김○○ 대리')}>[사보] 11월호 발간 <span>10/30</span></li>
              <li onClick={() => alert('공지', '연말정산 서류 제출은 12월 첫째 주까지입니다.')}>[인사] 연말정산 일정 <span>10/28</span></li>
              <li onClick={() => alert('공지', '법인카드 개인 사용 시 즉시 징계 대상입니다. — 감사팀')}>[감사] 법인카드 사용 수칙 재안내 <span>10/01</span></li>
            </ul>
            <h3>바로 가기</h3>
            <div className="quick"><button onClick={() => setTab('att')}>⏰ 근태 조회</button><button onClick={() => setTab('org')}>👥 조직도</button><button onClick={() => alert('식단', '오늘은 토요일, 구내식당 휴무')}>🍚 식단</button></div>
          </div>
        )}
        {tab === 'att' && (
          <div className="pg">
            <h3>근태 조회 <small>감사팀 권한 · 전 직원</small></h3>
            <form className="sr" onSubmit={(e) => { e.preventDefault(); lookup() }}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 또는 사번 (8자리)" /><button>조회</button></form>
            {res === 'dup' && <div className="msgbox">동명이인이 3명 있습니다. 개인정보 보호를 위해 <b>사번</b>으로 조회하세요.<ul><li>김○○ · 재무팀 · 2012****</li><li>김○○ · 영업2팀 · 2019****</li><li>김○○ · 물류팀 · 2024****</li></ul></div>}
            {res === 'none' && <div className="msgbox">검색 결과가 없습니다. 사번 8자리로 조회해 보세요.</div>}
            {res && /^\d+$/.test(res) && !rows && <div className="msgbox">해당 사번의 근태 기록이 없습니다.</div>}
            {rows && person && (
              <>
                <p className="who2">{person.name} {person.title} · {person.team} · {person.id}</p>
                <table className="fr-tb"><thead><tr><th>일자</th><th>출퇴근</th><th>구분</th></tr></thead>
                  <tbody>{rows.map((r) => <tr key={r[0]} className={r[2].startsWith('연차') ? 'hot' : ''}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody></table>
                {res === '20190342' && <EvBanner id="att" />}
              </>
            )}
          </div>
        )}
        {tab === 'org' && (
          <div className="pg">
            <h3>조직도</h3>
            <form className="sr" onSubmit={(e) => e.preventDefault()}><input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="이름·부서 검색" /></form>
            <table className="fr-tb"><thead><tr><th>이름</th><th>직책</th><th>부서</th><th>내선</th></tr></thead>
              <tbody>{people.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.title}</td><td>{p.team}</td><td>{p.ext}</td></tr>)}</tbody></table>
            <p className="muted">※ 사번은 개인정보라 조직도에 표시하지 않습니다. 팀 대표번호: 감사팀 2700 · 영업2팀 3100</p>
          </div>
        )}
        {tab === 'appr' && <div className="pg"><h3>전자결재</h3><p>결재할 문서가 없습니다.</p><p className="muted">최근 승인: [연차] 영업2팀 김○○ 11/03 — 승인자 강○○ 팀장 (참조 감사팀 없음)</p></div>}
        {tab === 'card' && <div className="pg"><h3>법인카드 관리</h3><div className="msgbox">⛔ 재무팀만 접근할 수 있습니다. (발급대장은 재무팀이 공유한 파일을 보세요)</div></div>}
      </div>
    </div>
  )
}

/* ───────── 일정 ───────── */
const WEEKS = ['10/26', '11/02', '11/09']
const dayList = (start: string) => {
  const [m, d] = start.split('/').map(Number)
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(2026, m - 1, d + i)
    return `${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`
  })
}
export function Calendar() {
  const [w, setW] = useState(1)
  const [layers, setLayers] = useState({ work: true, team: true, me: false })
  const days = dayList(WEEKS[w])
  const L: [keyof typeof layers, string, string][] = [['work', '내 일정 (업무)', '#2b6cd1'], ['team', '감사팀 공유', '#1e8a5a'], ['me', '개인', '#c0392b']]
  return (
    <div className="fr-cal">
      <nav>
        <b>내 캘린더</b>
        {L.map(([k, t, col]) => <label key={k}><input type="checkbox" checked={layers[k]} onChange={() => setLayers({ ...layers, [k]: !layers[k] })} /><i style={{ background: col }} />{t}</label>)}
        <p className="muted">개인 일정은 다른 사람에게 "바쁨"으로만 보여요.</p>
      </nav>
      <div className="wk">
        <div className="wh"><button disabled={w === 0} onClick={() => setW(w - 1)}>◀</button><b>2026년 {days[0]} ~ {days[6]}</b><button disabled={w === WEEKS.length - 1} onClick={() => setW(w + 1)}>▶</button><button onClick={() => setW(1)}>오늘</button></div>
        <div className="cols">
          {days.map((d, i) => (
            <div key={d} className={'col' + (d === '11/07' ? ' today' : '')}>
              <div className="dh">{['일', '월', '화', '수', '목', '금', '토'][i]} {d.replace(/^0/, '')}</div>
              {CAL_EVENTS.filter((e) => e.d === d && layers[e.layer]).map((e) => (
                <div key={e.title + e.s} className={'ev ' + e.layer}><time>{e.s}{e.e ? `~${e.e}` : ''}</time>{e.title}</div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ───────── 계산기 ───────── */
export function Calc() {
  const [v, setV] = useState('0')
  const [acc, setAcc] = useState<number | null>(null)
  const [op, setOp] = useState<string | null>(null)
  const [fresh, setFresh] = useState(true)
  const calc = (a: number, b: number, o: string) => (o === '+' ? a + b : o === '−' ? a - b : o === '×' ? a * b : b === 0 ? NaN : a / b)
  const press = (k: string) => {
    if (/^[0-9]$/.test(k)) { setV(fresh || v === '0' ? k : v.length < 14 ? v + k : v); setFresh(false); return }
    if (k === '.') { if (!v.includes('.')) setV((fresh ? '0' : v) + '.'); setFresh(false); return }
    if (k === 'C') { setV('0'); setAcc(null); setOp(null); setFresh(true); return }
    if (k === '⌫') { setV(v.length > 1 ? v.slice(0, -1) : '0'); return }
    const cur = parseFloat(v)
    let res = cur
    if (op && acc !== null && !fresh) { res = calc(acc, cur, op); setV(fmt(res)) }
    if (k === '=') { setAcc(null); setOp(null) } else { setAcc(res); setOp(k) }
    setFresh(true)
  }
  const fmt = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 1e8) / 1e8) : '0으로 나눌 수 없습니다')
  return (
    <div className="fr-calc">
      <div className="disp"><small>{acc !== null ? `${fmt(acc)} ${op}` : ' '}</small>{v.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</div>
      <div className="keys">{['C', '⌫', '÷', '×', '7', '8', '9', '−', '4', '5', '6', '+', '1', '2', '3', '=', '0', '.'].map((k) => <button key={k} className={k === '=' ? 'eq' : /[÷×−+C⌫]/.test(k) ? 'op' : ''} onClick={() => press(k)}>{k}</button>)}</div>
    </div>
  )
}

/* ───────── 소명서 (마지막) ───────── */
export function Soum({ onSend }: { onSend: () => void }) {
  const { s, up } = useGame()
  const [pick, setPick] = useState<EvId | null>(null)
  const [confirm, setConfirm] = useState(false)
  const all = [...CHARGES, ...PROOFS]
  /** 증거는 한 칸에만: 다른 칸에 붙어 있으면 떼어서 옮김 */
  const put = (n: number, ev: EvId) => up((d) => {
    Object.keys(d.slots).forEach((k) => { if (d.slots[+k] === ev) delete d.slots[+k] })
    d.slots[n] = ev
  })
  const filled = all.filter((c) => s.slots[c.n]).length
  const used = new Set(Object.values(s.slots))
  const evs = useMemo(() => EVIDENCE.filter((e) => s.ev.includes(e.id)), [s.ev])
  const slot = (c: Charge) => {
    const e = s.slots[c.n]
    const ev = e && EVIDENCE.find((x) => x.id === e)
    return (
      <div className={'slot' + (pick ? ' armed' : '')} onClick={() => { if (pick) { put(c.n, pick); setPick(null) } }}
        onDragOver={(x) => x.preventDefault()} onDrop={(x) => { const id = x.dataTransfer.getData('text') as EvId; if (id) put(c.n, id) }}>
        {ev ? <>{ev.ico} {ev.name}</> : pick ? '여기에 붙이기' : '반박 증거를 고르고 여기를 누르세요'}
        {e && <button className="fr-x" onClick={(x) => { x.stopPropagation(); up((d) => { delete d.slots[c.n] }) }}>✕</button>}
      </div>
    )
  }
  return (
    <div className="fr-soum">
      <div className="paper">
        <h1>소 명 서</h1>
        <p className="sub">보고서의 주장마다 그것을 뒤집는 증거를 하나씩 붙이세요. 증거 하나는 한 칸에만 쓸 수 있어요.<br />맞는지는 본사 감사위원회가 검토한 뒤에야 알 수 있어요.</p>
        <h4>Ⅰ. 보고서의 주장과 반박</h4>
        {CHARGES.map((c) => (
          <div key={c.n} className={'ch' + (s.slots[c.n] ? ' put' : '')}>
            <span className="n">{c.n}</span>
            <div className="t"><b>{c.title}</b><small>{c.basis}</small></div>
            {slot(c)}
          </div>
        ))}
        <h4>Ⅱ. 진짜 사용자</h4>
        <div className={'ch q' + (s.culprit ? ' put' : '')}>
          <span className="n">?</span>
          <div className="t"><b>법인카드를 실제로 쓴 사람은</b><small>아래 근거 두 가지와 함께 적어 보냅니다</small></div>
          <div className="who">{SUSPECTS.map((p) => <button key={p.id} className={s.culprit === p.id ? 'on' : ''} onClick={() => up((d) => { d.culprit = p.id })}>{p.name}<small>{p.sub}</small></button>)}</div>
        </div>
        {PROOFS.map((c) => (
          <div key={c.n} className={'ch sub2' + (s.slots[c.n] ? ' put' : '')}>
            <span className="n">{c.basis.slice(-1)}</span>
            <div className="t"><b>{c.title}</b><small>{c.basis}</small></div>
            {slot(c)}
          </div>
        ))}
        <div className="fr-send">
          <span>받는 사람: 본사 감사위원회 (Jenny Lee) · 3시 전에 도착해야 함</span>
          <button className="pri" disabled={!s.culprit} onClick={() => setConfirm(true)}>✉️ 전송</button>
        </div>
      </div>
      <aside>
        <h3>내 USB 증거 <b>{s.ev.length} / 7</b></h3>
        {evs.map((e) => (
          <div key={e.id} className={'chip' + (pick === e.id ? ' on' : '') + (used.has(e.id) ? ' used' : '')} draggable onDragStart={(x) => x.dataTransfer.setData('text', e.id)} onClick={() => setPick(pick === e.id ? null : e.id)}>
            {e.ico} {e.name}{used.has(e.id) && <em>붙임</em>}
          </div>
        ))}
        {Array.from({ length: 7 - evs.length }, (_, i) => <div key={i} className="chip none">? 아직 못 찾은 증거</div>)}
      </aside>
      {confirm && (
        <div className="fr-modal-in">
          <div className="fr-dlg">
            <div className="dt">소명서를 보낼까요?</div>
            <p>증거를 붙인 칸 <b>{filled} / {all.length}</b>{filled < all.length && ' (빈칸은 반박하지 않은 것으로 봐요)'}<br />지목한 사람: <b>{SUSPECTS.find((p) => p.id === s.culprit)?.name}</b><br />예약 메일: {s.cancelled ? '취소함' : '아직 예약됨 (3시에 함께 도착)'}</p>
            <p className="muted">보내면 되돌릴 수 없어요.</p>
            <div className="fr-btns"><button onClick={() => setConfirm(false)}>더 찾아보기</button><button className="pri" onClick={onSend}>보내기</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
