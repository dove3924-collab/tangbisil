import { useEffect, useRef, useState } from 'react'
import ExcelFrame, { ExcelDialog } from '../puzzle/ExcelFrame'
import { colName, copyText, fmtMs, loadJSON, saveJSON, useStopwatch } from '../puzzle/common'
import { track } from '../lib/analytics'
import { DEPTS, LETTERS, LEVELS, LEVEL_ORDER, complete, endColor, generate, owner, stats, type Level, type Paths, type Puzzle } from './logic'
import { LinkSvg, useCellSize, useLinkPlay } from './Board'
import './link.css'

export const FILE_NAME = '부서별_셀_링크_정리.xlsx'
const KEY = 'wollu.link'

interface Game { p: Puzzle; paths: Paths; elapsed: number; no: number; done?: number }
interface Saved { level: Level; games: Partial<Record<Level, Game>>; solved: Partial<Record<Level, number>> }
const defaults: Saved = { level: 'easy', games: {}, solved: {} }

/** 이름 상자·수식 칸 내용 */
export function cellInfo(p: Puzzle, paths: Paths, focus: number | null) {
  if (focus === null) return { nameBox: 'C3', formula: '' }
  const n = p.n
  const nameBox = `${colName(2 + (focus % n))}${Math.floor(focus / n) + 3}`
  const ec = endColor(p, focus), oc = owner(paths, focus)
  const formula = ec >= 0 ? `=LINK("${LETTERS[ec]}", ${DEPTS[ec]})${complete(p, paths, ec) ? ' → 연결됨' : ''}`
    : oc >= 0 ? `=LINK("${LETTERS[oc]}")` : '=EMPTY()'
  return { nameBox, formula }
}

/** 판이 들어가는 엑셀 표 (행·열 머리 포함) */
export function LinkSheet({ n, cs, focus, title, sub, children }: { n: number; cs: number; focus: number | null; title: string; sub: string; children: React.ReactNode }) {
  const fx = focus !== null ? focus % n : -1, fy = focus !== null ? Math.floor(focus / n) : -1
  const extraCols = 4
  return (
    <table className="wb-grid lk-grid">
      <colgroup><col className="rh" /><col style={{ width: 24 }} />{Array.from({ length: n }, (_, i) => <col key={i} style={{ width: cs }} />)}{Array.from({ length: extraCols }, (_, i) => <col key={'x' + i} style={{ width: 64 }} />)}</colgroup>
      <thead><tr><th />{Array.from({ length: n + 1 + extraCols }, (_, c) => <th key={c} className={c === 1 + fx ? 'on' : ''}>{colName(c)}</th>)}</tr></thead>
      <tbody>
        <tr><th>1</th><td /><td colSpan={n + extraCols} className="t1">{title}</td></tr>
        <tr><th>2</th><td /><td colSpan={n + extraCols} className="lk-sub">{sub}</td></tr>
        {Array.from({ length: n }, (_, y) => (
          <tr key={y} className="lk-row" style={{ height: cs }}>
            <th className={y === fy ? 'on' : ''}>{y + 3}</th>
            <td />
            {y === 0 && <td colSpan={n} rowSpan={n} className="lk-board-td">{children}</td>}
            {Array.from({ length: extraCols }, (_, c) => <td key={'x' + c} />)}
          </tr>
        ))}
        {Array.from({ length: 8 }, (_, k) => <tr key={'e' + k}><th>{n + 3 + k}</th>{Array.from({ length: n + 1 + extraCols }, (_, c) => <td key={c} />)}</tr>)}
      </tbody>
    </table>
  )
}

