import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { FILE_LABEL, GAMES, type Game } from '../lib/games'
import { track } from '../lib/analytics'
import { parseRoomCode } from '../lib/room'
import { api, ApiError } from '../lib/api'

type Tab = 'all' | 'updates' | 'howto'

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: '전체 게임' },
  { id: 'updates', label: '업데이트' },
  { id: 'howto', label: '플레이 방법' },
]

export default function Lobby() {
  const nav = useNavigate()
  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [creating, setCreating] = useState<string | null>(null)
  const [createError, setCreateError] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim()
    return GAMES.filter(
      (g) => !q || g.title.includes(q) || g.desc.includes(q),
    )
  }, [query])
  const party = filtered.filter((g) => g.kind === 'party')
  const escape = filtered.filter((g) => g.kind === 'escape')
  const puzzle = filtered.filter((g) => g.kind === 'puzzle')

  const join = (e: FormEvent) => {
    e.preventDefault()
    const c = parseRoomCode(code)
    if (!c) {
      setCodeError('방 코드는 4자리예요 (예: K7Q2)')
      return
    }
    track('join_room_by_code')
    nav(`/r/${c}`)
  }

  const open = async (g: Game) => {
    if (!g.playable || creating) return
    track('select_game', { game_id: g.id, game_name: g.title, game_kind: g.kind })
    if (g.id === 'escape') { nav('/escape'); return }
    if (g.id === 'workshop') { nav('/workshop'); return }
    if (g.id === 'wordball') { nav('/wordball'); return }
    if (g.id === 'mines') { nav('/mines'); return }
    if (g.id === 'sudoku') { nav('/sudoku'); return }
    if (g.id === 'shapes') { nav('/shapes'); return }
    if (g.id === 'cable') { nav('/cable'); return }
    if (g.id === 'framed') { nav('/framed'); return }
    setCreating(g.id)
    setCreateError('')
    try {
      const roomCode = await api.createRoom(g.id)
      nav(`/r/${roomCode}`)
    } catch (e) {
      setCreateError(e instanceof ApiError ? e.message : '방을 만들지 못했어요.')
      setCreating(null)
    }
  }

  return (
    <div className="lobby">
      <header className="topbar">
        <div className="wrap topbar-in">
          <a className="logo" href="/" onClick={(e) => { e.preventDefault(); setTab('all'); setQuery('') }}>☕ 탕비실</a>
          <nav className="topnav">
            {searchOpen ? (
              <input
                className="search"
                autoFocus
                placeholder="게임 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onBlur={() => !query && setSearchOpen(false)}
              />
            ) : (
              <button className="search-btn" aria-label="검색" onClick={() => setSearchOpen(true)}>
                <svg width="14" height="14" viewBox="0 0 16 16"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="2.2" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
              </button>
            )}
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="wrap">
        <section className="hero">
          <h1>회사에서 몰래 하는 게임</h1>
          <p>설치·가입 없이 바로 플레이</p>
          <div className="hint">
            누가 오면 <kbd>Esc</kbd> <kbd>Esc</kbd> → 엑셀 화면으로 즉시 전환
          </div>
        </section>

        <form className="join card" onSubmit={join}>
          <div>
            <strong>초대받은 방에 입장</strong>
            <span className="muted">공유받은 링크를 열거나 방 코드를 입력하세요</span>
          </div>
          <div className="join-input">
            <input
              value={code}
              onChange={(e) => { setCode(e.target.value); setCodeError('') }}
              placeholder="방 코드 (예: K7Q2)"
              aria-label="방 코드"
              aria-invalid={!!codeError}
            />
            <button className="btn-dark" type="submit">입장</button>
            {codeError && <span className="err">{codeError}</span>}
          </div>
        </form>

        {tab === 'updates' ? (
          <Updates />
        ) : tab === 'howto' ? (
          <HowTo />
        ) : (
          <>
            {filtered.length === 0 && <p className="empty">'{query}'에 맞는 게임이 없어요.</p>}
            {party.length > 0 && (
              <section>
                <div className="sec-head">
                  <h2>파티 게임 <span className="pill party">여럿이</span></h2>
                  <span className={createError ? 'err-inline' : 'muted'}>
                    {createError || (creating ? '방 만드는 중…' : '게임을 고르면 방이 만들어지고 초대 링크가 생겨요')}
                  </span>
                </div>
                <div className="cards">{party.map((g) => <GameCard key={g.id} g={g} onOpen={open} />)}</div>
              </section>
            )}
            {escape.length > 0 && (
              <section>
                <div className="sec-head">
                  <h2>방탈출 <span className="pill escape">혼자</span></h2>
                  <span className="muted">단서를 찾아 탈출하세요 · 진행 상황은 자동 저장돼요</span>
                </div>
                <div className="cards">{escape.map((g) => <GameCard key={g.id} g={g} onOpen={open} />)}</div>
              </section>
            )}
            {puzzle.length > 0 && (
              <section>
                <div className="sec-head">
                  <h2>퍼즐 <span className="pill escape">혼자</span></h2>
                  <span className="muted">짧게 한 판 · 기록은 이 브라우저에 저장돼요</span>
                </div>
                <div className="cards">{puzzle.map((g) => <GameCard key={g.id} g={g} onOpen={open} />)}</div>
              </section>
            )}
          </>
        )}
      </main>

      <footer className="wrap footer">
        <span>탕비실</span>
        <a href="#" onClick={(e) => { e.preventDefault(); setTab('howto'); window.scrollTo(0, 0) }}>플레이 방법</a>
        <span className="credit">made by YJ</span>
      </footer>
    </div>
  )
}

