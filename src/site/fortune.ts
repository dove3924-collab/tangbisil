import { MENUS } from './lunch'
import { deviceSeed, hash, pickOne, rng, todayKey } from './rand'

export const ZODIAC = ['쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지']
export const ZODIAC_EMOJI = ['🐭', '🐮', '🐯', '🐰', '🐲', '🐍', '🐴', '🐑', '🐵', '🐔', '🐶', '🐷']
export const zodiacOf = (year: number) => ((year - 4) % 12 + 12) % 12

const HEAD: Record<1 | 2 | 3 | 4 | 5, string[]> = {
  1: ['오늘은 몸을 낮추고 조용히 지나가는 게 이득이에요.', '메일 보내기 전에 받는 사람 한 번 더 확인하세요.', '중요한 결정은 내일로 미뤄도 괜찮아요.'],
  2: ['큰 일은 없지만 자잘한 요청이 많은 날이에요.', '예상보다 회의가 길어질 수 있어요. 물 한 잔 챙기세요.', '오전엔 흐리고 오후엔 갬. 점심 이후가 나아요.'],
  3: ['무난하게 흘러가는 하루. 정시 퇴근이 보여요.', '평소대로만 하면 충분히 좋은 날이에요.', '작은 칭찬 하나가 하루를 살려 줄 거예요.'],
  4: ['일이 술술 풀리는 날. 미뤄둔 일을 처리해 보세요.', '오늘 낸 아이디어가 생각보다 반응이 좋아요.', '동료 운이 좋아요. 도움 요청하면 바로 해결돼요.'],
  5: ['오늘은 뭘 해도 되는 날! 칼퇴 각이에요.', '윗사람 눈에 띄는 날. 보고는 오늘 하세요.', '오래 기다린 좋은 소식이 들려올 수 있어요.'],
}

const AREA: Record<string, [string[], string[], string[]]> = {
  업무운: [
    ['오타 하나가 큰일이 될 수 있어요. 보내기 전에 한 번 더.', '갑작스런 요청이 끼어들어요. 우선순위를 정해 두세요.', '파일 저장을 자주 하세요. 진짜로요.'],
    ['평소 속도면 충분해요. 무리하지 마세요.', '오전에 집중이 잘 돼요. 어려운 일은 오전에.', '체크리스트를 만들면 일이 빨리 끝나요.'],
    ['막혔던 일이 풀리는 날이에요.', '오늘 정리한 문서가 두고두고 쓰여요.', '회의에서 한마디 하면 좋은 반응이 와요.'],
  ],
  금전운: [
    ['충동 결제 주의. 장바구니에만 담아 두세요.', '커피값이 은근히 새요. 탕비실 커피 추천.', '점심 더치페이 계산 한 번 더 확인하세요.'],
    ['큰 지출은 없는 평범한 날이에요.', '쿠폰이나 적립을 챙기면 소소하게 이득이에요.', '오늘 아낀 돈은 주말의 행복으로.'],
    ['생각지 못한 공짜 커피가 생겨요.', '법카 점심의 기운이 느껴져요.', '작은 행운이 지갑에 들어오는 날이에요.'],
  ],
  인간관계운: [
    ['말 한마디가 오해를 부를 수 있어요. 이모티콘을 아끼지 마세요.', '상사의 기분이 흐림. 보고는 짧고 굵게.', '메신저 답장은 조금 늦어도 괜찮아요.'],
    ['무난한 하루. 먼저 인사하면 분위기가 좋아져요.', '옆자리 동료와 간식 나눠 먹기 좋은 날.', '점심 메뉴 정할 때 의견을 내 보세요.'],
    ['동료가 먼저 도와주겠다고 해요.', '상사와 대화가 잘 통하는 날이에요.', '오랜만에 연락 온 사람이 좋은 소식을 가져와요.'],
  ],
  퇴근운: [
    ['5시 50분의 메일을 조심하세요.', '야근 기운이 살짝. 오늘 할 일은 오후 4시 전에.', '퇴근 직전 회의 소집 가능성 있어요.'],
    ['정시 퇴근 가능성 반반. 마무리를 미리 해 두세요.', '퇴근길이 평소보다 조금 막혀요.', '할 일 목록을 줄이면 칼퇴가 보여요.'],
    ['칼퇴 확정! 저녁 약속 잡아도 돼요.', '오늘은 시계가 빨리 가는 날이에요.', '일찍 끝내고 일찍 가는 날이에요.'],
  ],
}