export default function LinkGame() {
  const [saved, setSaved] = useState<Saved>(() => ({ ...defaults, ...loadJSON<Partial<Saved>>(KEY, {}) }))
  const level = saved.level
  const game = saved.games[level]
  const p = game?.p ?? null
  const cs = useCellSize(p?.n ?? LEVELS[level].n, 260)
  const [dialog, setDialog] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => { if (!game) setSaved((s) => ({ ...s, games: { ...s.games, [level]: { p: generate(level), paths: [], elapsed: 0, no: 1 } } })) }, [game, level])
  useEffect(() => { saveJSON(KEY, saved) }, [saved])

  const ended = game?.done !== undefined
  const { elapsed, setElapsed } = useStopwatch(!!p && !ended)
  const elapsedRef = useRef(0)
  elapsedRef.current = elapsed
  useEffect(() => { setElapsed(game?.done ?? game?.elapsed ?? 0); setDialog(false) }, [level, game?.no]) // eslint-disable-line react-hooks/exhaustive-deps
  const sec = Math.floor(elapsed / 1000)
  useEffect(() => { setSaved((s) => (s.games[s.level] && s.games[s.level]!.done === undefined ? { ...s, games: { ...s.games, [s.level]: { ...s.games[s.level]!, elapsed: elapsedRef.current } } } : s)) }, [sec])

  const setPaths = (fn: (x: Paths) => Paths) => setSaved((s) => {
    const g = s.games[s.level]
    if (!g || g.done !== undefined) return s
    const cur = g.paths.length === g.p.ends.length ? g.paths : g.p.ends.map(() => [])
    return { ...s, games: { ...s.games, [s.level]: { ...g, paths: fn(cur), elapsed: elapsedRef.current } } }
  })
  const newGame = (lv: Level = level) => setSaved((s) => ({ ...s, level: lv, games: { ...s.games, [lv]: { p: generate(lv), paths: [], elapsed: 0, no: (s.games[lv]?.no ?? 0) + 1 } } }))
  const play = useLinkPlay({ p, paths: game?.paths ?? [], setPaths, cs, enabled: !!p && !ended, resetKey: `${level}.${game?.no}` })
  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast(''), 2200) }

  // F2 새 판
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'F2') { e.preventDefault(); newRef.current() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  const newRef = useRef(() => newGame())
  newRef.current = () => newGame()

  // 다 채우면 완료
  const st = p ? stats(p, play.full) : null
  useEffect(() => {
    if (!p || !st?.solved || ended) return
    const ms = elapsedRef.current
    setSaved((s) => ({ ...s, solved: { ...s.solved, [level]: (s.solved[level] ?? 0) + 1 }, games: { ...s.games, [level]: { ...s.games[level]!, done: ms, elapsed: ms } } }))
    setDialog(true)
    track('puzzle_clear', { game_id: 'link', level, result: 'win', seconds: Math.round(ms / 1000) })
  }, [st?.solved]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!p || !game || !st) return <div className="wb"><p style={{ margin: 'auto' }}>시트 준비 중…</p></div>

  const L = LEVELS[level]
  const focus = play.cursor ?? play.hover
  const { nameBox, formula } = cellInfo(p, play.full, focus)
  const share = async () => {
    if (game.done === undefined) return
    await copyText(`셀 링크 ${L.label} ${fmtMs(game.done)} ⏱\n${location.origin}/link`)
    track('share_result', { game_id: 'link' })
    flash('결과를 복사했어요. 메신저에 붙여 넣어 보세요')
  }
  const pct = st.pct

  return (
    <ExcelFrame
      fileName={FILE_NAME}
      nameBox={nameBox}
      formula={formula}
      tools={<>
        <div className="grp">{LEVEL_ORDER.map((lv) => (
          <button key={lv} className={lv === level ? 'on' : ''} onClick={() => lv !== level && setSaved((s) => ({ ...s, level: lv }))}>{LEVELS[lv].label} {LEVELS[lv].n}×{LEVELS[lv].n}</button>
        ))}</div>
        <div className="grp">
          <button onClick={play.undo} disabled={ended || !play.canUndo}>↶ 되돌리기</button>
          <button onClick={play.reset} disabled={ended || st.filled === p.ends.length * 2}>처음부터</button>
          <button onClick={() => newGame()}>↺ 새 판 (F2)</button>
        </div>
        <div className="grp hint-txt">같은 글자끼리 드래그로 잇기 · 선끼리 겹치면 안 돼요 · 빈칸 없이 다 채우면 완료</div>
      </>}
      tabs={<><button className="on">셀 링크</button><span className="plus">+</span></>}
      status={<>
        <span>{ended ? '링크 완료' : play.active !== null ? `${LETTERS[play.active]} 잇는 중` : '준비'}</span>
        <span>⏱ <b>{fmtMs(elapsed)}</b></span>
        <span>연결 <b>{st.linked}</b> / {st.pairs}</span>
        <span>칸 채움 <b>{pct}%</b></span>
        <span className="sp" />
        <span>{L.label} 완료 {saved.solved[level] ?? 0}번</span>
        <span className="hide-sm">방향키 이동 · Space 긋기 시작/끝 · Ctrl+Z 되돌리기 · F2 새 판</span>
      </>}
      overlay={<>
        {dialog && game.done !== undefined && (
          <ExcelDialog title="링크 완료" onClose={() => setDialog(false)} buttons={<>
            <button className="ok" onClick={() => newGame()}>새 판</button>
            <button onClick={share}>결과 복사</button>
            <button onClick={() => setDialog(false)}>판 보기</button>
          </>}>
            <p><b>모든 셀이 연결됐어요. {fmtMs(game.done)}</b></p>
            <p className="muted">{L.label} {L.n}×{L.n} · 링크 {st.pairs}개</p>
          </ExcelDialog>
        )}
        {toast && <div className="wb-toast">{toast}</div>}
      </>}
    >
      <LinkSheet n={p.n} cs={cs} focus={focus} title={`셀 링크 · ${L.label} (${p.n}×${p.n} · ${st.pairs}쌍)`} sub="같은 글자끼리 셀을 이어 주세요. 선은 겹칠 수 없고, 빈칸 없이 다 채워야 완료돼요.">
        <LinkSvg p={p} paths={play.full} cs={cs} active={play.active} cursor={play.cursor} done={ended} svgRef={play.svgRef} handlers={ended ? undefined : play.handlers} />
      </LinkSheet>
    </ExcelFrame>
  )
}