function GameCard({ g, onOpen }: { g: Game; onOpen: (g: Game) => void }) {
  return (
    <button className={'game-card' + (g.playable ? ' playable' : '') + (g.kind !== 'party' ? ' escape' : '')} disabled={!g.playable} onClick={() => onOpen(g)}>
      <div className="card-top">
        <FileTag type={g.type} />
        <span className="muted sm">{FILE_LABEL[g.type]}</span>
        <Status playable={g.playable} />
      </div>
      <h3>{g.title}{g.preview && <span className="badge test">테스트</span>}</h3>
      <p>{g.desc}</p>
      <div className="card-foot">{g.players}{g.minutes ? ` · ${g.minutes}분` : ''}</div>
    </button>
  )
}

function FileTag({ type }: { type: Game['type'] }) {
  return <span className={`ftag ftag-${type.toLowerCase()}`}>{type}</span>
}

function Status({ playable }: { playable: boolean }) {
  return playable ? <span className="badge ok">플레이 가능</span> : <span className="badge">준비 중</span>
}

const UPDATES: { date: string; tag: string; title: string; desc: string }[] = [
  { date: '2026.11.23', tag: '새 게임', title: '케이블 연결 대결', desc: '같은 네트워크 구성도를 동시에! 먼저 서버와 모든 PC를 이으면 1점. 파티 게임 · 2~4명' },
  { date: '2026.11.23', tag: '새 게임', title: '케이블 연결', desc: '네트워크 구성도의 케이블 조각을 클릭해 돌려 서버와 모든 PC를 잇기. 초급·중급·고급. 혼자' },
  { date: '2026.11.23', tag: '업데이트', title: '도형 배치 전문가', desc: '도형 6개짜리 전문가 난이도 추가 (혼자 하기·대결 모두)' },
  { date: '2026.11.20', tag: '새 게임', title: '알까기', desc: '슬라이드 위 원형 도형을 튕겨 상대 도형을 영역 밖으로! 자기 진영에 몰래 배치하고 새총처럼 당겨 쏘기. 파티 게임 · 2명' },
  { date: '2026.11.19', tag: '새 게임', title: '도형 배치 대결', desc: '같은 슬라이드를 동시에! 부서 도형을 먼저 빈틈없이 채우면 1점. 파티 게임 · 2~4명' },
  { date: '2026.11.19', tag: '새 게임', title: '도형 배치', desc: '조직 개편안 슬라이드 빈 공간에 부서 도형을 돌리고 뒤집어 딱 맞게 채우기. 초급·중급·고급. 혼자' },
  { date: '2026.11.14', tag: '새 게임', title: '할리갈리', desc: '차례대로 카드를 펼치고 같은 아이콘 합계가 5면 먼저 승인! 파란 보고서 화면 · 2~4명' },
  { date: '2026.11.13', tag: '새 게임', title: '누명 탈출', desc: '법인카드 누명을 쓴 금요일 밤, 감사팀 PC에서 증거 7개를 찾아 새벽 3시 전에 소명서를 보내는 방탈출. 혼자 · 30분' },
  { date: '2026.11.12', tag: '새 게임', title: '스도쿠', desc: '예산 배분표 빈칸 채우기. 초급·중급·고급. 혼자' },
  { date: '2026.11.12', tag: '새 게임', title: '지뢰찾기', desc: '재고 점검표 속 지뢰 피하기. 초급·중급·고급. 혼자' },
  { date: '2026.11.12', tag: '새 게임', title: '영단어 야구', desc: '5글자 영단어를 맞히는 퍼즐. 정규 9회, 못 맞히면 연장전. 오늘의 단어 · 무한 모드. 혼자' },
  { date: '2026.11.09', tag: '새 게임', title: '워크숍 조난기 「버스는 10시에 떠난다」', desc: 'PPT 슬라이드 속 단서로 10시 버스를 타는 방탈출. 혼자' },
  { date: '2026.11.06', tag: '새 게임', title: '빙고', desc: '주제 단어로 판을 채우고 먼저 완성하면 승리. 2~8명' },
  { date: '2026.11.06', tag: '새 게임', title: '야근 탈출 「금요일 밤 11시」', desc: '엑셀 시트 속 단서로 탈출하는 방탈출. 혼자' },
  { date: '2026.11.05', tag: '새 게임', title: '라이어 게임', desc: '제시어를 모르는 라이어를 찾는 메신저 게임. 3~8명' },
  { date: '2026.11.05', tag: '오픈', title: '월루', desc: '회사에서 몰래 하는 게임 포털 오픈' },
]

