import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { track } from '../lib/analytics'
import ExcelFrame, { ExcelDialog } from '../puzzle/ExcelFrame'
import { RankPane, RankResult, useRankOpen, useRanks } from '../puzzle/Rank'
import { colName, copyText, fmtMs, isAway, loadJSON, saveJSON, useStopwatch } from '../puzzle/common'
import { LEVELS, LEVEL_ORDER, PEERS, box, candidates, col, generate, row, type Level } from './logic'

const FILE_NAME = '부서별_예산배분_Q4.xlsx'
const KEY = 'wollu.sudoku'
interface Game { puzzle: number[]; solution: number[]; values: number[]; memos: number[]; mistakes: number; hints: number; elapsed: number; done: boolean }
interface Saved { level: Level; games: Partial<Record<Level, Game>>; best: Partial<Record<Level, number>>; wins: Partial<Record<Level, number>> }
const defaults: Saved = { level: 'easy', games: {}, best: {}, wins: {} }

function newGameOf(level: Level): Game {
  const { puzzle, solution } = generate(level)
  return { puzzle, solution, values: puzzle.slice(), memos: Array(81).fill(0), mistakes: 0, hints: 0, elapsed: 0, done: false }
}

export default function SudokuGame() {
  const [saved, setSaved] = useState<Saved>(() => ({ ...defaults, ...loadJSON<Partial<Saved>>(KEY, {}) }))
  const ranks = useRanks('sudoku')
  const [rankOpen, setRankOpen] = useRankOpen()
  const level = saved.level
  const game = saved.games[level] ?? null
  const [sel, setSel] = useState<number | null>(null)
  const [memoMode, setMemoMode] = useState(false)
  const [paused, setPaused] = useState(false)
  const [dialog, setDialog] = useState<null | 'win'>(null)
  const [result, setResult] = useState<{ ms: number; newBest: boolean; counted: boolean } | null>(null)
  const [toast, setToast] = useState('')
  const undo = useRef<{ values: number[]; memos: number[] }[]>([])
  const running = !!game && !game.done
  const { elapsed, setElapsed } = useStopwatch(running, paused)
  const elapsedRef = useRef(0)
  elapsedRef.current = elapsed

  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? '' : t)), 2200) }

  // 이 레벨 판이 없으면 새로 만들기
  useEffect(() => {
    if (!saved.games[level]) setSaved((s) => ({ ...s, games: { ...s.games, [level]: newGameOf(level) } }))
  }, [level, saved.games])
  // 레벨을 바꾸면 그 판의 시간부터 이어서
  useEffect(() => { setElapsed(saved.games[level]?.elapsed ?? 0); setSel(null); undo.current = [] }, [level]) // eslint-disable-line react-hooks/exhaustive-deps

  // 저장: 판이 바뀔 때마다, 시간은 1초마다
  const sec = Math.floor(elapsed / 1000)
  useEffect(() => {
    setSaved((s) => (s.games[level] && !s.games[level]!.done ? { ...s, games: { ...s.games, [level]: { ...s.games[level]!, elapsed: elapsedRef.current } } } : s))
  }, [sec]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { saveJSON(KEY, saved) }, [saved])

  // 다른 탭·보스 화면으로 가면 자동 일시정지 (판을 가림)
  useEffect(() => {
    if (!running) return
    const iv = window.setInterval(() => { if (isAway()) setPaused(true) }, 300)
    return () => window.clearInterval(iv)
  }, [running])

  const update = (fn: (g: Game) => Game, pushUndo = true) => {
    if (!game || game.done) return
    if (pushUndo) { undo.current.push({ values: game.values, memos: game.memos }); if (undo.current.length > 200) undo.current.shift() }
    const next = fn({ ...game, elapsed: elapsedRef.current }) // 상태 갱신 함수 밖에서 계산 (완료 처리 부작용이 두 번 돌지 않게)
    setSaved((s) => ({ ...s, games: { ...s.games, [level]: next } }))
  }

  const finishIfSolved = (g: Game): Game => {
    if (!g.values.every((v, i) => v === g.solution[i])) return g
    const ms = elapsedRef.current
    const counted = g.hints === 0 // 힌트를 쓰면 최고 기록에는 안 들어감
    const prev = saved.best[level]
    const newBest = counted && (prev === undefined || ms < prev)
    setSaved((s) => ({ ...s, wins: { ...s.wins, [level]: (s.wins[level] ?? 0) + 1 }, best: newBest ? { ...s.best, [level]: ms } : s.best }))
    setResult({ ms, newBest, counted })
    window.setTimeout(() => setDialog('win'), 250)
    track('puzzle_clear', { game_id: 'sudoku', level, result: 'win', seconds: Math.round(ms / 1000), hints: g.hints, mistakes: g.mistakes })
    return { ...g, done: true, elapsed: ms }
  }

  const clearPeerMemos = (memos: number[], i: number, d: number) => {
    const m = memos.slice()
    for (const j of PEERS[i]) m[j] &= ~(1 << d)
    m[i] = 0
    return m
  }

  const input = (d: number) => {
    if (!game || game.done || paused || sel === null || game.puzzle[sel]) return
    if (memoMode) {
      if (game.values[sel]) return
      update((g) => ({ ...g, memos: g.memos.map((m, i) => (i === sel ? m ^ (1 << d) : m)) }))
      return
    }
    update((g) => {
      if (g.values[sel] === d) return { ...g, values: g.values.map((v, i) => (i === sel ? 0 : v)) }
      const values = g.values.map((v, i) => (i === sel ? d : v))
      const wrong = d !== g.solution[sel]
      return finishIfSolved({ ...g, values, mistakes: g.mistakes + (wrong ? 1 : 0), memos: wrong ? g.memos : clearPeerMemos(g.memos, sel, d) })
    })
  }
  const erase = () => {
    if (!game || game.done || paused || sel === null || game.puzzle[sel]) return
    update((g) => ({ ...g, values: g.values.map((v, i) => (i === sel ? 0 : v)), memos: g.memos.map((m, i) => (i === sel ? 0 : m)) }))
  }
  const doUndo = () => {
    const last = undo.current.pop()
    if (!last || !game || game.done) return
    update((g) => ({ ...g, values: last.values, memos: last.memos }), false)
  }
  const hint = () => {
    if (!game || game.done || paused) return
    const bad = (i: number) => !game.puzzle[i] && game.values[i] !== game.solution[i]
    const target = sel !== null && bad(sel) ? sel : game.values.findIndex((_, i) => bad(i))
    if (target < 0) return
    setSel(target)
    update((g) => finishIfSolved({ ...g, values: g.values.map((v, i) => (i === target ? g.solution[i] : v)), hints: g.hints + 1, memos: clearPeerMemos(g.memos, target, g.solution[target]) }))
  }
  const autoMemo = () => {
    if (!game || game.done || paused) return
    update((g) => ({ ...g, memos: g.values.map((v, i) => (v ? 0 : candidates(g.values, i))) }))
    flash('빈칸에 들어갈 수 있는 숫자를 메모로 채웠어요')
  }
  const newSheet = useCallback((lv: Level = level) => {
    setSaved((s) => ({ ...s, level: lv, games: { ...s.games, [lv]: newGameOf(lv) } }))
    setElapsed(0); setSel(null); setDialog(null); setResult(null); setPaused(false); undo.current = []
  }, [level, setElapsed])
  const switchLevel = (lv: Level) => { if (lv !== level) { setSaved((s) => ({ ...s, level: lv })); setDialog(null); setPaused(false) } }

  // ── 키보드: 1~9 입력, 방향키 이동, Backspace/Delete 지우기, N 메모, Ctrl+Z 되돌리기 ──
  const act = useRef({ input, erase, doUndo })
  act.current = { input, erase, doUndo }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.boss')) return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); act.current.doUndo(); return }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const digit = /^(Digit|Numpad)([1-9])$/.exec(e.code)
      if (digit) { e.preventDefault(); act.current.input(Number(digit[2])); return }
      if (['Backspace', 'Delete'].includes(e.key) || e.code === 'Digit0' || e.code === 'Numpad0') { e.preventDefault(); act.current.erase(); return }
      if (e.code === 'KeyN' || e.code === 'Space') { e.preventDefault(); setMemoMode((m) => !m); return }
      const mv: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
      if (mv[e.key]) {
        e.preventDefault()
        setSel((s) => {
          if (s === null) return 40
          const r = (row(s) + mv[e.key][0] + 9) % 9, c = (col(s) + mv[e.key][1] + 9) % 9
          return r * 9 + c
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const counts = useMemo(() => {
    const c = Array(10).fill(0)
    if (game) game.values.forEach((v, i) => { if (v && v === game.solution[i]) c[v]++ })
    return c
  }, [game])
  const selVal = game && sel !== null ? game.values[sel] : 0
  const remaining = game ? game.values.filter((v, i) => v !== game.solution[i]).length : 0
  const best = saved.best[level]
  const L = LEVELS[level]

  const share = async () => {
    if (!result || !game) return
    await copyText(`스도쿠 ${L.label} ${fmtMs(result.ms)}${game.hints ? ` (힌트 ${game.hints})` : ''} ⏱${result.newBest ? ' 개인 최고!' : ''}\n${location.origin}/sudoku`)
    track('share_result', { game_id: 'sudoku' })
    flash('결과를 복사했어요. 메신저에 붙여 넣어 보세요')
  }

  const nameBox = sel !== null ? `${colName(1 + col(sel))}${row(sel) + 2}` : 'A1'
  const formula = sel === null || !game ? '' : game.puzzle[sel] ? `${game.values[sel]}  (고정값)` : game.values[sel] ? String(game.values[sel]) : game.memos[sel] ? `메모: ${[1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => game.memos[sel] & (1 << d)).join(', ')}` : ''

  return (
    <ExcelFrame
      fileName={FILE_NAME}
      nameBox={nameBox}
      formula={formula}
      tools={<>
        <div className="grp">{LEVEL_ORDER.map((lv) => <button key={lv} className={lv === level ? 'on' : ''} onClick={() => switchLevel(lv)}>{LEVELS[lv].label}</button>)}</div>
        <div className="grp"><button onClick={() => newSheet()}>↺ 새 시트</button></div>
        <div className="grp">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
            <button key={d} className={'num' + (counts[d] >= 9 ? ' full' : '') + (selVal === d ? ' sel' : '')} onMouseDown={(e) => e.preventDefault()} onClick={() => input(d)}>
              {d}<small>{9 - counts[d] || ''}</small>
            </button>
          ))}
        </div>
        <div className="grp">
          <button className={memoMode ? 'on' : ''} onClick={() => setMemoMode((m) => !m)}>✎ 메모 {memoMode ? '켜짐' : '꺼짐'} (N)</button>
          <button onClick={erase}>⌫ 지우기</button>
          <button onClick={doUndo}>↶ 되돌리기</button>
        </div>
        <div className="grp">
          <button onClick={autoMemo}>자동 메모</button>
          <button onClick={hint}>💡 힌트</button>
          <button disabled={!running} onClick={() => setPaused((p) => !p)}>{paused ? '▶ 계속' : '⏸ 일시정지'}</button>
        </div>
        <div className="grp"><button className={rankOpen ? 'on' : ''} onClick={() => setRankOpen(!rankOpen)}>🏆 {rankOpen ? '기록 숨기기' : '기록'}</button></div>
      </>}
      side={<RankPane game="sudoku" level={level} ranks={ranks} liveMs={game && !game.done ? elapsed : null} open={rankOpen} setOpen={setRankOpen} />}
      tabs={<><button className="on">예산배분</button><span className="plus">+</span></>}
      status={<>
        <span>{game?.done ? '완료' : paused ? '일시정지' : '준비'}</span>
        <span>⏱ <b>{fmtMs(game?.done ? game.elapsed : elapsed)}</b></span>
        <span>남은 칸 <b>{remaining}</b></span>
        <span>실수 <b>{game?.mistakes ?? 0}</b> · 힌트 <b>{game?.hints ?? 0}</b></span>
        <span className="sp" />
        <span>{L.label} 최고 기록 {best !== undefined ? fmtMs(best) : '-'}</span><span>100%</span>
      </>}
      overlay={<>
        {dialog === 'win' && result && game && (
          <ExcelDialog title="검토 결과" onClose={() => setDialog(null)} buttons={<>
            <button className="ok" onClick={() => newSheet()}>새 시트</button>
            <button onClick={share}>결과 복사</button>
            <button onClick={() => setDialog(null)}>닫기</button>
          </>}>
            <p><b>예산 배분 검토가 완료되었습니다. {fmtMs(result.ms)}</b></p>
            <p className="muted">{L.label} · 실수 {game.mistakes} · 힌트 {game.hints}</p>
            <p className="muted">{result.newBest ? '🎉 개인 최고 기록!' : !result.counted ? '힌트를 쓴 판은 최고 기록에 들어가지 않아요' : `최고 기록 ${best !== undefined ? fmtMs(best) : '-'}`}</p>
            <RankResult game="sudoku" level={level} ms={result.ms} counted={result.counted} ranks={ranks} />
          </ExcelDialog>
        )}
        {toast && <div className="wb-toast">{toast}</div>}
      </>}
    >
      <table className="wb-grid sd-grid">
        <colgroup><col className="rh" /><col style={{ width: 24 }} />{Array.from({ length: 9 }, (_, i) => <col key={i} style={{ width: 38 }} />)}{Array.from({ length: 5 }, (_, i) => <col key={'x' + i} style={{ width: 64 }} />)}</colgroup>
        <thead><tr><th />{Array.from({ length: 15 }, (_, c) => <th key={c} className={sel !== null && c === 1 + col(sel) ? 'on' : ''}>{colName(c)}</th>)}</tr></thead>
        <tbody>
          <tr><th>1</th><td /><td colSpan={13} className="t1">부서별 예산 배분표 · {L.label} {game?.done ? '· 검토 완료' : ''}</td></tr>
          {Array.from({ length: 9 }, (_, r) => (
            <tr key={r} className="sd-row">
              <th className={sel !== null && r === row(sel) ? 'on' : ''}>{r + 2}</th>
              <td />
              {r === 0 && (
                // 판은 표 칸이 아니라 별도 격자로 그린다: 표 테두리는 화면 배율(125% 등)에서 굵기가 들쭉날쭉해짐
                <td colSpan={9} rowSpan={9} className="sd-board-td">
                  <div className="sd-board">
                    {Array.from({ length: 81 }, (_, i) => {
                      if (!game) return <div key={i} className="s" />
                      const v = game.values[i]
                      const given = !!game.puzzle[i]
                      let cls = 's ' + (given ? 'g' : 'u')
                      if (v && v !== game.solution[i]) cls += ' bad'
                      if (sel !== null) {
                        if (i === sel) cls += ' sel'
                        else if (selVal && v === selVal) cls += ' same'
                        else if (row(i) === row(sel) || col(i) === col(sel) || box(i) === box(sel)) cls += ' zone'
                      }
                      if (col(i) % 3 === 2 && col(i) < 8) cls += ' br3'
                      if (row(i) % 3 === 2 && row(i) < 8) cls += ' bb3'
                      return (
                        <div key={i} className={cls} onMouseDown={(e) => { e.preventDefault(); setSel(i) }}>
                          {v ? v : game.memos[i] ? (
                            <div className="sd-memo">{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => <span key={d} className={selVal === d && game.memos[i] & (1 << d) ? 'hl' : ''}>{game.memos[i] & (1 << d) ? d : ''}</span>)}</div>
                          ) : ''}
                        </div>
                      )
                    })}
                    {paused && game && !game.done && (
                      <div className="sd-pause"><div>일시정지 중이에요<br /><button onClick={() => setPaused(false)}>▶ 계속하기</button></div></div>
                    )}
                  </div>
                </td>
              )}
              {Array.from({ length: 5 }, (_, k) => <td key={'x' + k} />)}
            </tr>
          ))}
          <tr><th>11</th><td /><td colSpan={13} className="t2">클릭해서 칸 선택 · 숫자 1~9 입력 · 방향키 이동 · Backspace 지우기 · N 메모 · Ctrl+Z 되돌리기</td></tr>
          {Array.from({ length: 12 }, (_, k) => <tr key={'e' + k}><th>{12 + k}</th>{Array.from({ length: 15 }, (_, c) => <td key={c} />)}</tr>)}
        </tbody>
      </table>
    </ExcelFrame>
  )
}
