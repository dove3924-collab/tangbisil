import { useMemo } from 'react'

const DEPTS = ['영업1팀', '영업2팀', '마케팅팀', '개발팀', '인사팀', '재무팀', '구매팀', '품질관리팀', '고객지원팀', '총무팀', '법무팀', '기획팀', '물류팀', '디자인팀', '연구소', '해외사업팀']
const ITEMS = ['인건비', '복리후생비', '여비교통비', '소모품비', '교육훈련비', '지급수수료']
const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']

function seeded(seed: number) {
  return () => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
}

/** 보스키 화면: 지루한 예산 집계 엑셀. 광고 없음. */
export default function BossScreen() {
  const rows = useMemo(() => {
    const r = seeded(42)
    return DEPTS.map((d) => {
      const vals = ITEMS.map(() => Math.round(r() * 90000 + 5000) * 1000)
      return { d, vals, sum: vals.reduce((a, b) => a + b, 0) }
    })
  }, [])
  const fmt = (n: number) => n.toLocaleString('ko-KR')

  return (
    <div className="boss">
      <div className="boss-title">
        <span className="boss-logo">X</span> Q3_예산집계_최종_v2.xlsx
      </div>
      <div className="boss-ribbon">
        {['파일', '홈', '삽입', '페이지 레이아웃', '수식', '데이터', '검토', '보기'].map((t, i) => (
          <span key={t} className={i === 1 ? 'on' : ''}>{t}</span>
        ))}
      </div>
      <div className="boss-formula">
        <span className="boss-cell">H18</span>
        <span className="boss-fx">fx</span>
        <span>=SUM(B18:G18)</span>
      </div>
      <div className="boss-grid-wrap">
        <table className="boss-grid">
          <thead>
            <tr>
              <th></th>
              {COLS.map((c) => <th key={c}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>1</th>
              <td colSpan={10} className="b">2026년 3분기 부서별 예산 집행 현황 (단위: 원)</td>
            </tr>
            <tr>
              <th>2</th>
              <td className="h">부서</td>
              {ITEMS.map((i) => <td key={i} className="h">{i}</td>)}
              <td className="h">합계</td>
              <td className="h">비고</td>
              <td></td>
            </tr>
            {rows.map((row, idx) => (
              <tr key={row.d}>
                <th>{idx + 3}</th>
                <td>{row.d}</td>
                {row.vals.map((v, i) => <td key={i} className="n">{fmt(v)}</td>)}
                <td className="n b">{fmt(row.sum)}</td>
                <td></td>
                <td></td>
              </tr>
            ))}
            <tr>
              <th>{rows.length + 3}</th>
              <td className="b">총계</td>
              {ITEMS.map((_, i) => (
                <td key={i} className="n b">{fmt(rows.reduce((a, r) => a + r.vals[i], 0))}</td>
              ))}
              <td className="n b sel">{fmt(rows.reduce((a, r) => a + r.sum, 0))}</td>
              <td></td>
              <td></td>
            </tr>
            {Array.from({ length: 12 }, (_, i) => (
              <tr key={'e' + i}>
                <th>{rows.length + 4 + i}</th>
                {COLS.map((c) => <td key={c}></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="boss-tabs">
        <span className="on">집계</span><span>원자료</span><span>전분기</span>
      </div>
    </div>
  )
}