function Updates() {
  return (
    <section className="lobby-page">
      <div className="sec-head"><h2>업데이트</h2><span className="muted">새로 나온 게임</span></div>
      <ul className="updates doc">
        {UPDATES.map((u) => (
          <li key={u.date + u.title}>
            <span className="dt">{u.date}</span>
            <span><span className={'utag' + (u.tag === '오픈' ? ' open' : '')}>{u.tag}</span><b>{u.title}</b> — {u.desc}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

const HOWTO: { id: string; type: Game['type']; title: string; intro?: string; steps: [string, string][]; tips?: string[] }[] = [
  {
    id: 'liar', type: 'MSG', title: '라이어 게임',
    intro: '3~8명 중 한 명이 라이어예요. 시민은 주제와 제시어를, 라이어는 주제만 받아요.',
    steps: [
      ['힌트', '정해진 순서대로 제시어에 대한 힌트를 한 줄씩(40자) 써요. 라이어는 들키지 않게 아는 척하세요.'],
      ['토론', '자유롭게 이야기해요. 모두 \'토론 끝내기\'를 누르면 바로 투표로 넘어가요.'],
      ['투표', '라이어라고 생각하는 사람을 골라요. 결과는 마감 후 한 번에 공개돼요. 동점이면 동점자의 해명을 듣고 재투표, 또 동점이면 라이어가 이겨요.'],
      ['제시어 맞히기', '지목된 사람이 라이어면 제시어를 한 번 맞힐 수 있어요. 맞히면 라이어 승리, 틀리면 시민 승리.'],
      ['이의 신청', '라이어가 틀렸는데 같은 뜻이라고 생각하면 한 번 이의 신청할 수 있어요. 라이어를 뺀 참가자 과반이 인정하면 라이어 승리로 바뀌어요.'],
    ],
    tips: ['방장은 대기실에서 주제, 힌트 바퀴, 힌트 시간, 토론 시간을 바꿀 수 있어요.', '정답은 띄어쓰기·대소문자를 무시하고, 다른 이름이나 영어 표기도 인정해요. (예: 아메리카노 = 아아 = americano)'],
  },
  {
    id: 'bingo', type: 'DOCX', title: '빙고',
    intro: '2~8명이 같은 주제 단어로 각자 빙고판을 만들고, 돌아가며 단어를 불러요.',
    steps: [
      ['판 채우기 (2분)', '칸을 클릭해 바로 입력하거나 단어 목록에서 골라 채워요. 목록에 없는 단어도 쓸 수 있어요(4×4는 3칸, 5×5는 4칸까지). 다 채우면 [준비 완료], 모두 준비되면 바로 시작해요.'],
      ['부르기 (1인 15초)', '내 차례에 내 판에서 아직 안 불린 단어를 클릭해서 불러요. 불린 단어는 그 단어가 있는 모든 사람의 판에서 지워져요.'],
      ['빙고!', '정한 줄 수를 먼저 완성하면 [빙고!] 버튼이 켜져요. 먼저 누른 사람이 이겨요. 다른 사람이 몇 줄인지는 끝날 때까지 몰라요.'],
      ['결과', '모두의 판이 공개돼요. 누가 무슨 단어를 숨겨놨는지 확인해 보세요.'],
    ],
    tips: ['직접 입력한 단어를 다른 사람도 썼다면 "통했다!"가 떠요.', '방장은 판 크기(4×4·5×5)와 승리 줄 수(1~3줄)를 정할 수 있어요.'],
  },
  {
    id: 'cablevs', type: 'VSDX', title: '케이블 연결 대결',
    intro: '2~4명이 같은 네트워크 구성도를 동시에 풀어요. 케이블 조각을 돌려서 서버와 모든 PC를 먼저 다 이으면 1점이에요. 조작은 퍼즐의 「케이블 연결」과 같아요.',
    steps: [
      ['대기실 설정', '방장이 난이도(5×5·7×6·9×8)와 승리 조건(1~5점 먼저)을 정해요.'],
      ['라운드', '3초 카운트다운 뒤 모두에게 같은 구성도가 열려요. 다 이으면 바로 +1점. 시간 제한은 없어요.'],
      ['넘기기', '못 풀겠으면 [넘기기 제안]. 남은 사람이 모두 동의하면 정답을 보여주고 점수 없이 다음 판으로 가요.'],
      ['결과', '목표 점수에 먼저 닿으면 끝! 점수·최고 기록·평균 완료 시간을 보고서로 보여줘요.'],
    ],
    tips: ['왼쪽에는 다른 사람이 PC를 몇 대 이었는지만 보여요.', '대화는 Enter로 열고 보내요.'],
  },
  {
    id: 'alkkagi', type: 'PPTX', title: '알까기',
    intro: '2명이 슬라이드 위 원형 도형을 번갈아 튕겨서 상대 도형을 영역 밖으로 떨어뜨리는 게임이에요. 내 진영은 항상 화면 아래쪽이에요.',
    steps: [
      ['대기실 설정', '방장이 도형 개수(3·5·7개), 승부(단판·3판 2선승·5판 3선승), 한 턴 시간(15초·30초·없음), 배치 방식(자율·기본)을 정해요.'],
      ['배치 (30초)', '파란 내 진영에 도형을 끌어서 놓아요. 다시 끌면 옮기고, 판 밖으로 끌면 빠져요. [기본 배치]·[무작위]도 돼요. 상대 배치는 둘 다 끝나면 동시에 공개돼요.'],
      ['발사', '내 차례에 내 도형을 잡고 뒤로 당겼다 놓으세요. 당긴 반대 방향으로, 당긴 만큼 세게 날아가요. Esc로 취소.'],
      ['승부', '영역 밖으로 나간 도형은 삭제돼요. 상대 도형을 모두 떨어뜨리면 그 판 승리. 판마다 먼저 쏘는 사람이 바뀌어요.'],
    ],
    tips: ['내 도형이 나가도 차례는 넘어가요. 너무 세게 쏘면 내 도형도 떨어질 수 있어요.', '대화는 Enter로 열고 보내요. 지고 싶으면 [항복].'],
  },
  {
    id: 'shapevs', type: 'PPTX', title: '도형 배치 대결',
    intro: '2~4명이 같은 슬라이드를 동시에 풀어요. 부서 도형을 빈 공간에 빈틈없이 먼저 채우는 사람이 1점이에요. 조작은 퍼즐의 「도형 배치」와 같아요.',
    steps: [
      ['대기실 설정', '방장이 난이도(도형 3·4·5·6개)와 승리 조건(1~5점 먼저)을 정해요.'],
      ['라운드', '3초 카운트다운 뒤 모두에게 같은 판이 열려요. 다 채우면 바로 +1점. 시간 제한은 없어요.'],
      ['넘기기', '못 풀겠으면 [넘기기]를 제안하세요. 남은 사람이 모두 동의하면 정답을 보여주고 점수 없이 다음 판으로 가요. 한 명이라도 [계속]을 누르면 취소돼요.'],
      ['완성본 공개', '라운드가 끝나면 1등의 완성본과 라운드 순위를 5초 보여주고 다음 판으로 넘어가요.'],
      ['결과', '목표 점수에 먼저 닿으면 끝! 점수·최고 기록·평균 완료 시간을 보고서로 보여줘요.'],
    ],
    tips: ['왼쪽에는 다른 사람이 도형을 몇 개 놓았는지만 보여요. 어디에 놓았는지는 안 보여요.', '대화는 Enter로 열고 보내요. 빈 칸에서 Enter나 Esc를 누르면 게임으로 돌아가요.'],
  },
  {
    id: 'bell', type: 'PPTX', title: '할리갈리',
    intro: '2~4명이 각자 받은 카드 덱을 차례대로 한 장씩 펼치다가, 같은 아이콘 합계가 정확히 5가 되는 순간 가장 먼저 승인을 누르는 게임이에요.',
    steps: [
      ['카드 펼치기 (Space)', '내 차례에 Space를 누르거나 내 카드를 클릭하면 덱 맨 위 카드를 내 자리에 펼쳐요. 5초 안에 안 펼치면 자동으로 펼쳐져요.'],
      ['승인 (J)', '모두의 맨 위 카드 중 같은 아이콘(인원·실적·아이디어·목표) 개수 합이 정확히 5면 J(한글 상태에서도 돼요)나 [승인] 버튼! 가장 빠른 사람이 펼쳐진 카드를 전부 자기 덱 아래로 가져가요.'],
      ['반려', '5가 아닌데 누르면 다른 사람에게 1장씩 줘야 해요. 거의 동시에 눌러 한발 늦은 건 벌칙 없어요.'],
      ['끝', '카드가 다 떨어지면 탈락, 마지막 한 명이 남으면 끝나요. 제한 시간이 되면 카드를 가장 많이 가진 사람이 1등이에요.'],
    ],
    tips: ['방장은 대기실에서 제한 시간(3·5·10·15분·없음)을 정할 수 있어요.', '대화는 Enter로 열고 Enter로 보내요. 빈 칸에서 Enter나 Esc를 누르면 게임으로 돌아가요. 대화 중엔 Space·J가 게임 키로 안 먹혀요.'],
  },
  {
    id: 'escape', type: 'XLSX', title: '야근 탈출 (방탈출)',
    intro: '혼자 하는 방탈출이에요. 방 하나가 시트 한 장이에요.',
    steps: [
      ['멀리서 보기', '시트를 줄이면 셀 색이 모여 방 그림이 보여요. 슬라이더, Ctrl + 마우스 휠, [전체 보기]로 조절해요.'],
      ['가까이 보기', '그림 속 물건을 클릭하거나 더블클릭하면 그곳으로 확대돼요. 셀 속 글씨가 단서예요.'],
      ['잠긴 물건', '잠긴 셀을 선택하고 암호를 입력한 뒤 Enter.'],
      ['다음 방', '아래 시트 탭이 방이에요. 잠긴 탭을 누르고 암호를 넣으면 다음 방이 열려요.'],
      ['탈출', '탈출하면 걸린 시간이 나와요. 닉네임을 넣고 자랑 링크를 복사해 친구에게 보내 보세요.'],
    ],
    tips: ['엑셀 기능이 퍼즐 도구예요.', '막히면 [힌트]를 누르세요. 사용한 힌트 수는 최종 기록에 함께 남아요.', '진행 상황은 자동 저장돼요. 처음부터 다시 하려면 [처음부터 다시 하기] 버튼을 누르세요.'],
  },
  {
    id: 'workshop', type: 'PPTX', title: '워크숍 조난기 (방탈출)',
    intro: '혼자 하는 방탈출이에요. 워크숍 일정표 PPT 속 단서로 10시 버스를 타야 해요. 제한 시간은 20분이에요.',
    steps: [
      ['슬라이드', '왼쪽 슬라이드 목록이 장소예요. 숙소 → 로비 → 리조트 정문 순서로, 앞 구역을 풀어야 다음 구역이 열려요.'],
      ['물건 다루기', '물건을 클릭하면 선택되고, 마우스를 올리면 설명이 떠요. 여러 개는 드래그로 둘러싸거나 Ctrl+클릭. 끌어서 옮길 수 있는 물건도 있어요.'],
      ['PPT 기능', '위쪽 홈 탭의 투명도, 도형 병합, 밝기/대비, 맨 뒤로, 자르기, 회전 같은 기능이 퍼즐 도구예요. 잘못했으면 실행 취소(Ctrl+Z).'],
      ['단서', '화면 아래 [슬라이드 노트]와 오른쪽 [내 소지품]의 단체방 메시지를 꼭 읽어 보세요.'],
      ['탑승', '10시 전에 맞는 버스에 타면 세이프, 넘기면 지각이에요. 다른 버스에 타면 2분을 손해 봐요.'],
    ],
    tips: ['막히면 [힌트] → 퍼즐을 골라서 단계별로 봐요. 처음 본 단계만 힌트 사용 횟수에 들어가요.', '탈출하면 걸린 시간·힌트 횟수·세이프/지각이 나와요. 자랑 링크를 친구에게 보내 보세요.', '진행 상황은 자동 저장돼요. 처음부터 다시 하려면 [처음부터 다시 하기].'],
  },
]

HOWTO.push({
  id: 'framed', type: 'PC', title: '누명 탈출 (방탈출)',
  intro: '혼자 하는 방탈출이에요. 법인카드 부정 사용 누명을 쓴 금요일 밤, 새벽 2시 30분에 감사팀 PC 앞에 앉았어요. 3시에 본사 감사위원회 회의가 열리고, 박 팀장의 보고서도 그 시각에 맞춰 예약 발송돼 있어요. 예약 메일을 막아도 소명서 마감은 3시 그대로예요. 제한 시간은 실제 30분이에요.',
  steps: [
    ['잠금 풀기', '잠금 화면을 클릭하면 로그인 화면이 열려요. 암호 힌트와 화면 속 사진이 단서예요.'],
    ['PC 살펴보기', '아이콘은 더블클릭으로 열어요. 창은 끌어서 옮기고 최소화·최대화·닫기가 돼요. 거의 모든 것을 클릭해 볼 수 있지만 쓸모없는 것도 많아요.'],
    ['증거 모으기', '진짜 증거를 찾으면 [내 USB에 저장]이 떠요. 증거는 7개예요. 내 USB의 조사_메모.txt에 찾을 것들이 적혀 있어요.'],
    ['사내메신저', '중간에 팀장을 찾는 메신저가 와요. 팀장인 척 말투를 맞춰 답하세요. 의심이 쌓이면 보안팀 순찰로 5분을 잃어요.'],
    ['소명서', '내 USB의 소명서에 보고서의 주장마다 반박 증거를 붙이고, 진짜 사용자와 근거를 골라 3시 전에 보내요. 맞았는지는 결과 화면에서 알려줘요.'],
  ],
  tips: ['막히면 [💡 힌트] → 증거별로 3단계까지 볼 수 있어요. 처음 본 단계만 힌트 횟수에 들어가요.', '엔딩은 S~F 6가지예요. 예약 메일까지 막아야 S를 받을 수 있어요.', '보스키·다른 탭에서는 시간이 멈춰요. 처음부터 다시 하려면 작업 표시줄 [↺ 처음부터].'],
})

const WORDBALL_HOWTO: (typeof HOWTO)[number] = {
  id: 'wordball', type: 'XLSX', title: '영단어 야구 (퍼즐)',
  intro: '혼자 하는 단어 퍼즐이에요. 5글자 영단어를 맞혀요. 정규 9회 안에 맞히는 게 목표고, 넘기면 연장전으로 맞힐 때까지 계속해요.',
  steps: [
    ['입력', '키보드로 5글자 영단어를 치고 Enter. Backspace로 지워요. 아래 글자 표를 눌러도 입력돼요.'],
    ['판정', '초록 = 스트라이크(글자·위치 일치), 노랑 = 볼(글자만 일치), 회색 = 아웃(없는 글자). 오른쪽 칸에 2S 1B처럼 요약돼요.'],
    ['같은 글자', '정답에 있는 개수만큼만 S·B로 세요. 스트라이크를 먼저 센 뒤 남은 개수로 볼을 셉니다.'],
    ['자유 입력', '영어 사전에 없는 조합(예: ABCDE)도 입력할 수 있어요. 5글자를 다 채우지 않으면 #VALUE!로 막히고 기회는 줄지 않아요.'],
    ['모드', '오늘의 단어는 모두에게 같은 단어로 하루 한 번, 무한 모드는 계속 플레이할 수 있어요.'],
  ],
  tips: ['Sheet2 탭에 맞힌 날·정규 이닝 성공률·평균 이닝·연속 성공·이닝 분포가 있어요. 기록은 이 브라우저에 저장돼요.', '[결과 공유]는 정답 없이 "7회 성공"처럼 이닝 수만 복사해요.'],
}
HOWTO.push(WORDBALL_HOWTO)
HOWTO.push(
  {
    id: 'mines', type: 'XLSX', title: '지뢰찾기 (퍼즐)',
    intro: '혼자 하는 퍼즐이에요. 지뢰를 피해서 나머지 칸을 모두 열면 끝. 걸린 시간이 기록이에요.',
    steps: [
      ['레벨', '초급 9×9 지뢰 10개 · 중급 16×16 지뢰 40개 · 고급 30×16 지뢰 99개.'],
      ['열기', '왼쪽 클릭. 첫 칸은 항상 안전해요(주변까지 비어 있어요).'],
      ['깃발', '오른쪽 클릭 또는 Space. 다시 누르면 지워져요.'],
      ['주변 열기', '숫자 칸에서 양쪽 버튼 동시 클릭(또는 가운데 버튼). 깃발 수가 숫자와 같으면 나머지 주변 칸이 한 번에 열려요. 숫자 칸을 왼쪽 클릭만 해도 되게 설정할 수 있어요(기본 켜짐).'],
      ['새 판', '[새 판] 또는 F2.'],
    ],
    tips: ['폰에서는 길게 누르면 깃발이에요.', '레벨별 최고 기록이 이 브라우저에 저장돼요. 깨면 [결과 복사]로 자랑해 보세요.', '다른 탭으로 가거나 보스키를 누르면 시간이 멈춰요.'],
  },
  {
    id: 'sudoku', type: 'XLSX', title: '스도쿠 (퍼즐)',
    intro: '혼자 하는 퍼즐이에요. 가로줄·세로줄·3×3 칸마다 1~9가 한 번씩 들어가게 채워요. 정답은 하나뿐이에요.',
    steps: [
      ['레벨', '초급(채워진 숫자 40개) · 중급(32개) · 고급(26개). 어려울수록 쉬운 방법만으로는 안 풀려요.'],
      ['입력', '칸을 클릭하고 키보드 1~9 또는 위쪽 숫자 버튼. 방향키로 이동, Backspace로 지우기.'],
      ['메모', 'N(또는 Space)으로 메모 모드를 켜면 후보 숫자를 작게 적어요. [자동 메모]는 빈칸 전체에 후보를 채워 줘요. 숫자를 넣으면 같은 줄·칸의 메모는 자동으로 지워져요.'],
      ['도움', '틀린 숫자는 빨갛게 보이고 실수로 세요(게임 오버는 없어요). Ctrl+Z 되돌리기, [힌트]로 한 칸 채우기.'],
    ],
    tips: ['숫자 버튼 아래 작은 숫자는 남은 개수예요.', '다른 탭으로 가거나 보스키를 누르면 자동으로 일시정지되고 판이 가려져요.', '진행 중인 판은 레벨별로 저장돼요. 힌트를 쓴 판은 최고 기록에 들어가지 않아요.'],
  },
  {
    id: 'cable', type: 'VSDX', title: '케이블 연결 (퍼즐)',
    intro: '네트워크 구성도의 칸마다 케이블 조각이 있어요. 칸을 돌려서 가운데 서버와 모든 PC를 이으면 완료예요. 판은 매번 새로 만들어지고 항상 풀려요.',
    steps: [
      ['난이도', '초급 5×5 · 중급 7×6 · 고급 9×8. 레벨별로 하던 판은 저장돼요.'],
      ['돌리기', '칸을 클릭하면 시계방향 90°, 우클릭하면 반대로 돌아가요. 키보드는 방향키·WASD로 칸을 옮기고 Q(반시계)·E(시계)로 돌려요. 휴대폰은 탭.'],
      ['잠그기', 'Shift+클릭 또는 Space로 맞는 칸을 잠가 두면 실수로 안 돌아가요. [잠금 모두 해제]로 풀기.'],
      ['완료', '서버와 이어진 선은 파랑으로 켜져요. 모든 칸이 이어지고 허공으로 뻗은 선이 없으면 완료! N은 새 구성도.'],
    ],
    tips: ['끝이 하나뿐인 칸이 PC예요. 가장자리부터 맞춰 보세요.', '친구랑 겨루려면 파티 게임의 「케이블 연결 대결」.'],
  },
  {
    id: 'shapes', type: 'PPTX', title: '도형 배치 (퍼즐)',
    intro: '조직 개편안 슬라이드의 점선 영역에 부서 도형을 빈틈없이 채우는 퍼즐이에요. 판은 매번 새로 만들어지고 항상 풀려요.',
    steps: [
      ['난이도', '초급(도형 3개)·중급(4개)·고급(5개)·전문가(6개). 레벨별로 하던 판은 저장돼요.'],
      ['옮기기', '도형을 끌어서 점선 영역에 놓으면 칸에 딱 붙어요. 놓을 자리가 초록이면 들어가고 빨강이면 안 돼요. 밖으로 끌거나 Delete로 빼요.'],
      ['돌리기·뒤집기', '시계방향 E(또는 R·오른쪽 클릭·휠 아래), 반시계 Q(또는 Shift+R·휠 위), 좌우 대칭 A(더블클릭), 상하 대칭 D(Shift+더블클릭). 선택한 도형 위 ↻ 핸들을 잡고 돌려도 돼요.'],
      ['완료', '다 채우면 배치 완료! 잠시 뒤 다음 슬라이드로 넘어가요. N을 누르면 언제든 새 슬라이드.'],
    ],
    tips: ['1~5 또는 Tab으로 도형을 골라요.', '친구랑 겨루려면 파티 게임의 「도형 배치 대결」.'],
  },
)

function HowTo() {
  const [open, setOpen] = useState<string | null>('liar')
  return (
    <section className="lobby-page">
      <div className="sec-head"><h2>플레이 방법</h2><span className="muted">게임 이름을 누르면 펼쳐져요</span></div>
      <div className="doc">
        <b>공통</b>
        <ol>
          <li><strong>파티 게임</strong> — 게임 카드를 누르면 방이 만들어지고 초대 링크가 생겨요. 링크를 받은 사람은 닉네임만 입력하면 들어와요. 가입은 필요 없어요. 방장이 나가면 다음 사람이 방장이 돼요.</li>
          <li><strong>방탈출 · 퍼즐</strong> — 카드를 누르면 바로 시작해요.</li>
          <li><strong>보스키</strong> — 누가 다가오면 <kbd>Esc</kbd>를 빠르게 두 번! 엑셀 화면으로 바뀌고, 다시 두 번 누르면 돌아와요. 게임은 뒤에서 계속 진행돼요.</li>
        </ol>
      </div>
      {HOWTO.map((h) => (
        <div key={h.id} className={'acc' + (open === h.id ? ' open' : '')}>
          <button className="acc-h" onClick={() => setOpen(open === h.id ? null : h.id)} aria-expanded={open === h.id}>
            <FileTag type={h.type} />{h.title}<span className="ar">{open === h.id ? '▲ 접기' : '▼ 펼치기'}</span>
          </button>
          {open === h.id && (
            <div className="acc-b">
              {h.intro && <p>{h.intro}</p>}
              <ol>{h.steps.map(([t, d]) => <li key={t}><strong>{t}</strong> — {d}</li>)}</ol>
              {h.tips && <ul className="tips">{h.tips.map((t) => <li key={t}>{t}</li>)}</ul>}
            </div>
          )}
        </div>
      ))}
    </section>
  )
}
