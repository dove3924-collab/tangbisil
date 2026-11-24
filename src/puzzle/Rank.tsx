import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, type PuzzleBoard, type PuzzleGame, type PuzzleLevel } from '../lib/api'
import { fmtMs, loadJSON, saveJSON } from './common'

const LABEL: Record<PuzzleLevel, string> = { easy: '초급', normal: '중급', hard: '고급' }
const ORDER: PuzzleLevel[] = ['easy', 'normal', 'hard']
const NAME_KEY = 'wollu.puzzle.name'
const OPEN_KEY = 'wollu.puzzle.rankpane'

export const savedName = () => loadJSON<string>(NAME_KEY, '') || null
const saveName = (n: string) => saveJSON(NAME_KEY, n)

/** 전체 순위표 (세 난이도) — 판 옆 작업 창과 결과 창이 같이 씀 */
export function useRanks(game: PuzzleGame) {
  const [data, setData] = useState<Partial<Record<PuzzleLevel, PuzzleBoard>> | null>(null)
  const [error, setError] = useState(false)
  const reload = useCallback(async () => {
    try { setData(await api.puzzleTop(game)); setError(false) } catch { setError(true) }
  }, [game])
  useEffect(() => { void reload() }, [reload])
  const put = useCallback((lv: PuzzleLevel, b: PuzzleBoard) => setData((d) => ({ ...(d ?? {}), [lv]: b })), [])
  return { data, error, reload, put }
}

/** 작업 창 펼침 여부 (기억). 처음엔 넓은 화면이면 펼침 */
export function useRankOpen() {
  const [open, setOpenRaw] = useState(() => loadJSON<boolean | null>(OPEN_KEY, null) ?? window.innerWidth >= 900)
  const setOpen = (v: boolean) => { setOpenRaw(v); saveJSON(OPEN_KEY, v) }
  return [open, setOpen] as const
}

function Medal({ n }: { n: number }) {
  return n <= 3 ? <span className={'rk-medal g' + n}>{n}</span> : <>{n}</>
}