const COLORS = [['베이지', '#d8c3a5'], ['네이비', '#2b3a67'], ['민트', '#7fd1b9'], ['코랄', '#ff7f6b'], ['라벤더', '#b9a6e8'], ['머스타드', '#e0b43a'], ['차콜', '#444'], ['하늘색', '#86c5f0'], ['올리브', '#8a9a4b'], ['버건디', '#8c2f39']] as const
const ITEMS = ['포스트잇', '텀블러', '무선 이어폰', '보조배터리', '핸드크림', '사원증 목걸이', '탁상 달력', '볼펜 한 자루', '목캔디', '손목 받침대', '노트북 거치대', '초콜릿']
const ZLINE = [
  '오전에 집중하면 오후가 편해요.', '점심 이후 좋은 소식이 와요.', '말보다 메일로 남기는 게 좋아요.', '먼저 인사하면 하루가 풀려요.',
  '오늘은 무리하지 말고 정시에.', '미뤄둔 일을 끝내기 좋은 날.', '동료의 도움이 큰 힘이 돼요.', '지갑 단속이 필요한 날이에요.',
  '아이디어가 반짝이는 하루.', '회의에서 존재감을 보여 주세요.', '작은 실수 조심, 확인 또 확인.', '칼퇴의 기운이 강해요.',
  '커피 한 잔이 행운을 불러요.', '새로운 일을 맡게 될 수 있어요.', '오후 3시쯤 기분 좋은 일이 생겨요.', '오늘은 조용히 내 일에 집중.',
]

export type Score = 1 | 2 | 3 | 4 | 5
export interface Fortune {
  score: Score
  head: string
  areas: { name: string; score: Score; text: string }[]
  color: { name: string; hex: string }
  number: number
  lunch: string
  item: string
  time: string
}

function score(r: () => number): Score {
  const x = r()
  return (x < 0.06 ? 1 : x < 0.22 ? 2 : x < 0.55 ? 3 : x < 0.85 ? 4 : 5) as Score
}

export function fortuneFor(birth: string, day = todayKey()): Fortune {
  const r = rng(hash(`${day}|${birth || deviceSeed()}`))
  const s = score(r)
  const areas = Object.entries(AREA).map(([name, pools]) => {
    const sc = score(r)
    return { name, score: sc, text: pickOne(r, pools[sc <= 2 ? 0 : sc === 3 ? 1 : 2]) }
  })
  const c = pickOne(r, COLORS)
  const h = 9 + Math.floor(r() * 9)
  return {
    score: s,
    head: pickOne(r, HEAD[s]),
    areas,
    color: { name: c[0], hex: c[1] },
    number: 1 + Math.floor(r() * 45),
    lunch: pickOne(r, MENUS).name,
    item: pickOne(r, ITEMS),
    time: `${h < 12 ? '오전' : '오후'} ${h > 12 ? h - 12 : h}시 ${String(Math.floor(r() * 60)).padStart(2, '0')}분`,
  }
}

/** 띠별 오늘 한 줄 */
export function zodiacLines(day = todayKey()) {
  return ZODIAC.map((z, i) => {
    const r = rng(hash(`z|${day}|${i}`))
    return { name: z, emoji: ZODIAC_EMOJI[i], score: score(r), text: pickOne(r, ZLINE) }
  })
}

export const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n)
