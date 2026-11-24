import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react'
import { track } from '../lib/analytics'
import ExcelFrame, { ExcelDialog } from '../puzzle/ExcelFrame'
import { RankPane, RankResult, useRankOpen, useRanks } from '../puzzle/Rank'
import { colName, copyText, fmtMs, loadJSON, saveJSON, useStopwatch } from '../puzzle/common'
import { LEVELS, LEVEL_ORDER, chord, emptyBoard, isWon, neighbors, placeMines, reveal, type Level, type MineBoard } from './logic'

const FILE_NAME = '월간_재고현황_1110.xlsx'
const KEY = 'wollu.mines'
type Status = 'ready' | 'playing' | 'won' | 'lost'
interface Saved { best: Partial<Record<Level, number>>; plays: Partial<Record<Level, number>>; wins: Partial<Record<Level, number>>; chordClick: boolean; level: Level }
const defaults: Saved = { best: {}, plays: {}, wins: {}, chordClick: true, level: 'easy' }

export default function MinesGame() {
  const [saved, setSaved] = useState<Saved>(() => ({ ...defaults, ...loadJSON<Partial<Saved>>(KEY, {}) }))
  const ranks = useRanks('mines')
  const [rankOpen, setRankOpen] = useRankOpen()
  const [level, setLevel] = useState<Level>(saved.level)
  const [board, setBoard] = useState<MineBoard>(() => emptyBoard(saved.level))
  const [status, setStatus] = useState<Status>('ready')
  const [boom, setBoom] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [press, setPress] = useState<'none' | 'one' | 'chord'>('none')
  const [dialog, setDialog] = useState(false)
  const [result, setResult] = useState<{ ms: number; newBest: boolean } | null>(null)
  const [toast, setToast] = useState('')
  const { elapsed, setElapsed } = useStopwatch(status === 'playing')
  const elapsedRef = useRef(0)
  elapsedRef.current = elapsed

  useEffect(() => { saveJSON(KEY, saved) }, [saved])
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? '' : t)), 2200) }

  const L = LEVELS[level]
  const flags = board.flag.filter(Boolean).length

  const newGame = useCallback((lv: Level = level) => {
    setLevel(lv); setBoard(emptyBoard(lv)); setStatus('ready'); setBoom(null); setElapsed(0); setDialog(false); setResult(null)
    setSaved((s) => ({ ...s, level: lv }))
  }, [level, setElapsed])

  // 판이 바뀐 결과를 보고 승패 판정
  const settle = (b: MineBoard, hit: number | null) => {
    if (hit !== null) {
      setBoard({ ...b, open: b.open.map((o, i) => o || (b.mines[i] && !b.flag[i])) })
      setBoom(hit); setStatus('lost'); setDialog(true); setResult(null)
      setSaved((s) => ({ ...s, plays: { ...s.plays, [level]: (s.plays[level] ?? 0) + 1 } }))
      track('puzzle_clear', { game_id: 'mines', level, result: 'lose', seconds: Math.round(elapsedRef.current / 1000) })
      return
    }
    if (isWon(b)) {
      const ms = elapsedRef.current
      setBoard({ ...b, flag: b.mines.map((m) => m) }) // 남은 지뢰는 자동으로 깃발
      setStatus('won')
      const prev = saved.best[level]
      const newBest = prev === undefined || ms < prev
      setSaved((s) => ({ ...s, plays: { ...s.plays, [level]: (s.plays[level] ?? 0) + 1 }, wins: { ...s.wins, [level]: (s.wins[level] ?? 0) + 1 }, best: newBest ? { ...s.best, [level]: ms } : s.best }))
      setResult({ ms, newBest })
      setDialog(true)
      track('puzzle_clear', { game_id: 'mines', level, result: 'win', seconds: Math.round(ms / 1000) })
      return
    }
    setBoard(b)
  }

  const ended = status === 'won' || status === 'lost'

  const openCell = (i: number) => {
    if (ended) return
    let b = board
    if (!b.placed) { b = placeMines(b, L.mines, i); setStatus('playing') }
    if (b.open[i]) {
      if (saved.chordClick) { const r = chord(b, i); if (r.did) settle(r.board, r.hit) }
      return
    }
    const r = reveal(b, i)
    settle(r.board, r.hit)
  }
  const chordCell = (i: number) => {
    if (ended || !board.placed) return
    const r = chord(board, i)
    if (r.did) settle(r.board, r.hit)
  }
  const toggleFlag = (i: number) => {
    if (ended || board.open[i]) return
    setBoard((b) => ({ ...b, flag: b.flag.map((f, j) => (j === i ? !f : f)) }))
  }

  // ── 마우스: 왼쪽 = 열기, 오른쪽 = 깃발, 양쪽 동시·가운데 = 주변 열기 ──
  const btn = useRef({ left: false, right: false, middle: false, chord: false, consumed: false })
  // 마우스 아래 칸: 상태 반영을 기다리지 않도록 ref 로도 바로 기록
  const hoverRef = useRef<number | null>(null)
  const setHoverNow = (i: number | null) => { hoverRef.current = i; setHover(i) }
  const cellAt = (x: number, y: number) => {
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-i]')
    return el ? Number(el.dataset.i) : null
  }
  const act = useRef({ openCell, chordCell, toggleFlag })
  act.current = { openCell, chordCell, toggleFlag }

  const onMouseDown = (e: React.MouseEvent) => {
    if (ended) return
    e.preventDefault()
    const at = Number((e.currentTarget as HTMLElement).dataset.i)
    if (!Number.isNaN(at)) setHoverNow(at)
    const b = btn.current
    if (e.button === 0) b.left = true
    if (e.button === 2) b.right = true
    if (e.button === 1) b.middle = true
    if ((b.left && b.right) || b.middle) { b.chord = true; setPress('chord'); return }
    if (e.button === 2) { const i = hoverRef.current; if (i !== null) act.current.toggleFlag(i); b.consumed = true; return }
    if (e.button === 0) setPress('one')
  }
  useEffect(() => {
    const up = (e: MouseEvent) => {
      const b = btn.current
      const wasDown = b.left || b.right || b.middle
      if (!wasDown) return
      const i = cellAt(e.clientX, e.clientY)
      if (b.chord && !b.consumed) { if (i !== null) act.current.chordCell(i); b.consumed = true }
      else if (e.button === 0 && !b.consumed && i !== null) act.current.openCell(i)
      if (e.button === 0) b.left = false
      if (e.button === 2) b.right = false
      if (e.button === 1) b.middle = false
      if (!b.left && !b.right && !b.middle) { b.chord = false; b.consumed = false; setPress('none') }
      else if (b.chord) setPress('none')
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  // ── 키보드: Space = 깃발/주변 열기, F2 = 새 판 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.boss')) return
      if (e.key === 'F2') { e.preventDefault(); newGame(); return }
      if (e.code === 'Space') {
        e.preventDefault()
        const i = hoverRef.current
        if (i === null) return
        if (board.open[i]) act.current.chordCell(i); else act.current.toggleFlag(i)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [board, newGame])

  // ── 터치: 짧게 = 열기(숫자면 주변 열기), 길게 = 깃발 ──
  const touch = useRef<{ t: number | null; long: boolean }>({ t: null, long: false })
  const onTouchStart = (i: number) => {
    setHoverNow(i)
    touch.current.long = false
    touch.current.t = window.setTimeout(() => { touch.current.long = true; act.current.toggleFlag(i); navigator.vibrate?.(20) }, 380)
  }
  const onTouchEnd = (e: TouchEvent, i: number) => {
    e.preventDefault()
    if (touch.current.t) window.clearTimeout(touch.current.t)
    if (!touch.current.long) { if (board.open[i]) chordCell(i); else openCell(i) }
  }

  // 누르고 있는 칸 (눌린 모양)
  const pressed = useMemo(() => {
    const s = new Set<number>()
    if (hover === null || ended || press === 'none') return s
    const cand = press === 'chord' ? [hover, ...neighbors(board, hover)] : [hover]
    for (const i of cand) if (!board.open[i] && !board.flag[i]) s.add(i)
    return s
  }, [hover, press, board, ended])

  const hx = hover !== null ? hover % board.w : -1
  const hy = hover !== null ? Math.floor(hover / board.w) : -1
  const nameBox = hover !== null ? `${colName(1 + hx)}${hy + 2}` : 'A1'
  const formula = hover === null ? ''
    : board.flag[hover] && !(ended && board.open[hover]) ? '="점검 필요"'
      : board.open[hover] && !board.mines[hover] ? `=COUNTIF(주변,"지뢰")  → ${board.counts[hover]}`
        : ''
  const best = saved.best[level]
  const share = async () => {
    if (!result) return
    await copyText(`지뢰찾기 ${L.label} ${fmtMs(result.ms)} ⏱${result.newBest ? ' (개인 최고!)' : ''}\n${location.origin}/mines`)
    track('share_result', { game_id: 'mines' })
    flash('결과를 복사했어요. 메신저에 붙여 넣어 보세요')
  }

  const extraCols = 5
  return (
    <ExcelFrame
      fileName={FILE_NAME}
      nameBox={nameBox}
      formula={formula}
      tools={<>
        <div className="grp">{LEVEL_ORDER.map((lv) => (
          <button key={lv} className={lv === level ? 'on' : ''} onClick={() => newGame(lv)}>{LEVELS[lv].label} {LEVELS[lv].w}×{LEVELS[lv].h}</button>
        ))}</div>
        <div className="grp"><button onClick={() => newGame()}>↺ 새 판 (F2)</button></div>
        <div className="grp hint-txt">왼쪽: 열기 · 오른쪽: 깃발 · 양쪽 동시/가운데: 주변 열기 · Space: 깃발</div>
        <div className="grp">
          <label className="chk"><input type="checkbox" checked={saved.chordClick} onChange={(e) => setSaved((s) => ({ ...s, chordClick: e.target.checked }))} /> 숫자 클릭으로 주변 열기</label>
        </div>
        <div className="grp"><button className={rankOpen ? 'on' : ''} onClick={() => setRankOpen(!rankOpen)}>🏆 {rankOpen ? '기록 숨기기' : '기록'}</button></div>
      </>}
      side={<RankPane game="mines" level={level} ranks={ranks} liveMs={status === 'playing' ? elapsed : null} open={rankOpen} setOpen={setRankOpen} />}
      tabs={<><button className="on">재고점검</button><span className="plus">+</span></>}
      status={<>
        <span>{status === 'ready' ? '첫 칸을 클릭하면 시작' : status === 'playing' ? '점검 중' : status === 'won' ? '완료' : '오류'}</span>
        <span>⏱ <b>{fmtMs(elapsed)}</b></span>
        <span>남은 지뢰 <b>{L.mines - flags}</b> / {L.mines}</span>
        <span className="sp" />
        <span>{L.label} 최고 기록 {best !== undefined ? fmtMs(best) : '-'}</span><span>100%</span>
      </>}
      overlay={<>
        {dialog && status === 'won' && result && (
          <ExcelDialog title="점검 결과" onClose={() => setDialog(false)} buttons={<>
            <button className="ok" onClick={() => newGame()}>다시 하기</button>
            <button onClick={share}>결과 복사</button>
            <button onClick={() => setDialog(false)}>닫기</button>
          </>}>
            <p><b>재고 점검이 완료되었습니다. {fmtMs(result.ms)}</b></p>
            <p className="muted">{L.label} · {result.newBest ? '🎉 개인 최고 기록!' : `최고 기록 ${best !== undefined ? fmtMs(best) : '-'}`}</p>
            <RankResult game="mines" level={level} ms={result.ms} counted ranks={ranks} />
          </ExcelDialog>
        )}
        {dialog && status === 'lost' && (
          <ExcelDialog title="점검 결과" icon="!" warn onClose={() => setDialog(false)} buttons={<>
            <button className="ok" onClick={() => newGame()}>다시 하기</button>
            <button onClick={() => setDialog(false)}>판 보기</button>
          </>}>
            <p><b>오류가 발생했습니다. 지뢰를 밟았어요.</b></p>
            <p className="muted">{L.label} · {fmtMs(elapsed)} 진행</p>
          </ExcelDialog>
        )}
        {toast && <div className="wb-toast">{toast}</div>}
      </>}
    >
      <table className="wb-grid ms-grid" onContextMenu={(e) => e.preventDefault()} onMouseLeave={() => setHoverNow(null)}>
        <colgroup><col className="rh" /><col style={{ width: 24 }} />{Array.from({ length: board.w }, (_, i) => <col key={i} style={{ width: 26 }} />)}{Array.from({ length: extraCols }, (_, i) => <col key={'x' + i} style={{ width: 64 }} />)}</colgroup>
        <thead><tr><th />{Array.from({ length: board.w + 1 + extraCols }, (_, c) => <th key={c} className={c === 1 + hx ? 'on' : ''}>{colName(c)}</th>)}</tr></thead>
        <tbody>
          <tr><th>1</th><td /><td colSpan={board.w + extraCols} className="t1">재고 점검표 · {L.label} ({L.w}×{L.h} · 지뢰 {L.mines})</td></tr>
          {Array.from({ length: board.h }, (_, y) => (
            <tr key={y} className="ms-row">
              <th className={y === hy ? 'on' : ''}>{y + 2}</th>
              <td />
              {y === 0 && (
                // 판은 표 칸이 아니라 별도 격자로 그린다: 바깥 테두리가 또렷하고, 화면 배율에서도 선 굵기가 일정
                <td colSpan={board.w} rowSpan={board.h} className="ms-board-td">
                  <div className="ms-board" style={{ gridTemplateColumns: `repeat(${board.w}, 26px)` }}>
                    {Array.from({ length: board.w * board.h }, (_, i) => {
                      const open = board.open[i]
                      let cls = 'm'
                      let txt = ''
                      if (ended && board.flag[i] && !board.mines[i]) { cls += ' wrong'; txt = '✕' }
                      else if (board.flag[i]) { cls += ' f'; txt = '▲' }
                      else if (open && board.mines[i]) { cls += i === boom ? ' boom' : ' mine'; txt = '●' }
                      else if (open) { cls += ' o'; if (board.counts[i]) { txt = String(board.counts[i]); cls += ' n' + board.counts[i] } }
                      else cls += pressed.has(i) ? ' p' : ' c'
                      if (i % board.w === board.w - 1) cls += ' er'
                      if (i >= board.w * (board.h - 1)) cls += ' eb'
                      return (
                        <div key={i} data-i={i} className={cls} onMouseDown={onMouseDown} onMouseEnter={() => setHoverNow(i)}
                          onTouchStart={() => onTouchStart(i)} onTouchEnd={(e) => onTouchEnd(e, i)} onTouchMove={() => { if (touch.current.t) window.clearTimeout(touch.current.t) }}>
                          {txt}
                        </div>
                      )
                    })}
                  </div>
                </td>
              )}
              {Array.from({ length: extraCols }, (_, c) => <td key={'x' + c} />)}
            </tr>
          ))}
          {Array.from({ length: 10 }, (_, k) => <tr key={'e' + k}><th>{board.h + 2 + k}</th>{Array.from({ length: board.w + 1 + extraCols }, (_, c) => <td key={c} />)}</tr>)}
        </tbody>
      </table>
    </ExcelFrame>
  )
}
