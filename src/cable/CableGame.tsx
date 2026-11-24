import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { track } from '../lib/analytics'
import { fmtMs, loadJSON, saveJSON, useStopwatch } from '../puzzle/common'
import { LEVELS, LEVEL_ORDER, connected, generate, isPc, rotCCW, rotCW, solved, type Board, type Level } from './logic'
import '../shapes/shapes.css'
import { useCableKeys } from './keys'
import './cable.css'

const FILE_NAME = '본사_3층_네트워크_구성도.vsdx'
const KEY = 'wollu.cable'
const TITLES = ['본사 3층 네트워크 구성도', '신사옥 4층 랜 배선도', '회의실 무선 AP 연결안', '재택 VPN 우회 경로 (안)', '전산실 랙 재배선 계획']

interface Game { b: Board; elapsed: number; no: number }
interface Saved { level: Level; games: Partial<Record<Level, Game>>; solved: Partial<Record<Level, number>>; best: Partial<Record<Level, number>> }
const defaults: Saved = { level: 'easy', games: {}, solved: {}, best: {} }

function useCellSize(w: number, h: number) {
  const pick = () => {
    const availW = window.innerWidth - (window.innerWidth > 1000 ? 560 : 70)
    const availH = window.innerHeight - 300
    return Math.max(30, Math.min(64, Math.floor(Math.min(availW / w, availH / h))))
  }
  const [cs, setCs] = useState(pick)
  useEffect(() => { const f = () => setCs(pick()); f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [w, h]) // eslint-disable-line react-hooks/exhaustive-deps
  return cs
}

/** 칸 하나: 연결 방향대로 선, 서버·PC 상자 */
export function Tile({ m, x, y, cs, lit, server, pc, locked, spin }: { m: number; x: number; y: number; cs: number; lit: boolean; server: boolean; pc: boolean; locked: boolean; spin: string }) {
  const c = cs / 2
  const col = lit ? '#2b6cd1' : '#b7bfcc'
  const sw = Math.max(4, cs * 0.12)
  const arm = (bit: number, dx: number, dy: number) => (m & bit ? <line x1={c} y1={c} x2={c + dx * c} y2={c + dy * c} stroke={col} strokeWidth={sw} strokeLinecap="round" /> : null)
  return (
    <g transform={`translate(${x},${y})`}>
      <rect width={cs} height={cs} fill={locked ? '#f1f3f7' : '#fafbfd'} stroke="#e3e7ef" />
      <g className={'cb-tile ' + spin} style={{ transformOrigin: `${c}px ${c}px` }}>
        {arm(1, 0, -1)}{arm(2, 1, 0)}{arm(4, 0, 1)}{arm(8, -1, 0)}
        {!server && !pc && <circle cx={c} cy={c} r={sw / 2} fill={col} />}
      </g>
      {server && <g><rect x={c - cs * 0.32} y={c - cs * 0.36} width={cs * 0.64} height={cs * 0.72} rx={4} fill="#1f3a6b" /><text x={c} y={c + 4} textAnchor="middle" fontSize={Math.max(9, cs * 0.2)} fill="#fff" fontWeight={700}>서버</text></g>}
      {pc && <g><rect x={c - cs * 0.27} y={c - cs * 0.2} width={cs * 0.54} height={cs * 0.4} rx={3} fill={lit ? '#e6f0ff' : '#f2f2f2'} stroke={col} strokeWidth={2} /><text x={c} y={c + cs * 0.07} textAnchor="middle" fontSize={Math.max(8, cs * 0.17)} fill={lit ? '#1f3a6b' : '#999'}>PC</text></g>}
      {locked && <rect x={2} y={2} width={cs - 4} height={cs - 4} fill="none" stroke="#8a93a8" strokeWidth={2} strokeDasharray="3 2" />}
    </g>
  )
}

export default function CableGame() {
  const nav = useNavigate()
  const [saved, setSaved] = useState<Saved>(() => ({ ...defaults, ...loadJSON<Partial<Saved>>(KEY, {}) }))
  const level = saved.level
  const game = saved.games[level]
  const b = game?.b ?? null
  const [done, setDone] = useState<number | null>(null)
  const [help, setHelp] = useState(false)
  const [spins, setSpins] = useState<Record<number, { n: number; dir: 'cw' | 'ccw' }>>({})
  const cs = useCellSize(b?.w ?? 7, b?.h ?? 6)

  useEffect(() => { if (!game) setSaved((s) => ({ ...s, games: { ...s.games, [level]: { b: generate(level), elapsed: 0, no: 1 } } })) }, [game, level])
  useEffect(() => { saveJSON(KEY, saved) }, [saved])

  const { elapsed, setElapsed } = useStopwatch(!!b && done === null)
  const elapsedRef = useRef(0)
  elapsedRef.current = elapsed
  useEffect(() => { setElapsed(game?.elapsed ?? 0); setDone(null); setSpins({}) }, [level, game?.no]) // eslint-disable-line react-hooks/exhaustive-deps
  const sec = Math.floor(elapsed / 1000)
  useEffect(() => { setSaved((s) => (s.games[s.level] ? { ...s, games: { ...s.games, [s.level]: { ...s.games[s.level]!, elapsed: elapsedRef.current } } } : s)) }, [sec])

  const setBoard = (fn: (b: Board) => Board) => setSaved((s) => {
    const g = s.games[s.level]
    return g ? { ...s, games: { ...s.games, [s.level]: { ...g, b: fn(g.b), elapsed: elapsedRef.current } } } : s
  })
  const newBoard = (lv: Level = level) => setSaved((s) => ({ ...s, level: lv, games: { ...s.games, [lv]: { b: generate(lv), elapsed: 0, no: (s.games[lv]?.no ?? 0) + 1 } } }))

  const turn = (i: number, dir: 'cw' | 'ccw') => {
    if (!b || done !== null || b.locked[i]) return
    setBoard((x) => ({ ...x, turns: x.turns + 1, cells: x.cells.map((m, k) => (k === i ? (dir === 'cw' ? rotCW(m) : rotCCW(m)) : m)) }))
    setSpins((s) => ({ ...s, [i]: { n: (s[i]?.n ?? 0) + 1, dir } }))
  }
  const toggleLock = (i: number) => { if (b && done === null) setBoard((x) => ({ ...x, locked: x.locked.map((l, k) => (k === i ? !l : l)) })) }
  const keys = useCableKeys({ w: b?.w ?? 1, h: b?.h ?? 1, server: b?.server ?? 0, resetKey: `${level}.${game?.no}`, enabled: !!b && done === null, turn, lock: toggleLock })
  const unlockAll = () => setBoard((x) => ({ ...x, locked: x.locked.map(() => false) }))

  // 완료 → 2초 뒤 새 구성도
  useEffect(() => {
    if (!b || done !== null || !solved(b)) return
    const ms = elapsedRef.current
    setDone(ms)
    track('puzzle_clear', { game_id: 'cable', level, result: 'win', seconds: Math.round(ms / 1000) })
    setSaved((s) => ({ ...s, solved: { ...s.solved, [level]: (s.solved[level] ?? 0) + 1 }, best: s.best[level] === undefined || ms < s.best[level]! ? { ...s.best, [level]: ms } : s.best }))
    const t = window.setTimeout(() => newBoard(), 2200)
    return () => window.clearTimeout(t)
  }, [b]) // eslint-disable-line react-hooks/exhaustive-deps

  // N 새 구성도 · Esc 닫기
  const newRef = useRef(() => newBoard())
  newRef.current = () => newBoard()
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.code === 'KeyN') { e.preventDefault(); newRef.current() }
      if (e.key === 'Escape') setHelp(false)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  if (!b || !game) return <div className="pptg cb"><p style={{ margin: 'auto' }}>구성도 준비 중…</p></div>

  const L = LEVELS[level]
  const on = connected(b)
  const pcs = b.cells.map((_, i) => isPc(b, i))
  const pcTotal = pcs.filter(Boolean).length
  const pcOn = pcs.filter((p, i) => p && on[i]).length
  const best = saved.best[level]
  const slideNo = Object.values(saved.solved).reduce((a, x) => a + (x ?? 0), 0) + 1
  const title = TITLES[(game.no - 1) % TITLES.length]

  return (
    <div className="pptg cb">
      <div className="sp-title"><span className="sp-logo">V</span><span className="sp-auto">자동 저장 ● 켬</span><span className="sp-tmid">{FILE_NAME} - 저장됨</span>
        <button className="sp-leave" onClick={() => nav('/')}>나가기</button></div>
      <div className="sp-tabs">{['파일', '홈', '삽입', '디자인', '데이터'].map((t) => <span key={t}>{t}</span>)}<span className="on">연결선</span><span>보기</span></div>
      <div className="sp-ribbon">
        <div className="grp"><div className="bs">{LEVEL_ORDER.map((lv) => (
          <button key={lv} className={'tb' + (lv === level ? ' on' : '')} onClick={() => lv !== level && setSaved((s) => ({ ...s, level: lv }))}>{LEVELS[lv].label}<small>{LEVELS[lv].w}×{LEVELS[lv].h}</small></button>
        ))}</div><b>난이도</b></div>
        <div className="grp"><div className="bs">
          <button className="tb" onClick={() => newBoard()}><span className="ic">＋</span>새 구성도<kbd>N</kbd></button>
          <button className="tb" disabled={!b.locked.some(Boolean)} onClick={unlockAll}><span className="ic">🔓</span>잠금 모두 해제</button>
          <button className="tb" onClick={() => setHelp(true)}><span className="ic">?</span>조작법</button>
        </div><b>구성도</b></div>
        <div className="grp hide-sm"><div className="bs cb-legend"><span>클릭·E = 시계 90° · 우클릭·Q = 반시계</span><span>방향키·WASD = 칸 옮기기</span><span>Shift+클릭·Space = 잠그기</span></div><b>조작</b></div>
      </div>
      {done !== null
        ? <div className="sp-bar done"><span>✔</span><b>모든 PC 연결 완료</b><span className="sub">{L.label} · 회전 {b.turns}번 · 잠시 뒤 새 구성도</span><span className="tm">⏱ {fmtMs(done)}</span></div>
        : <div className="sp-bar cb-bar"><span>🔌</span><b>연결 중</b><span className="sub">서버에서 모든 PC까지 케이블을 이으세요 · 연결된 PC {pcOn} / {pcTotal}</span><span className="tm">⏱ {fmtMs(elapsed)}</span></div>}

      <div className="sp-main">
        <div className="cb-stencil hide-sm">
          <b>도형</b>
          <div>🖥 서버</div><div>💻 PC</div><div>━ 직선</div><div>┗ 꺾임</div><div>┳ 분기</div>
          <p>칸을 클릭하면 시계방향으로 90° 돌아가요. 우클릭은 반대로, Shift+클릭은 잠그기.<br /><br />키보드: 방향키·WASD로 칸 옮기고 Q·E로 돌리기, Space로 잠그기.</p>
        </div>
        <div className="sp-stage">
          <div className="sp-slide cb-page">
            <h1>{title}</h1>
            <p className="lead">IT운영팀 · 케이블 재배선 계획 (안)</p>
            <div className="rule" />
            <svg className="cb-board" width={b.w * cs} height={b.h * cs} onContextMenu={(e) => e.preventDefault()}>
              {b.cells.map((m, i) => {
                const x = (i % b.w) * cs, y = Math.floor(i / b.w) * cs
                const sp = spins[i]
                return (
                  <g key={`${i}-${sp?.n ?? 0}`} className={'cb-cell' + (b.locked[i] ? ' locked' : '')}
                    onClick={(e) => { keys.setCursor(i); if (e.shiftKey) toggleLock(i); else turn(i, 'cw') }}
                    onContextMenu={(e) => { e.preventDefault(); turn(i, 'ccw') }}>
                    <Tile m={m} x={x} y={y} cs={cs} lit={on[i]} server={i === b.server} pc={pcs[i]} locked={b.locked[i]} spin={sp ? `spin-${sp.dir}` : ''} />
                  </g>
                )
              })}
              {keys.show && <rect pointerEvents="none" x={(keys.cursor % b.w) * cs + 2} y={Math.floor(keys.cursor / b.w) * cs + 2} width={cs - 4} height={cs - 4} rx={4} fill="none" stroke="#f0a500" strokeWidth={3} />}
            </svg>
            <div className="ft"><span>○○주식회사 · IT운영팀</span><span>{slideNo}</span></div>
            {done !== null && <div className="sp-toast cb-toast">✔ 연결 완료 {fmtMs(done)}</div>}
          </div>
        </div>
        <div className="cb-side hide-sm">
          <div className="cb-kpi"><small>연결된 PC</small><div className="big">{pcOn} / {pcTotal}</div><small>회전 {b.turns}번</small></div>
          <ul><li>끊어진 선은 회색</li><li>서버와 이어진 선은 파랑</li><li>모든 칸이 이어지고 허공으로 뻗은 선이 없으면 완료</li></ul>
        </div>
      </div>
      <div className="sp-status"><span>페이지 {slideNo}</span><span>한국어</span><span className="sp-sp" />
        <span>{L.label} 완료 {saved.solved[level] ?? 0} · 최고 {best !== undefined ? fmtMs(best) : '-'}</span>
        <span className="hide-sm">방향키·WASD 이동 · Q·E 회전 · Space 잠그기 · 클릭 회전 · N 새 구성도</span></div>
      {help && (
        <div className="sp-dlg-wrap" onPointerDown={() => setHelp(false)}>
          <div className="sp-dlg" onPointerDown={(e) => e.stopPropagation()}>
            <div className="hd">조작법<button onClick={() => setHelp(false)}>✕</button></div>
            <table><tbody>
              <tr><th>목표</th><td>칸을 돌려서 가운데 서버와 모든 PC를 케이블로 이으세요. 모든 칸이 이어지고 허공으로 뻗은 선이 없으면 완료.</td></tr>
              <tr><th>돌리기</th><td>클릭 또는 <kbd>E</kbd>(<kbd>R</kbd>) = 시계방향 90° · 우클릭 또는 <kbd>Q</kbd> = 반시계 · 휴대폰은 탭</td></tr>
              <tr><th>칸 옮기기</th><td>방향키 또는 <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> (노란 테두리가 선택된 칸)</td></tr>
              <tr><th>잠그기</th><td>Shift+클릭 또는 <kbd>Space</kbd>로 맞는 칸을 잠가 두면 실수로 안 돌아가요. [잠금 모두 해제]로 풀기</td></tr>
              <tr><th>새 구성도</th><td><kbd>N</kbd> (다 이으면 자동으로 넘어가요)</td></tr>
            </tbody></table>
          </div>
        </div>
      )}
    </div>
  )
}
