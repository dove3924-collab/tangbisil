import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { track } from '../lib/analytics'
import {
  LEN, REGULAR, dailyAnswer, dateText, dayIndex, dayLabel, judge, letterStates, randomAnswer, shareText, splitWords, summary, type Mark,
} from './logic'
import { loadSave, recordResult, shownStreak, storeSave, type Board, type Stats, type WbSave } from './state'
import './wordball.css'

const FILE_NAME = '거래처코드_매핑표_2026.xlsx'
const COLS = 'ABCDEFGHIJK'.split('')
const ROW1 = 'ABCDEFGHIJKLM'.split('')
const ROW2 = 'NOPQRSTUVWXYZ'.split('')
type Mode = 'daily' | 'infinite'
type Dialog = null | 'result' | 'help'

export default function WordballGame() {
  const nav = useNavigate()
  const [words, setWords] = useState<{ answers: string[] } | null>(null)
  const [save, setSave] = useState<WbSave>(loadSave)
  const [mode, setMode] = useState<Mode>('daily')
  const [sheet, setSheet] = useState<1 | 2>(1)
  const [typing, setTyping] = useState('')
  const [err, setErr] = useState<'' | 'value'>('')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [toast, setToast] = useState('')
  const today = dayIndex()

  // 정답 목록은 이 화면에서만 필요해서 따로 불러온다
  useEffect(() => {
    import('./words').then((m) => setWords({ answers: splitWords(m.ANSWERS) }))
  }, [])

  // 오늘의 단어·무한 모드 판 준비 (날짜가 바뀌면 새 오늘의 단어)
  useEffect(() => {
    if (!words) return
    setSave((s) => {
      let n = s
      if (!n.daily || n.daily.day !== today) n = { ...n, daily: { day: today, answer: dailyAnswer(words.answers, today), guesses: [], done: false, won: false } }
      if (!n.infinite) n = { ...n, infinite: { answer: randomAnswer(words.answers), guesses: [], done: false, won: false } }
      return n
    })
  }, [words, today])
  useEffect(() => { storeSave(save) }, [save])

  const board: Board | null = mode === 'daily' ? save.daily : save.infinite
  const stats: Stats = save.stats[mode]

  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? '' : t)), 2200) }

  const switchMode = (m: Mode) => { setMode(m); setTyping(''); setErr(''); setDialog(null); setSheet(1) }

  const newInfinite = () => {
    if (!words) return
    setSave((s) => ({ ...s, infinite: { answer: randomAnswer(words.answers, s.infinite?.answer), guesses: [], done: false, won: false } }))
    setMode('infinite'); setTyping(''); setErr(''); setDialog(null); setSheet(1)
  }

  const submit = () => {
    if (!words || !board || board.done) return
    if (typing.length < LEN) { setErr('value'); return }
    const guesses = [...board.guesses, typing]
    const won = typing === board.answer
    const done = won // 실패 없음: 맞힐 때까지
    setSave((s) => {
      const cur = mode === 'daily' ? s.daily! : s.infinite!
      const nb = { ...cur, guesses, done, won }
      const next: WbSave = mode === 'daily' ? { ...s, daily: { ...s.daily!, ...nb } } : { ...s, infinite: nb }
      if (done) next.stats = { ...s.stats, [mode]: recordResult(s.stats[mode], guesses.length, mode === 'daily' ? today : undefined) }
      return next
    })
    setTyping('')
    setErr('')
    if (done) {
      track('puzzle_clear', { game_id: 'wordball', mode, tries: guesses.length, result: guesses.length <= REGULAR ? 'regular' : 'extra' })
      window.setTimeout(() => setDialog('result'), 450)
    }
  }

  const press = (key: string) => {
    if (!board || board.done || dialog) return
    if (key === 'Enter') return submit()
    if (key === 'Backspace') { setTyping((t) => t.slice(0, -1)); setErr(''); return }
    if (/^[a-z]$/.test(key)) { setTyping((t) => (t.length < LEN ? t + key : t)); setErr('') }
  }
  const pressRef = useRef(press)
  pressRef.current = press

  // 한글 입력 상태여도 영문으로 받도록 e.code 사용
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (document.querySelector('.boss')) return // 보스 화면 중엔 입력 안 받음
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (e.key === 'Enter' || e.key === 'Backspace') { e.preventDefault(); pressRef.current(e.key); return }
      const m = /^Key([A-Z])$/.exec(e.code)
      if (m) { e.preventDefault(); pressRef.current(m[1].toLowerCase()) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const copyResult = async () => {
    if (!board) return
    const title = mode === 'daily' ? dayLabel() : '무한'
    const text = shareText(title, board.guesses.length)
    try { await navigator.clipboard.writeText(text) } catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } catch { /* 무시 */ }
      ta.remove()
    }
    track('share_result', { game_id: 'wordball' })
    flash('결과를 복사했어요. 메신저에 붙여 넣어 보세요')
  }

  // 연장전으로 줄이 늘어나면 지금 줄이 보이게 스크롤
  const curRowLen = board?.guesses.length ?? 0
  useEffect(() => { document.querySelector('.wb-grid tr.cur')?.scrollIntoView({ block: 'nearest' }) }, [curRowLen, sheet])

  const marks = useMemo(() => (board ? board.guesses.map((g) => judge(g, board.answer)) : []), [board])
  const letters = useMemo(() => (board ? letterStates(board.guesses, board.answer) : {}), [board])
  const row = board ? board.guesses.length : 0
  const curCol = Math.min(typing.length, LEN - 1)
  const nameBox = sheet === 2 ? 'B4' : board?.done ? `G${row + 3}` : `${COLS[1 + curCol]}${row + 4}`
  const formula = sheet === 2 ? '=AVERAGE(시도횟수)'
    : board?.done ? '=MATCH(코드, 대조표, 0)' : typing.toUpperCase()

  const title = mode === 'daily' ? `거래처 코드 대조표 · ${dateText()} (오늘의 단어)` : `거래처 코드 대조표 · 무한 모드 #${save.stats.infinite.played + (board?.done ? 0 : 1)}`
  const extra = row >= REGULAR // 지금 연장전 중(또는 연장전에서 끝남)
  const note = !board ? '불러오는 중…'
    : board.done && mode === 'daily' ? '오늘의 단어 대조 완료 · 내일 새 코드가 열려요 · [무한 모드]로 계속할 수 있어요'
      : board.done ? '대조 완료 · [새 시트]로 다음 코드'
        : extra ? '연장전! 맞힐 때까지 계속 대조할 수 있어요'
          : '5자리 영문 코드를 입력하고 Enter · 정규 9회, 못 맞히면 연장전'
  // 판은 최소 9줄, 연장전이면 한 줄씩 늘어남
  const nRows = Math.max(REGULAR, row + (board && !board.done ? 1 : 0))
  const kbRow = 4 + nRows + 1

  return (
    <div className="wb">
      <div className="wb-title">
        <span className="wb-logo">X</span>
        <span className="wb-tmid">{FILE_NAME}<span className="dim"> - 저장됨</span></span>
        <button className="wb-exit" onClick={() => nav('/games')}>나가기</button>
      </div>
      <div className="wb-ribbon">{['파일', '홈', '삽입', '페이지 레이아웃', '수식', '데이터', '검토', '보기'].map((t) => <span key={t} className={t === '홈' ? 'on' : ''}>{t}</span>)}</div>
      <div className="wb-tools">
        <div className="grp">
          <button className={mode === 'daily' ? 'on' : ''} onClick={() => switchMode('daily')}>📅 오늘의 단어</button>
          <button className={mode === 'infinite' ? 'on' : ''} onClick={() => switchMode('infinite')}>∞ 무한 모드</button>
        </div>
        <div className="grp">
          <button disabled={!board?.done} onClick={copyResult}>⧉ 결과 공유</button>
          <button disabled={mode !== 'infinite' || !board?.done} onClick={newInfinite}>↺ 새 시트</button>
        </div>
        <div className="grp legend">
          <span><i className="m-S" />위치·글자 일치 (S)</span><span><i className="m-B" />글자만 일치 (B)</span><span><i className="m-O" />없음 (아웃)</span>
        </div>
        <div className="grp"><button onClick={() => setDialog('help')}>? 도움말</button></div>
      </div>
      <div className="wb-fbar">
        <span className="wb-name">{nameBox}</span><span className="wb-fx">fx</span>
        <span className="wb-fval">{formula}{sheet === 1 && !board?.done && <i className="caret" />}</span>
      </div>

      <div className="wb-sheet">
        {sheet === 1 ? (
          <table className="wb-grid">
            <colgroup><col className="rh" /><col style={{ width: 118 }} />{[0, 1, 2, 3, 4].map((i) => <col key={i} style={{ width: 48 }} />)}<col style={{ width: 72 }} /><col style={{ width: 30 }} />{[0, 1, 2, 3].map((i) => <col key={i} style={{ width: 64 }} />)}</colgroup>
            <thead><tr><th />{COLS.map((c, i) => <th key={c} className={!board?.done && i === 1 + curCol ? 'on' : ''}>{c}</th>)}</tr></thead>
            <tbody>
              <tr><th>1</th><td colSpan={7} className="t1">{title}</td><Empty n={4} /></tr>
              <tr><th>2</th><td colSpan={7} className="t2">{note}</td><Empty n={4} /></tr>
              <tr><th>3</th><td className="hd">구분</td>{[1, 2, 3, 4, 5].map((i) => <td key={i} className="hd">코드{i}</td>)}<td className="hd">S / B</td><Empty n={4} /></tr>
              {Array.from({ length: nRows }, (_, r) => {
                const g = board?.guesses[r]
                const isCur = !!board && !board.done && r === row
                return (
                  <tr key={r} className={'big' + (isCur ? ' cur' : '') + (r >= REGULAR ? ' ext' : '') + (r === REGULAR - 1 && nRows > REGULAR ? ' last-reg' : '')}>
                    <th className={isCur ? 'on' : ''}>{r + 4}</th>
                    <td className="lbl">{r < REGULAR ? `${r + 1}회 대조` : `연장 ${r + 1}회`}</td>
                    {Array.from({ length: LEN }, (_, c) => {
                      if (g) return <td key={c} className={`k m-${marks[r][c]}`}>{g[c].toUpperCase()}</td>
                      const ch = isCur ? typing[c] ?? '' : ''
                      return <td key={c} className={'k' + (isCur && c === curCol ? ' sel' : '')}>{ch.toUpperCase()}</td>
                    })}
                    <td className={'sb' + (isCur && err ? ' err' : '')}>
                      {g ? summary(marks[r]) : isCur && err === 'value' ? '#VALUE!' : ''}
                      {isCur && err && <span className="wb-tip">5글자를 모두 채워 주세요.</span>}
                    </td>
                    <Empty n={4} />
                  </tr>
                )
              })}
              <tr><th>{kbRow - 1}</th><Empty n={11} /></tr>
              <tr className="kb"><th>{kbRow}</th><td className="lbl b">글자 사용 현황</td><td colSpan={10}><Keys keys={[...ROW1, '⌫']} letters={letters} onKey={press} /></td></tr>
              <tr className="kb"><th>{kbRow + 1}</th><td /><td colSpan={10}><Keys keys={[...ROW2, 'Enter']} letters={letters} onKey={press} /></td></tr>
              {Array.from({ length: 12 }, (_, i) => <tr key={i}><th>{kbRow + 2 + i}</th><Empty n={11} /></tr>)}
            </tbody>
          </table>
        ) : (
          <StatsSheet save={save} today={today} />
        )}
      </div>

      <div className="wb-tabs">
        <button className={sheet === 1 ? 'on' : ''} onClick={() => setSheet(1)}>Sheet1</button>
        <button className={sheet === 2 ? 'on' : ''} onClick={() => setSheet(2)}>Sheet2</button>
        <span className="plus">+</span>
      </div>
      <div className="wb-status">
        <span>준비</span>
        {sheet === 1 && board && <span><b>{row + (board.done ? 0 : 1)}</b>회 {board.done ? '· 완료' : row >= REGULAR ? '· 연장전' : `/ 정규 ${REGULAR}회`}</span>}
        {sheet === 2 && <span>이 브라우저에 저장됨</span>}
        <span className="sp" />
        <span>{mode === 'daily' ? '오늘의 단어' : '무한 모드'}</span><span>100%</span>
      </div>

      {dialog === 'result' && board?.done && (
        <div className="wb-dlg-wrap">
          <div className="wb-dlg" role="dialog">
            <div className="wd-head">대조 결과<button className="wd-x" onClick={() => setDialog(null)} aria-label="닫기">✕</button></div>
            <div className="wd-body">
              <span className="wd-ic">i</span>
              <div>
                <p><b>데이터 대조가 완료되었습니다. {board.guesses.length}회 시도</b></p>
                <p className="muted">
                  {board.guesses.length <= REGULAR ? '정규 이닝 승리' : `연장 ${board.guesses.length}회 승리`} · 일치 코드: {board.answer.toUpperCase()} · {mode === 'daily' ? `연속 성공 ${shownStreak(stats, today)}일째` : `정규 이닝 연승 ${stats.streak}`}
                </p>
                <pre className="wd-pat">{shareText(mode === 'daily' ? dayLabel() : '무한', board.guesses.length).split('\n')[0]}</pre>
              </div>
            </div>
            <div className="wd-foot">
              {mode === 'infinite'
                ? <button className="ok" onClick={newInfinite}>다음 단어</button>
                : <button className="ok" onClick={() => setDialog(null)}>확인</button>}
              <button onClick={copyResult}>결과 복사</button>
              <button onClick={() => { setDialog(null); setSheet(2) }}>기록 보기</button>
            </div>
          </div>
        </div>
      )}
      {dialog === 'help' && (
        <div className="wb-dlg-wrap">
          <div className="wb-dlg help" role="dialog">
            <div className="wd-head">도움말<button className="wd-x" onClick={() => setDialog(null)} aria-label="닫기">✕</button></div>
            <div className="wd-body"><div>
              <p><b>5글자 영단어를 맞혀요. 정규 9회 안에 끝내 보세요.</b></p>
              <ul>
                <li><span className="wd-sw m-S">S</span> 스트라이크: 글자와 위치가 모두 맞아요</li>
                <li><span className="wd-sw m-B">B</span> 볼: 정답에 있는 글자지만 위치가 달라요</li>
                <li><span className="wd-sw m-O">O</span> 아웃: 정답에 없는 글자예요</li>
                <li>9회까지 못 맞히면 <b>연장전</b>: 맞힐 때까지 계속할 수 있어요</li>
                <li>같은 글자가 여러 번이면 정답에 있는 개수만큼만 S·B로 셉니다</li>
                <li>영어 사전에 없는 조합(예: ABCDE)도 입력할 수 있어요</li>
                <li><b>오늘의 단어</b>는 모두에게 같은 단어, 하루 한 번 · <b>무한 모드</b>는 계속 플레이</li>
                <li>키보드로 입력, Backspace 지우기, Enter 제출 · 누가 오면 Esc 두 번</li>
              </ul>
              <p className="wd-src">단어 목록: ENABLE word list (Public Domain, M. Cooper·Alan Beale 외) · SCOWL © 2000-2018 Kevin Atkinson · <a href="/licenses/wordball-words.txt" target="_blank" rel="noreferrer">라이선스 전문</a></p>
            </div></div>
            <div className="wd-foot"><button className="ok" onClick={() => setDialog(null)}>확인</button></div>
          </div>
        </div>
      )}
      {toast && <div className="wb-toast">{toast}</div>}
    </div>
  )
}

