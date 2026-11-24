import { canvas, digitMask } from './pixel'
import type { Flags, Hotspot, RoomDef, StoryPage, TableDef } from './types'

/** 야근 탈출 1화 「금요일 밤 11시」 — 방마다 시트 한 장, 셀 하나가 픽셀 하나 */

export const EP_TITLE = '야근 탈출 「금요일 밤 11시」'
export const FILE_NAME = 'Q3_예산집계_최종_v2.xlsx'
const P = (title: string, icon: StoryPage['icon'], text: string): StoryPage => ({ title, icon, text })

/** yyyy-mm-dd → 엑셀 날짜 일련번호 */
const serial = (d: string) => Math.round((Date.parse(d + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000)

export const INTRO: StoryPage[] = [
  P('알림', 'info', '11월 7일 금요일 오후 10:52\n\n7층 사무실 조명이 자동으로 꺼졌습니다.\n(30분 동안 움직임이 감지되지 않음)'),
  P('7층 사무실', 'info', '그 시각, 나는 탕비실에서 컵라면을 먹고 있었다.\n팀장님이 퇴근하면서 남긴 "월요일 아침 회의 자료 부탁해요~" 때문에.'),
  P('출입문 패널', 'warn', '야간 경비 모드\n월요일 오전 7:00까지 출입이 통제됩니다.'),
  P('출입 기록', 'info', '22:55  경비원 순찰 완료 — 7층 재실자 없음 확인\n\n불이 꺼져 있으니 아무도 없는 줄 알고 잠근 거다.'),
  P('휴대폰', 'error', '배터리 0%\n\n충전기는 집에 있다. 사무실 전화로 경비실에 걸어봤지만\n"무인 경비로 전환되었습니다"라는 안내만 나온다.'),
  P('김대리 (기억)', 'info', '이대로면 월요일 아침까지 갇힌다.\n그때 지난달 퇴사한 김대리의 마지막 말이 떠올랐다.\n\n"혹시 금요일 밤에 갇히면 내 인수인계 파일 열어봐. 농담 아님."'),
  P(FILE_NAME, 'info', '인수인계 폴더의 파일을 열자 첫 셀에 메모가 붙어 있다.\n\n"역시 열었구나 ㅋㅋ 나도 작년에 똑같이 갇혔었어.\n그날 나간 방법을 이 파일에 숨겨뒀어.\n회사 공용 파일이라 대놓고는 못 적었고,\n엑셀 좀 만질 줄 알면 찾을 거야. — 김대리"'),
  P('플레이 방법', 'info',
    '· 시트를 줄이면 방 그림이, 확대하면 셀 속 글씨가 보여요.\n' +
    '  (오른쪽 아래 슬라이더 · Ctrl + 마우스 휠 · 더블클릭)\n' +
    '· 멀리서 물건을 클릭하면 그곳으로 확대돼요.\n' +
    '· 잠긴 물건은 셀을 선택하고 암호를 입력한 뒤 Enter\n' +
    '· 엑셀 기능이 퍼즐 도구예요.\n' +
    '· 막히면 언제든 [힌트]'),
]

export const ENDING: StoryPage[] = [
  P('출입 게이트', 'ok', '삑― 출입 게이트가 열렸다.\n회전문을 밀고 나가자 차가운 밤공기가 느껴진다.'),
  P('휴대폰', 'info', '경비실 충전기에 꽂아뒀던 휴대폰이 켜졌다.\n새 메시지 1개'),
  P('김대리 (문자)', 'info', '나왔구나 ㅋㅋ 축하해.\n\n근데 그 파일 이름 봤어? \'최종_v2\'야.\n진짜 최종은 v3에 있어.\n다음에 또 갇히면 그거 열어봐.'),
  P('김대리 (문자)', 'info', '아 그리고 시트 탭 우클릭해봐.\n선물 하나 숨겨놨어.'),
]

/* ════════════════ 방 1. 7층 사무실 ════════════════ */

const KIM_BIRTH = serial('1998-03-14')
const R1 = { w: 120, h: 70 }
const LOCKERS = [
  { x: 95, y: 7, name: '박과장' }, { x: 107, y: 7, name: '이주임' },
  { x: 95, y: 20, name: '김대리' }, { x: 107, y: 20, name: '정대리' },
  { x: 95, y: 33, name: '최사원' }, { x: 107, y: 33, name: '나' },
]

const room1Tables: TableDef[] = [
  {
    id: 'birth', x: 34, y: 4, spans: [4, 6, 6],
    title: '11월 · 팀 생일표', titleColor: '#ffffff',
    header: ['이름', '생일', '메모'], headerFill: '#e2efda',
    rows: [
      { cells: ['박과장', { serial: serial('1985-07-02'), dateFmt: true }, '케이크는 생크림'] },
      { cells: ['이주임', { serial: serial('1993-11-21'), dateFmt: true }, ''] },
      { cells: ['정대리', { serial: serial('1990-02-08'), dateFmt: true }, '떡케이크 금지'] },
      { cells: ['김대리', { serial: KIM_BIRTH, id: 'kimBirth' }, '축하 금지 ㅋㅋ'] },
      { cells: ['최사원', { serial: serial('1999-09-30'), dateFmt: true }, ''] },
      { cells: ['나', { serial: serial('1996-05-17'), dateFmt: true }, ''] },
    ],
  },
  {
    id: 'msg', x: 56, y: 12, spans: [3, 4, 19],
    title: '메신저 — 김대리 (퇴사)', titleColor: '#ffffff',
    header: ['날짜', '보낸 사람', '내용'], headerFill: '#dbe5f5',
    rows: [
      ['10/02', '김대리', '나 다음 달에 퇴사함 ㅋㅋ 아직 비밀'],
      ['10/02', '나', '헐 진짜요?'],
      ['10/31', '김대리', '사물함 비워놨는데 쪽지 하나 넣어뒀어'],
      ['10/31', '나', '사물함 비번이 뭐예요?'],
      ['10/31', '김대리', '내 생일 월일 4자리 ㅋㅋ'],
    ].map((cells) => ({ cells })),
  },
  ...LOCKERS.map((l): TableDef => ({ id: 'tag-' + l.name, x: l.x + 1, y: l.y + 1, spans: [9], rows: [{ cells: [{ v: l.name, bold: true }] }] })),
  {
    id: 'locker', x: 96, y: 22, spans: [9],
    rows: [{ cells: [{ v: '[잠김] 비밀번호 4자리', lock: 'locker' }] }],
  },
  {
    id: 'note', x: 96, y: 26, spans: [9],
    rows: [
      { cells: [{ v: '(빈 쪽지)', color: '#999999' }], showIf: 'r1_locker' },
      { cells: [{ v: '서버실 시트 암호: 4729', white: true, id: 'note1' }], showIf: 'r1_locker' },
      { cells: [{ v: '카드키는 서버실 문에 대면 돼', white: true }], showIf: 'r1_locker' },
      { cells: [{ v: '- 김대리', white: true }], showIf: 'r1_locker' },
    ],
  },
]

function room1Art(f: Flags) {
  const { px, rect, dot } = canvas(R1.w, R1.h, '#e9e3d5')
  // 바닥
  rect(0, 45, R1.w, 25, '#9a8166'); rect(0, 44, R1.w, 1, '#bdb39e')
  for (let y = 47; y < R1.h; y += 4) rect(0, y, R1.w, 1, '#8a7258')
  for (let y = 45; y < R1.h; y++) for (let x = y % 8 < 4 ? 3 : 9; x < R1.w; x += 12) dot(x, y, '#8a7258')
  // 사무실 문
  rect(2, 12, 12, 33, '#6b4a2f'); rect(3, 13, 10, 31, '#7d5636'); rect(11, 28, 1, 3, '#e2c15a'); rect(4, 8, 8, 3, '#2f9e57'); rect(5, 9, 6, 1, '#c9f2d6')
  rect(14, 26, 2, 4, '#3a3f48'); dot(14, 27, '#ff3b30')
  // 창문 (밤)
  rect(17, 4, 14, 17, '#f4f4f4'); rect(18, 5, 12, 15, '#1d2a44'); rect(23, 5, 2, 15, '#f4f4f4'); rect(18, 12, 12, 1, '#f4f4f4')
  rect(26, 7, 2, 2, '#f3e7a0'); [[19, 7], [21, 16], [27, 17], [20, 10]].forEach(([x, y]) => dot(x, y, '#c8d3ea'))
  // 달력 (생일표)
  rect(33, 4, 18, 15, '#fbfbf7'); rect(33, 4, 18, 1, '#c0392b'); rect(36, 3, 1, 2, '#555'); rect(47, 3, 1, 2, '#555')
  rect(33, 18, 18, 1, '#d8d4c8')
  // 모니터 (메신저)
  rect(54, 11, 30, 18, '#2a2a2a'); rect(55, 12, 28, 16, '#f4f7fc'); rect(55, 12, 28, 1, '#3b6fd1')
  rect(67, 29, 4, 1, '#2a2a2a')
  // 책상, 키보드, 컵라면
  rect(48, 30, 44, 2, '#5a3d26'); rect(48, 32, 44, 1, '#6b4a2f'); rect(50, 33, 2, 11, '#4a3220'); rect(88, 33, 2, 11, '#4a3220')
  rect(60, 29, 14, 1, '#cfcfcf'); rect(78, 27, 3, 3, '#f2f2f2'); rect(78, 27, 3, 1, '#c0392b')
  // 의자
  rect(64, 35, 10, 2, '#2f3b4d'); rect(68, 37, 2, 5, '#2f3b4d'); rect(65, 42, 8, 1, '#2f3b4d')
  // 사물함 6칸
  rect(94, 6, 24, 39, '#6d7682')
  LOCKERS.forEach((l) => {
    const open = l.name === '김대리' && f.r1_locker
    rect(l.x, l.y, 11, 12, open ? '#2b2f36' : '#a3acb8')
    rect(l.x + 1, l.y + 1, 9, 1, '#ffffff')
    if (!open) { rect(l.x + 9, l.y + 6, 1, 3, '#3a3f48'); for (let k = 0; k < 3; k++) rect(l.x + 2, l.y + 9 + k % 2, 3, 1, '#8c95a1') }
  })
  if (f.r1_locker) { rect(96, 22, 9, 1, '#2b2f36'); rect(97, 23, 3, 2, '#4fa3d9'); rect(96, 26, 9, 4, '#fbfbf7') }
  else rect(96, 22, 9, 1, '#e6e9ee')
  // 화분, 휴지통
  rect(19, 41, 7, 9, '#b5643a'); rect(18, 40, 9, 1, '#a0552f'); rect(18, 31, 9, 9, '#3f8f4a'); rect(20, 28, 5, 3, '#4fa35a'); rect(17, 33, 2, 4, '#4fa35a'); rect(26, 32, 2, 4, '#4fa35a')
  rect(84, 46, 6, 7, '#8d9aa6'); rect(84, 46, 6, 1, '#6e7b87')
  return px
}

function room1Hotspots(f: Flags): Hotspot[] {
  return [
    { x: 33, y: 3, w: 18, h: 16, label: '달력 (생일표)' },
    { x: 54, y: 11, w: 30, h: 19, label: '내 모니터' },
    { x: 95, y: 20, w: 11, h: 12, label: '김대리 사물함' },
    ...LOCKERS.filter((l) => l.name !== '김대리').map((l) => ({ x: l.x, y: l.y, w: 11, h: 12, label: `${l.name} 사물함`, say: [l.name === '나' ? '내 사물함이다. 우산이랑 비상 간식뿐.' : '남의 사물함이다. 잠겨 있다.'] })),
    { x: 2, y: 8, w: 14, h: 37, label: '사무실 문', say: [f.r1_locker ? '카드키가 있어도 경비 모드가 켜져 있으면 안 열린다.\n일단 서버실 시트부터 열어 보자.' : '야간 경비 모드로 잠겨 있다.\n김대리 파일을 뒤져 보자.'] },
    { x: 17, y: 4, w: 14, h: 17, label: '창문', say: ['7층이다. 창문으로 나가는 건 영화에서나.'] },
    { x: 17, y: 28, w: 11, h: 22, label: '화분', say: ['화분에 포스트잇: "얘 물 좀 줘라 - 김대리"'] },
    { x: 84, y: 46, w: 6, h: 7, label: '휴지통', say: ['구겨진 종이: "회의자료_최종_진짜최종_이게마지막.pptx"'] },
    { x: 77, y: 26, w: 5, h: 4, label: '컵라면', say: ['다 불었다. 이것 때문에 갇혔다.'] },
  ]
}

/* ════════════════ 방 2. 서버실 ════════════════ */

const R2 = { w: 120, h: 70 }
const RACK_X = [6, 34, 62]
const SEC_ROW = 17 // 3번 랙에서 보안 서버가 있는 줄
const KINDS = ['웹 서버', 'DB 서버', '스토리지', '스위치', '백업 서버', '메일 서버', '그룹웨어', '파일 서버', 'VPN', 'UPS', '로그 수집', '모니터링']
const rnd = (n: number) => Math.abs(Math.sin(n * 78.233) * 43758.5453) % 1
const hex4 = (n: number) => Math.floor(rnd(n) * 9000 + 1000).toString()
const rackRows = (k: number) => Array.from({ length: 28 }, (_, i) => {
  if (k === 2 && i === SEC_ROW) return { cells: [{ v: '보안 서버', id: 'secServer' }, 'SN-77K1-4093'] }
  const kind = KINDS[Math.floor(rnd(k * 50 + i) * KINDS.length)]
  return { cells: [`${kind}-${String(i + 1).padStart(2, '0')}`, `SN-${hex4(k * 97 + i).slice(0, 2)}${String.fromCharCode(65 + Math.floor(rnd(i + k) * 26))}${hex4(i * 7 + k).slice(0, 1)}-${hex4(k * 31 + i * 3)}`] }
})

const CLIP_CODES = ['3381', '9024', '1576', '8840', '2219', '7053', '6142', '4497', '5310', '1786']

const room2Tables: TableDef[] = [
  ...RACK_X.map((x, k): TableDef => ({
    id: 'rack' + (k + 1), x: x + 2, y: 8, spans: [9, 11], color: '#e6edf5',
    title: `${k + 1}번 랙 장비 목록`, titleColor: '#ffffff',
    header: ['장비', '시리얼'], headerFill: '#3d4a5c',
    rows: rackRows(k),
  })),
  {
    id: 'pc', x: 92, y: 7, spans: [7, 16], color: '#e6edf5',
    title: '보안 관리 시스템', titleColor: '#9fd0ff',
    rows: [
      { cells: ['상태', { v: '야간 경비 모드 켜짐 (월 07:00까지)', id: 'pcState' }] },
      { cells: ['관리자 암호', { v: '[잠김] 보안 서버 시리얼 끝 4자리', lock: 'login' }] },
      { cells: ['로그인', '성공 (관리자)'], showIf: 'r2_login' },
      { cells: ['경비 모드 해제', { v: '[잠김] 해제 코드 4자리', lock: 'release' }], showIf: 'r2_login' },
      { cells: ['안내', '해제 코드는 클립보드 코드표의 오늘(11/07) 코드'], showIf: 'r2_login' },
    ],
  },
  {
    id: 'clip', x: 93, y: 31, spans: [4, 1], narrowCol: 1,
    title: '야간 경비 해제 코드',
    header: ['날짜', '코드'], headerFill: '#e2efda',
    rows: CLIP_CODES.map((c, i) => ({ cells: [`11/${String(i + 1).padStart(2, '0')}`, Number(c)] })),
  },
]

function room2Art(f: Flags) {
  const { px, rect, dot } = canvas(R2.w, R2.h, '#1c2029')
  rect(0, 50, R2.w, 20, '#2a2f39'); for (let x = 0; x < R2.w; x += 8) rect(x, 50, 1, 20, '#232730'); rect(0, 58, R2.w, 1, '#232730')
  // 에어컨
  rect(40, 1, 18, 3, '#cfd5dc'); for (let x = 41; x < 57; x += 2) dot(x, 3, '#9aa3ad')
  RACK_X.forEach((x, k) => {
    rect(x, 5, 24, 43, '#3a3f48'); rect(x + 1, 6, 22, 41, '#20242b')
    for (let i = 0; i < 28; i++) {
      const y = 10 + i
      rect(x + 2, y, 20, 1, i % 2 ? '#262b33' : '#2b313a')
      const led = k === 2 && i === SEC_ROW ? '#ff3b30' : '#2fbf5b'
      dot(x + 22, y, f.r2_release && k === 2 && i === SEC_ROW ? '#2fbf5b' : led)
    }
    rect(x + 2, 40, 20, 6, '#2b313a'); rect(x + 4, 42, 16, 2, '#1a1d23')
  })
  // 보안 관리 PC (벽걸이 모니터) + 선반
  rect(90, 4, 28, 15, '#111'); rect(91, 5, 26, 13, f.r2_release ? '#12351f' : '#0f1f35')
  rect(90, 19, 28, 1, '#4a4f58'); rect(102, 20, 4, 2, '#4a4f58')
  // 클립보드
  rect(92, 29, 16, 15, '#c9a46a'); rect(93, 30, 14, 13, '#fbfbf7'); rect(98, 28, 4, 2, '#8a8f96')
  // 바닥 메모
  rect(96, 54, 5, 3, '#fff6a8')
  return px
}

function room2Hotspots(f: Flags): Hotspot[] {
  return [
    ...RACK_X.map((x, k) => ({ x, y: 5, w: 24, h: 43, label: `${k + 1}번 랙` })),
    { x: 90, y: 4, w: 28, h: 15, label: '보안 관리 PC' },
    { x: 92, y: 28, w: 16, h: 16, label: '클립보드' },
    { x: 40, y: 1, w: 18, h: 3, label: '에어컨', say: ['에어컨이 꺼져 있다. 그래서 이렇게 덥구나.'] },
    { x: 96, y: 54, w: 5, h: 3, label: '바닥 메모', say: ['김대리 메모: "서버실 에어컨 고장 났다고 3번 말했음. 3번."'] },
    { x: 0, y: 50, w: 30, h: 20, label: '바닥', say: [f.r2_release ? '경비 모드가 꺼졌다. 엘리베이터로 1층에 가자.' : '서버 팬 소리만 윙윙 울린다.'] },
  ]
}

/* ════════════════ 방 3. 1층 로비 ════════════════ */

const R3 = { w: 120, h: 70 }
const GATE_CODE = '8270'
const TILE = { x: 46, y: 53, cols: 17, rows: 7 }
const tileMask = digitMask(GATE_CODE, 1)
export const TILE_VALUES: number[][] = Array.from({ length: TILE.rows }, (_, r) =>
  Array.from({ length: TILE.cols }, (_, c) => {
    const on = r >= 1 && r <= 5 && c >= 1 && c <= 15 && tileMask[r - 1][c - 1]
    const seed = Math.abs(Math.sin((r + 1) * 91.7 + (c + 1) * 13.3) * 10000) % 1
    return on ? 70 + Math.floor(seed * 30) : 10 + Math.floor(seed * 21)
  }),
)

// 진짜 단서는 단어 단위로 쪼개 10/26~11/07에 한 줄씩, 그보다 앞 날짜엔 평범한 근무 메모를 섞는다.
// 날짜 오름차순으로 정렬해야 진짜 줄이 아래쪽에 모여 문장이 된다.
const ROSTER = [
  ['10/14', '화', '최○○', '순찰 완료'],
  ['10/15', '수', '박○○', '이상 없음'],
  ['10/17', '금', '이○○', '택배 2건 보관'],
  ['10/18', '토', '최○○', '3층 전등 교체 요청'],
  ['10/20', '월', '박○○', '주차장 차단기 점검'],
  ['10/22', '수', '이○○', '분실물(우산) 보관'],
  ['10/23', '목', '최○○', '소방 점검 예정'],
  ['10/25', '토', '박○○', '이상 없음'],
  ['10/26', '일', '이○○', '금요일'],
  ['10/27', '월', '최○○', '밤에'],
  ['10/28', '화', '박○○', '갇히면'],
  ['10/29', '수', '이○○', '출입'],
  ['10/30', '목', '최○○', '게이트'],
  ['10/31', '금', '박○○', '비번은'],
  ['11/01', '토', '이○○', '로비'],
  ['11/02', '일', '최○○', '바닥'],
  ['11/03', '월', '박○○', '타일에'],
  ['11/04', '화', '이○○', '있어.'],
  ['11/05', '수', '최○○', '- 경비'],
  ['11/06', '목', '박○○', '아저씨 -'],
  ['11/07', '금', '이○○', '(김대리 또 갇혔나?)'],
]
const ROSTER_SHUFFLE = [16, 3, 10, 19, 0, 13, 7, 9, 18, 5, 12, 1, 15, 20, 8, 4, 17, 11, 2, 14, 6]

const room3Tables: TableDef[] = [
  {
    id: 'roster', x: 6, y: 14, spans: [3, 2, 3, 12], sortable: true,
    title: '경비실 근무표',
    header: ['날짜', '요일', '근무자', '비고'], headerFill: '#e2efda',
    rows: ROSTER_SHUFFLE.map((i) => ({ cells: ROSTER[i] })),
  },
  {
    id: 'tiles', x: TILE.x, y: TILE.y - 1, spans: Array(TILE.cols).fill(1), cf: true,
    title: '로비 바닥 타일 번호',
    rows: TILE_VALUES.map((r) => ({ cells: r })),
  },
  {
    id: 'gate', x: 72, y: 27, spans: [4, 10],
    rows: [
      { cells: ['게이트', { v: '[잠김] 비밀번호 4자리', lock: 'gate' }] },
      { cells: ['보안', '정상 (경비 모드 해제됨)'] },
    ],
  },
]

function room3Art(f: Flags) {
  const { px, rect } = canvas(R3.w, R3.h, '#d9dee4')
  rect(0, 47, R3.w, 1, '#aab3bd'); rect(0, 48, R3.w, 22, '#c8ccd1')
  for (let y = 48; y < R3.h; y++) for (let x = 0; x < R3.w; x++) if ((Math.floor(x / 2) + Math.floor(y / 2)) % 2) px[y][x] = '#bfc4ca'
  // 바닥 타일 번호 구역
  for (let r = 0; r < TILE.rows; r++) for (let c = 0; c < TILE.cols; c++) px[TILE.y + r][TILE.x + c] = (r + c) % 2 ? '#d3d7dc' : '#e1e4e8'
  // 경비실
  rect(3, 10, 34, 37, '#8f9aa6'); rect(5, 12, 30, 27, '#eef6fb'); rect(3, 39, 34, 3, '#6c7782'); rect(32, 37, 2, 2, '#333'); rect(32, 36, 1, 1, '#2fbf5b')
  // 출입 게이트
  rect(70, 22, 3, 25, '#5c6670'); rect(86, 22, 3, 25, '#5c6670'); rect(73, 33, 13, 2, f.r3_gate ? '#3ad16b' : '#d9534f')
  rect(71, 26, 17, 4, '#fbfbf7'); rect(70, 20, 19, 2, '#3a3f48'); rect(74, 20, 11, 1, f.r3_gate ? '#3ad16b' : '#ff6b5e')
  // 회전문
  rect(93, 6, 24, 41, '#9aa6b2'); rect(95, 8, 20, 39, '#22314a'); rect(104, 8, 2, 39, '#9aa6b2'); rect(95, 26, 20, 1, '#9aa6b2')
  rect(98, 12, 2, 2, '#f3e7a0'); rect(110, 11, 1, 1, '#c8d3ea'); rect(108, 16, 1, 1, '#c8d3ea')
  // 화분
  rect(42, 40, 6, 7, '#b5643a'); rect(41, 33, 8, 7, '#3f8f4a')
  return px
}

function room3Hotspots(): Hotspot[] {
  return [
    { x: 3, y: 10, w: 34, h: 37, label: '경비실' },
    { x: TILE.x - 1, y: TILE.y - 1, w: TILE.cols + 2, h: TILE.rows + 2, label: '바닥 타일' },
    { x: 70, y: 20, w: 19, h: 27, label: '출입 게이트' },
    { x: 93, y: 6, w: 24, h: 41, label: '회전문', say: ['밖이다! 게이트만 지나면 퇴근.'] },
    { x: 41, y: 33, w: 8, h: 14, label: '화분', say: ['로비 화분은 누가 물을 줄까.'] },
  ]
}

/* ════════════════ 숨긴 시트 ════════════════ */

export const GIFT: RoomDef = {
  name: '김대리_퇴사선물', w: 80, h: 44, hiddenRows: [], locks: [], enter: [], hints: [],
  art: () => {
    const { px, rect } = canvas(80, 44, '#f6f3ea')
    rect(14, 3, 52, 38, '#fbfbf7'); rect(14, 3, 52, 1, '#d8d4c8')
    rect(58, 30, 6, 6, '#d9534f'); rect(60, 30, 2, 6, '#f2c21a'); rect(58, 32, 6, 1, '#f2c21a')
    return px
  },
  tables: [{
    id: 'gift', x: 16, y: 5, spans: [40],
    rows: [
      '고생했다 후배야.', '', '이 회사에서 배운 엑셀 기술 정리해줄게.', '',
      '· 흰 글씨는 칠하면 보인다', '· 날짜가 숫자로 보이면 셀 서식', '· 행 번호가 건너뛰면 숨기기 취소',
      '· 못 찾겠으면 Ctrl + F', '· ####이 보이면 열 너비를 넓혀라', '· 정렬하면 숨은 순서가 보인다',
      '· 조건부 서식은 멀리서 보면 그림이 된다', '', '다음 이야기는 Q3_예산집계_최종_v3.xlsx 에서.', '- 김대리',
    ].map((v) => ({ cells: [v] })),
  }],
  hotspots: () => [],
}

/* ════════════════ 방 목록 ════════════════ */

export const ROOMS: RoomDef[] = [
  {
    name: '1. 사무실', ...R1, art: room1Art, tables: room1Tables, hotspots: room1Hotspots,
    hiddenRows: [9], // 생일표 김대리 줄 (10행)
    locks: [{ id: 'locker', answer: '0314', title: '김대리 사물함', onOpen: [
      P('김대리 사물함', 'ok', '철컥! 사물함이 열렸다.\n서버실 카드키와 쪽지 한 장이 들어 있다.'),
      P('쪽지', 'info', '…아무것도 안 적혀 있다. 하얀 종이뿐이다.\n\n김대리가 빈 종이를 넣어뒀을 리가 없는데.'),
    ] }],
    enter: [],
    hints: [
      { until: 'r1_rows', steps: [
        '사물함 비번은 김대리 생일이래요. 그런데 달력 생일표를 사물함 이름표와 비교해 보면 한 명이 없어요.',
        '생일표의 행 번호가 9 → 11로 건너뛰어요. 그 근처 셀을 우클릭해서 [숨기기 취소]를 누르세요.',
      ] },
      { until: 'r1_date', steps: [
        '김대리 생일만 다른 사람과 다르게 숫자로 보여요. 엑셀에서 날짜는 원래 숫자예요.',
        '김대리 생일 셀을 선택하고 [표시 형식]을 "날짜"로 바꾸세요.',
      ] },
      { until: 'r1_locker', steps: [
        '사물함 비번은 김대리 생일의 월일 4자리예요.',
        '김대리 사물함의 [잠김] 셀을 선택하고 0314 를 입력한 뒤 Enter',
      ] },
      { until: 'r1_white', steps: [
        '빈 쪽지는 정말 비어 있는 걸까요? 흰 종이에 흰 글씨일 수도 있어요.',
        '쪽지 셀들을 드래그해서 선택하고 [채우기 색]을 진한 색으로 바꾸거나 [글꼴 색]을 바꿔 보세요.',
      ] },
      { until: 'room2', steps: [
        '쪽지에 서버실 시트 암호가 있어요.',
        '아래 "2. 서버실" 탭을 클릭하고 4729 를 입력하세요.',
      ] },
    ],
  },
  {
    name: '2. 서버실', password: '4729', ...R2, art: room2Art, tables: room2Tables, hotspots: room2Hotspots,
    hiddenRows: [], blink: [{ x: RACK_X[2] + 22, y: 10 + SEC_ROW }],
    locks: [
      { id: 'login', answer: '4093', title: '보안 관리 시스템', onOpen: [
        P('보안 관리 시스템', 'ok', '관리자 로그인 성공.'),
        P('보안 관리 시스템', 'info', '야간 경비 모드를 해제하려면 해제 코드가 필요합니다.\n해제 코드: 클립보드 코드표의 오늘(11/07) 코드'),
      ] },
      { id: 'release', answer: '6142', title: '보안 관리 시스템', onOpen: [
        P('보안 관리 시스템', 'ok', '야간 경비 모드가 해제되었습니다.\n엘리베이터 운행을 재개합니다.'),
        P('보안 관리 시스템', 'info', '1층 로비 시트 보호 해제 암호: 오늘 날짜 4자리 (월일)'),
      ] },
    ],
    enter: [P('서버실', 'info', '카드키를 대자 서버실 문이 열렸다.\n윙― 서버 소리. 덥다. 벽에 보안 관리 PC가 보인다.')],
    hints: [
      { until: 'r2_login', steps: [
        '보안 관리 PC는 "보안 서버 시리얼 끝 4자리"를 원해요. 시트를 줄여서 랙을 보세요. 혼자 빨간 불이 깜빡이는 곳이 있어요.',
        '[찾기](Ctrl+F)로 "보안"을 찾으면 3번 랙에 보안 서버가 나와요. 시리얼 SN-77K1-4093 → PC의 [잠김] 셀을 선택하고 4093 입력 후 Enter',
      ] },
      { until: 'r2_autofit', steps: [
        '해제 코드는 벽 클립보드에 있어요. 그런데 코드 칸이 전부 ####이죠?',
        '코드 열 머리글(열 문자)의 오른쪽 경계선을 잡고 오른쪽으로 끌어 넓히세요. 경계선 더블클릭이나 [열 너비 자동 맞춤]도 돼요.',
      ] },
      { until: 'r2_release', steps: [
        '오늘은 11월 7일. 11/07 줄의 코드를 PC에 입력하세요.',
        'PC의 "경비 모드 해제" [잠김] 셀을 선택하고 6142 입력 후 Enter',
      ] },
      { until: 'room3', steps: [
        '로비 시트 암호는 오늘 날짜 4자리예요.',
        '"3. 1층 로비" 탭을 클릭하고 1107 을 입력하세요.',
      ] },
    ],
  },
  {
    name: '3. 1층 로비', password: '1107', ...R3, art: room3Art, tables: room3Tables, hotspots: room3Hotspots,
    hiddenRows: [],
    locks: [{ id: 'gate', answer: GATE_CODE, title: '출입 게이트', onOpen: ENDING }],
    enter: [P('1층 로비', 'info', '엘리베이터가 움직였다! 1층 로비.\n출입 게이트만 지나면 퇴근이다. 그런데 게이트에도 비밀번호가…')],
    hints: [
      { until: 'r3_sort', steps: [
        '경비실 근무표의 비고 칸에 단어가 한 줄씩 흩어져 있어요. 날짜 순서대로 놓으면 문장이 돼요.',
        '근무표 날짜 열의 셀을 선택하고 [정렬 및 필터] → 오름차순.',
      ] },
      { until: 'r3_cf', steps: [
        '바닥 타일에는 큰 숫자(70 이상)와 작은 숫자(30 이하)가 섞여 있어요. 숫자 크기를 색으로 구분해 보면?',
        '바닥 타일 표의 셀을 선택 → [조건부 서식] → 색조. 그다음 시트를 줄여서 바닥을 보세요.',
      ] },
      { until: 'r3_gate', steps: [
        '바닥에 나타난 숫자 4개가 게이트 비밀번호예요.',
        `게이트의 [잠김] 셀을 선택하고 ${GATE_CODE} 입력 후 Enter`,
      ] },
    ],
  },
]