function Table({ rows }: { rows: { name: string; ms: number | null; me?: boolean; mine?: boolean }[] }) {
  return (
    <table className="rk-tbl">
      <thead><tr><th>순위</th><th>이름</th><th>기록</th></tr></thead>
      <tbody>
        {Array.from({ length: 5 }, (_, i) => {
          const r = rows[i]
          return (
            <tr key={i} className={r?.me || r?.mine ? 'me' : ''}>
              <td className="n"><Medal n={i + 1} /></td>
              <td className="nm">{r ? r.name : <span className="dim">—</span>}</td>
              <td className="t">{r?.ms != null ? fmtMs(r.ms) : ''}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** 판 오른쪽 '작업 창' (숨기면 얇은 띠) */
export function RankPane({ game, level, ranks, liveMs, open, setOpen }: {
  game: PuzzleGame; level: PuzzleLevel; ranks: ReturnType<typeof useRanks>; liveMs: number | null; open: boolean; setOpen: (v: boolean) => void
}) {
  const [tab, setTab] = useState<PuzzleLevel>(level)
  useEffect(() => { setTab(level) }, [level])
  if (!open) {
    return (
      <button className="rk-rail" onClick={() => setOpen(true)} title="전체 TOP 5 펼치기">
        <span>«</span><b>🏆 전체 TOP 5</b>
      </button>
    )
  }
  const b = ranks.data?.[tab]
  const me = b?.me
  const fifth = b && b.top.length >= 5 ? b.top[4].ms : null
  return (
    <aside className="rk-pane">
      <div className="rk-head"><span>🏆 전체 TOP 5</span><button onClick={() => setOpen(false)} title="숨기기">»</button></div>
      <div className="rk-lv">{ORDER.map((lv) => <button key={lv} className={lv === tab ? 'on' : ''} onClick={() => setTab(lv)}>{LABEL[lv]}</button>)}</div>
      <div className="rk-cap">{game === 'sudoku' ? '스도쿠' : '지뢰찾기'} {LABEL[tab]}{game === 'sudoku' ? ' · 힌트 쓴 판 제외' : ''}</div>
      {ranks.error && !ranks.data ? <p className="rk-err">순위를 불러오지 못했어요. <button onClick={() => void ranks.reload()}>다시</button></p>
        : !b ? <p className="rk-err">불러오는 중…</p>
          : <Table rows={b.top.map((e) => ({ name: e.name, ms: e.ms, me: e.me }))} />}
      <div className="rk-mine">
        <div><span>내 최고</span><b>{me ? `${fmtMs(me.ms)} · ${me.rank}위${me.hidden ? ' (이름 없음)' : ''}` : '-'}</b></div>
        {me && me.rank > 5 && fifth !== null && <div><span>5위까지</span><b className="gap">{((me.ms - fifth) / 1000).toFixed(1)}초</b></div>}
        {tab === level && liveMs !== null && <div><span>지금 판</span><b>{fmtMs(liveMs)}</b></div>}
      </div>
      <div className="rk-foot">깨면 바로 갱신돼요 · 한 사람 한 줄(최고 기록)</div>
    </aside>
  )
}

/** 깼을 때 결과 창 안: 기록 올리고 순위 보여주기 (5위 안인데 이름이 없으면 이름 받기) */
export function RankResult({ game, level, ms, counted, ranks }: {
  game: PuzzleGame; level: PuzzleLevel; ms: number; counted: boolean; ranks: ReturnType<typeof useRanks>
}) {
  const [board, setBoard] = useState<PuzzleBoard | null>(null)
  const [err, setErr] = useState('')
  const [name, setName] = useState(() => savedName() ?? '')
  const [busy, setBusy] = useState(false)
  const [declined, setDeclined] = useState(false)
  const sent = useRef(false)

  useEffect(() => {
    if (sent.current) return
    sent.current = true
    if (!counted) { setBoard(ranks.data?.[level] ?? null); return }
    api.puzzleSubmit(game, level, ms, savedName())
      .then((b) => { setBoard(b); ranks.put(level, b) })
      .catch((e) => setErr(e instanceof ApiError ? e.message : '순위 서버에 연결하지 못했어요'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const register = async (n: string | null) => {
    setBusy(true)
    try {
      const b = await api.puzzleName(game, level, n)
      if (n) saveName(n)
      else setDeclined(true)
      setBoard((prev) => ({ ...b, better: prev?.better })); ranks.put(level, b) // 이번 판이 최고였는지는 처음 올릴 때 기준
    } catch (e) { setErr(e instanceof ApiError ? e.message : '저장하지 못했어요') }
    setBusy(false)
  }

  if (err) return <p className="rk-note">{err}</p>
  if (!board) return <p className="rk-note">{counted ? '전체 순위 집계 중…' : ''}</p>

  const me = board.me
  const thisRun = counted && !!board.better // 이번 판이 내 최고 기록
  const inTop = !!me && me.rank <= 5
  const askName = thisRun && inTop && me!.hidden && !declined
  // 이름 없는 내 기록이 5위 안이면 자리를 비워 두고 보여줌
  const rows = board.top.map((e) => ({ name: e.name, ms: e.ms, me: e.me }))
  if (askName) rows.splice(me!.rank - 1, 0, { name: '(나) 이름을 넣어주세요', ms: me!.ms, me: true })
  const fifth = board.top.length >= 5 ? board.top[Math.min(4, board.top.length - 1)].ms : null

  return (
    <div className="rk-result">
      {thisRun && inTop && !me!.hidden && <p className="rk-badge">🏆 전체 {me!.rank}위!</p>}
      {thisRun && inTop && me!.hidden && <p className="rk-badge">🏆 전체 {me!.rank}위 자리예요</p>}
      <Table rows={rows.slice(0, 5)} />
      {askName && (
        <div className="rk-name" onKeyDown={(e) => e.stopPropagation()}>
          <label>순위표 이름<input value={name} maxLength={10} placeholder="별명 (최대 10자)" autoFocus
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) void register(name.trim()) }} /></label>
          <div className="rk-btns">
            <button disabled={busy} onClick={() => void register(null)}>등록 안 함</button>
            <button className="ok" disabled={busy || !name.trim()} onClick={() => void register(name.trim())}>순위 등록</button>
          </div>
          <p className="rk-note">한 번 넣은 이름은 다음에도 자동으로 들어가요</p>
        </div>
      )}
      {!counted && <p className="rk-note">힌트를 쓴 판은 순위에 들어가지 않아요</p>}
      {counted && !inTop && fifth !== null && (
        <p className="rk-note">{thisRun ? <>5위까지 <b className="gap">{((ms - fifth) / 1000).toFixed(1)}초</b> 남았어요</> : <>내 최고 {me ? `${fmtMs(me.ms)} · ${me.rank}위` : '-'}</>}</p>
      )}
      {counted && !thisRun && me && inTop && <p className="rk-note">내 최고 {fmtMs(me.ms)} · {me.rank}위 그대로예요</p>}
      {declined && <p className="rk-note">순위표에 올리지 않았어요</p>}
    </div>
  )
}
