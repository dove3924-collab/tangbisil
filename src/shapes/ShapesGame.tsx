import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { track } from '../lib/analytics'
import { fmtMs, loadJSON, saveJSON, useStopwatch } from '../puzzle/common'
import { LEVELS, LEVEL_ORDER, cellCount, generate, solved, type Level, type Puzzle } from './logic'
import { HelpDialog, ICONS, MiniBoard, useShapePlay } from './Play'
import './shapes.css'

const FILE_NAME = '4분기_조직개편안_v3.pptx'
const KEY = 'wollu.shapes'
export const SLIDE_TITLES = ['4분기 조직 개편안 — 부서 배치', '사무실 재배치안 — 층별 공간', '신규 TF 좌석 배치', '회의실 공간 효율화 방안', '본부 통합에 따른 자리 조정']

interface Game { puz: Puzzle; elapsed: number; no: number }
interface Saved { level: Level; games: Partial<Record<Level, Game>>; solved: Partial<Record<Level, number>>; best: Partial<Record<Level, number>>; history: { level: Level; puz: Puzzle }[] }
const defaults: Saved = { level: 'easy', games: {}, solved: {}, best: {}, history: [] }

export default function ShapesGame() {
  const nav = useNavigate()
  const [saved, setSaved] = useState<Saved>(() => ({ ...defaults, ...loadJSON<Partial<Saved>>(KEY, {}) }))
  const level = saved.level
  const game = saved.games[level]
  const puz = game?.puz ?? null
  const [done, setDone] = useState<number | null>(null) // 완료 시간
  const [help, setHelp] = useState(false)

  // 레벨에 판이 없으면 새로 만들기
  useEffect(() => {
    if (!game) setSaved((s) => ({ ...s, games: { ...s.games, [level]: { puz: generate(level), elapsed: 0, no: 1 } } }))
  }, [game, level])
  useEffect(() => { saveJSON(KEY, saved) }, [saved])

  const { elapsed, setElapsed } = useStopwatch(!!puz && done === null)
  const elapsedRef = useRef(0)
  elapsedRef.current = elapsed
  const sec = Math.floor(elapsed / 1000)
  useEffect(() => { setSaved((s) => (s.games[s.level] ? { ...s, games: { ...s.games, [s.level]: { ...s.games[s.level]!, elapsed: elapsedRef.current } } } : s)) }, [sec])

  const setPuz = useCallback((fn: (p: Puzzle) => Puzzle) => {
    setSaved((s) => {
      const g = s.games[s.level]
      if (!g) return s
      return { ...s, games: { ...s.games, [s.level]: { ...g, puz: fn(g.puz), elapsed: elapsedRef.current } } }
    })
  }, [])
  const play = useShapePlay(puz, setPuz, done !== null)
  useEffect(() => { setElapsed(game?.elapsed ?? 0); play.setSel(null); setDone(null) }, [level, game?.no]) // eslint-disable-line react-hooks/exhaustive-deps

  const newSlide = (lv: Level = level) => {
    setSaved((s) => ({ ...s, level: lv, games: { ...s.games, [lv]: { puz: generate(lv), elapsed: 0, no: (s.games[lv]?.no ?? 0) + 1 } } }))
  }
  const switchLevel = (lv: Level) => { if (lv !== level) setSaved((s) => ({ ...s, level: lv })) }
  const clearAll = () => { setPuz((p) => ({ ...p, pieces: p.pieces.map((pc) => ({ ...pc, at: null })) })); play.setSel(null) }

  // 다 채우면 완료 → 잠시 뒤 다음 슬라이드
  useEffect(() => {
    if (!puz || done !== null || play.dragging || !solved(puz)) return
    const ms = elapsedRef.current
    setDone(ms)
    track('puzzle_clear', { game_id: 'shapes', level, result: 'win', seconds: Math.round(ms / 1000) })
    setSaved((s) => ({
      ...s,
      solved: { ...s.solved, [level]: (s.solved[level] ?? 0) + 1 },
      best: s.best[level] === undefined || ms < s.best[level]! ? { ...s.best, [level]: ms } : s.best,
      history: [...s.history, { level, puz }].slice(-4),
    }))
    const t = window.setTimeout(() => newSlide(), 1800)
    return () => window.clearTimeout(t)
  }, [puz, play.dragging]) // eslint-disable-line react-hooks/exhaustive-deps

  // N 새 슬라이드 (판 조작 키는 useShapePlay)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.code === 'KeyN') { e.preventDefault(); newSlideRef.current() }
      if (e.code === 'Escape') setHelp(false)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  const newSlideRef = useRef(() => newSlide())
  newSlideRef.current = () => newSlide()

  if (!puz || !game) return <div className="pptg"><p style={{ margin: 'auto' }}>슬라이드 준비 중…</p></div>

  const L = LEVELS[level]
  const placed = puz.pieces.filter((p) => p.at).length
  const slideNo = Object.values(saved.solved).reduce((a, b) => a + (b ?? 0), 0) + 1
  const title = SLIDE_TITLES[(game.no - 1) % SLIDE_TITLES.length]
  const best = saved.best[level]
  const deselect = (e: React.PointerEvent) => { if (e.target === e.currentTarget) play.setSel(null) }

  return (
    <div className="pptg" onPointerDown={deselect}>
      <div className="sp-title"><span className="sp-logo">P</span><span className="sp-auto">자동 저장 ● 켬</span><span className="sp-tmid">{FILE_NAME} - 저장됨</span>
        <button className="sp-leave" onClick={() => nav('/games')}>나가기</button></div>
      <div className="sp-tabs">{['파일', '홈', '삽입', '디자인', '전환', '애니메이션', '슬라이드 쇼', '보기'].map((t) => <span key={t}>{t}</span>)}<span className="on">도형 서식</span></div>
      <div className="sp-ribbon">
        <div className="grp"><div className="bs">{LEVEL_ORDER.map((lv) => <button key={lv} className={'tb' + (lv === level ? ' on' : '')} onClick={() => switchLevel(lv)}>{LEVELS[lv].label}<small>{LEVELS[lv].pieces}개</small></button>)}</div><b>난이도</b></div>
        <div className="grp"><div className="bs">{play.rotateTools}</div><b>정렬 · 회전</b></div>
        <div className="grp"><div className="bs">
          <button className="tb" onClick={() => newSlide()}><span className="ic">{ICONS.add}</span>새 슬라이드<kbd>N</kbd></button>
          <button className="tb" disabled={done !== null || placed === 0} onClick={clearAll}><span className="ic">{ICONS.clr}</span>모두 빼기</button>
          <button className="tb" onClick={() => setHelp(true)}><span className="ic">{ICONS.help}</span>조작법</button>
        </div><b>슬라이드</b></div>
      </div>
      {done !== null
        ? <div className="sp-bar done"><span>✔</span><b>배치 완료</b><span className="sub">{L.label} · 도형 {L.pieces}개 · 다음 슬라이드로 넘어가요</span><span className="tm">⏱ {fmtMs(done)}</span></div>
        : <div className="sp-bar"><span>✎</span><b>도형 배치</b><span className="sub">{L.label} · 도형 {L.pieces}개 중 {placed}개 배치 · {cellCount(puz)}칸</span><span className="tm">⏱ {fmtMs(elapsed)}</span></div>}

      <div className="sp-main">
        <div className="sp-thumbs">
          {saved.history.map((h, i) => <div key={i} className="th"><i>{slideNo - saved.history.length + i}</i><div className="s ok"><MiniBoard puz={h.puz} /></div></div>)}
          <div className="th on"><i>{slideNo}</i><div className="s"><MiniBoard puz={puz} /></div></div>
        </div>
        <div className="sp-stage" onPointerDown={deselect}>
          <div className="sp-slide" onPointerDown={deselect}>
            <h1>{title}</h1>
            <p className="lead">남은 공간에 부서 도형을 빈틈없이 배치하세요</p>
            <div className="rule" />
            <div className="sp-area">
              <div><div className="cap">배치 영역 ({cellCount(puz)}칸)</div>{play.board}</div>
              <div className="sp-tray"><div className="cap">사용할 도형 · 끌어서 놓기 · 놓은 도형을 밖으로 끌면 빼기</div>{play.tray}</div>
            </div>
            <div className="ft"><span>○○주식회사 · 대외비</span><span>{slideNo}</span></div>
            {done !== null && <div className="sp-toast">✔ 배치 완료 {fmtMs(done)}</div>}
          </div>
        </div>
      </div>
      <div className="sp-status"><span>슬라이드 {slideNo}</span><span>한국어</span><span className="sp-sp" />
        <span>{L.label} 푼 판 {saved.solved[level] ?? 0} · 최고 {best !== undefined ? fmtMs(best) : '-'}</span>
        <span className="hide-sm">Q·E 회전 · A·D 대칭 · 끌어서 놓기</span></div>
      {play.ghost}
      {help && <HelpDialog onClose={() => setHelp(false)} extra={<tr><th>새 슬라이드</th><td><kbd>N</kbd> (다 채우면 자동으로 넘어가요)</td></tr>} />}
    </div>
  )
}