function Empty({ n }: { n: number }) {
  return <>{Array.from({ length: n }, (_, i) => <td key={i} />)}</>
}

function Keys({ keys, letters, onKey }: { keys: string[]; letters: Record<string, Mark>; onKey: (k: string) => void }) {
  return (
    <div className="wb-keys">
      {keys.map((k) => {
        const code = k === '⌫' ? 'Backspace' : k === 'Enter' ? 'Enter' : k.toLowerCase()
        const m = letters[k.toLowerCase()]
        return (
          <button key={k} className={(m ? `m-${m}` : '') + (k.length > 1 ? ' wide' : '')} onMouseDown={(e) => e.preventDefault()} onClick={() => onKey(code)}>
            {k === 'Enter' ? '입력' : k}
          </button>
        )
      })}
    </div>
  )
}

function StatsSheet({ save, today }: { save: WbSave; today: number }) {
  const d = save.stats.daily
  const inf = save.stats.infinite
  const lastTries = save.daily?.done ? save.daily.guesses.length : 0
  // 시도 횟수 구간: 1~3회, 4~9회는 하나씩, 연장전
  const buckets: { label: string; test: (t: number) => boolean }[] = [
    { label: '1~3회', test: (t) => t <= 3 },
    ...[4, 5, 6, 7, 8, 9].map((n) => ({ label: `${n}회`, test: (t: number) => t === n })),
    { label: '연장전', test: (t) => t > REGULAR },
  ]
  const count = (s: Stats, test: (t: number) => boolean) => Object.entries(s.hist).reduce((a, [t, n]) => a + (test(Number(t)) ? n : 0), 0)
  const counts = buckets.map((b) => count(d, b.test))
  const max = Math.max(1, ...counts)
  const rate = (s: Stats) => (s.played ? `${Math.round((s.regular / s.played) * 100)}%` : '-')
  const avg = (s: Stats) => (s.played ? (s.sum / s.played).toFixed(1) : '-')
  const kv = (k: string, v: ReactNode) => <><td>{k}</td><td className="r b">{v}</td><Empty n={6} /></>
  const rows: ReactNode[] = [
    <><td colSpan={3} className="t1">대조 실적 요약 (오늘의 단어)</td><Empty n={5} /></>,
    <Empty n={8} />,
    <><td className="th">항목</td><td className="th r">값</td><Empty n={6} /></>,
    kv('맞힌 날', d.played), kv('정규 이닝 성공률', rate(d)), kv('평균 이닝', avg(d)), kv('연장전', d.extra),
    kv('현재 연속 성공 (일)', shownStreak(d, today)), kv('최고 연속 성공 (일)', d.best),
    <Empty n={8} />,
    <><td className="th">이닝</td><td className="th r">판 수</td><td className="th">분포</td><Empty n={5} /></>,
    ...buckets.map((b, i) => (
      <><td>{b.label}</td><td className="r">{counts[i]}</td>
        <td>{counts[i] > 0 && <span className={'bar' + (lastTries && b.test(lastTries) ? ' me' : '') + (b.label === '연장전' ? ' ext' : '')} style={{ width: `${(counts[i] / max) * 100}%` }} />}</td><Empty n={5} /></>
    )),
    <Empty n={8} />,
    <><td className="th2">무한 모드</td><td className="th2 r">값</td><Empty n={6} /></>,
    kv('맞힌 판', inf.played), kv('정규 이닝 성공률', rate(inf)), kv('평균 이닝', avg(inf)), kv('연장전', inf.extra),
    kv('정규 이닝 연승', inf.streak), kv('최고 연승', inf.best),
  ]
  return (
    <table className="wb-grid stats">
      <colgroup><col className="rh" /><col style={{ width: 150 }} /><col style={{ width: 90 }} /><col style={{ width: 280 }} />{[0, 1, 2, 3, 4].map((i) => <col key={i} style={{ width: 64 }} />)}</colgroup>
      <thead><tr><th />{'ABCDEFGH'.split('').map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => <tr key={i}><th>{i + 1}</th>{r}</tr>)}
        {Array.from({ length: 6 }, (_, i) => <tr key={'e' + i}><th>{rows.length + 1 + i}</th><Empty n={8} /></tr>)}
      </tbody>
    </table>
  )
}
