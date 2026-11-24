/** 워크숍 조난기 1화 「버스는 10시에 떠난다」 — PPT 방탈출 데이터 */

export const EP_TITLE = '워크숍 조난기 「버스는 10시에 떠난다」'
export const FILE_NAME = '2026_하반기_워크숍_일정표.pptx'
export const SW = 880 // 슬라이드 크기
export const SH = 495
export const START_MIN = 40 // 9:40 시작
export const LIMIT_MS = 20 * 60 * 1000 // 10:00 버스 출발 (제한 20분)
export const WRONG_BUS_MS = 2 * 60 * 1000 // 다른 버스에 타면 2분 손해

export type Icon = 'warn' | 'info' | 'error' | 'ok'
export interface StoryPage { title: string; icon: Icon; text: string }
const P = (title: string, icon: Icon, text: string): StoryPage => ({ title, icon, text })

export type ObjKind = 'shape' | 'picture' | 'text'
export interface ObjDef {
  id: string
  name: string
  x: number; y: number; w: number; h: number
  kind: ObjKind
  /** viewBox 0 0 w h 기준 SVG. 채우기 대상은 fill="var(--f)" */
  svg: string
  fill?: string // 기본 채우기 색 (도형만)
  grad?: Grad // 기본 그라데이션
  hud?: string // 그림 위에 겹치는 글자 (밝기 영향 없음)
  cctv?: boolean // 밝기 단계가 특별한 그림
  lock?: string // 클릭하면 비밀번호 입력
  tip?: string // 마우스를 올리면 뜨는 설명
  t?: number // 처음 투명도 (0~100)
  movable?: boolean // 끌어서 옮길 수 있음 (스티커만)
  say?: string // 클릭하면 한 줄 메모
  crop?: [number, number, number, number] // 처음에 잘려서 보이는 영역 (x, y, w, h)
  fh?: boolean // 처음부터 좌우 대칭 (거울에 비친 그림)
}
export type Grad = 'none' | 'lr' | 'rl' | 'tb'

export interface SlideDef {
  id: string
  section: 0 | 1 | 2
  bg: string // 배경 SVG (880×495)
  objs: ObjDef[]
  notes?: string
}

export const SECTIONS = ['숙소', '로비', '리조트 정문']

/* ───────── 스티커 두 장 (겹친 부분 = 27) ───────── */
export const STK = { c: 7, w: 16, h: 9, pad: 10 } // 점 간격 7, 16×9칸, 테두리 여백 10
export const STK_W = STK.w * STK.c + STK.pad * 2
export const STK_H = STK.h * STK.c + STK.pad * 2
const key = (c: number, r: number) => c * 100 + r
export const STK_D = new Set<number>()
for (let c = 2; c <= 6; c++) [1, 4, 7].forEach((r) => STK_D.add(key(c, r)))
for (let r = 1; r <= 4; r++) STK_D.add(key(6, r))
for (let r = 4; r <= 7; r++) STK_D.add(key(2, r))
for (let c = 9; c <= 13; c++) STK_D.add(key(c, 1))
for (let r = 1; r <= 7; r++) STK_D.add(key(13, r))
let seed = 7
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const blk = new Map<number, boolean>()
for (let bx = 0; bx < STK.w; bx += 2) for (let by = 0; by < STK.h; by += 2) blk.set(key(bx, by), rnd() < 0.5)
export const STK_A = new Set(STK_D)
export const STK_B = new Set(STK_D)
for (let c = 0; c < STK.w; c++) for (let r = 0; r < STK.h; r++) {
  const k = key(c, r)
  if (STK_D.has(k)) continue
  if ((c === 0 || c === STK.w - 1) && (r === 0 || r === STK.h - 1)) continue
  let v = blk.get(key(c - (c % 2), r - (r % 2)))!
  if (rnd() < 0.18) v = !v
  ;(v ? STK_A : STK_B).add(k)
}
/** 참가상 스티커: 흰 바탕·둥근 테두리·라벨 + 점 무늬 (색 = var(--f)) */
export function stickerSvg(cells: Set<number>) {
  let dots = ''
  cells.forEach((k) => {
    const c = Math.floor(k / 100), r = k % 100
    dots += `<circle cx="${STK.pad + c * STK.c + STK.c / 2}" cy="${STK.pad + r * STK.c + STK.c / 2}" r="${STK.c * 0.42}" fill="var(--f)"/>`
  })
  return `<rect x="3" y="4" width="${STK_W - 2}" height="${STK_H - 2}" rx="12" fill="rgba(0,0,0,.16)"/><rect x="1.5" y="1.5" width="${STK_W - 3}" height="${STK_H - 3}" rx="12" fill="#fff" stroke="var(--f)" stroke-width="3"/>
<rect x="6" y="6" width="${STK_W - 12}" height="${STK_H - 12}" rx="8" fill="none" stroke="var(--f)" stroke-width="1" stroke-dasharray="4 3" opacity=".6"/>${dots}
<rect x="8" y="-7" width="40" height="14" rx="7" fill="var(--f)"/><text x="28" y="3.5" font-size="9" font-weight="800" fill="#fff" text-anchor="middle">참가상</text>`
}

/* ───────── 로비 CCTV ───────── */
function cctvScene() {
  let lk = ''
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
    const n = r * 4 + c + 1, x = 40 + c * 58, y = 50 + r * 56
    lk += n === 7
      ? `<rect x="${x}" y="${y}" width="54" height="52" fill="#20231f"/><rect x="${x - 20}" y="${y}" width="20" height="52" fill="#6e756b" stroke="#4d534a"/>`
      : `<rect x="${x}" y="${y}" width="54" height="52" fill="#6e756b" stroke="#4d534a"/><rect x="${x + 40}" y="${y + 22}" width="8" height="10" fill="#4d534a"/>`
    lk += `<text x="${x + 8}" y="${y + 16}" font-size="12" font-weight="700" fill="#b7bdb1">${String(n).padStart(2, '0')}</text>`
  }
  return `<svg viewBox="0 0 420 236" preserveAspectRatio="none" width="100%" height="100%"><rect width="420" height="236" fill="#b9bdb4"/><rect y="200" width="420" height="36" fill="#9a9e95"/>
<rect x="30" y="40" width="250" height="180" fill="#8f948b"/>${lk}
<rect x="300" y="70" width="100" height="70" fill="#a7aba2" stroke="#8f948b"/><text x="350" y="110" font-size="11" fill="#666" text-anchor="middle">짐 보관 안내</text>
<g fill="#8b8f86"><circle cx="246" cy="98" r="13"/><path d="M233 92 q13 -14 26 0 v-6 q-13 -12 -26 0z" fill="#3b3e39"/>
<path d="M230 114 q16 -6 32 0 l6 60 h-44z" fill="#5d7aa0"/><path d="M232 120 l-30 6 l2 8 l32 -4z" fill="#5d7aa0"/><circle cx="202" cy="130" r="5" fill="#c9a98c"/>
<rect x="228" y="174" width="12" height="44" fill="#3b4250"/><rect x="246" y="174" width="12" height="44" fill="#3b4250"/>
<rect x="224" y="216" width="18" height="6" rx="2" fill="#222"/><rect x="244" y="216" width="18" height="6" rx="2" fill="#222"/></g>
<g><rect x="172" y="146" width="40" height="58" rx="6" fill="#9c4650"/><rect x="178" y="152" width="28" height="46" rx="3" fill="none" stroke="#7e3640" stroke-width="2"/>
<rect x="188" y="126" width="4" height="20" fill="#888"/><rect x="196" y="126" width="4" height="20" fill="#888"/><rect x="186" y="122" width="16" height="5" rx="2" fill="#666"/>
<circle cx="178" cy="206" r="4" fill="#222"/><circle cx="206" cy="206" r="4" fill="#222"/></g></svg>`
}
const CCTV_HUD = `<svg viewBox="0 0 420 236" preserveAspectRatio="none" width="100%" height="100%"><text x="10" y="18" font-size="11" fill="#e33" font-family="monospace">● REC</text><text x="60" y="18" font-size="11" fill="#ddd" font-family="monospace">CAM 02  LOBBY-LOCKER</text><text x="410" y="18" font-size="11" fill="#ddd" font-family="monospace" text-anchor="end">2026-11-06 03:12:40</text>
<defs><pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="2" fill="#000"/></pattern></defs><rect width="420" height="236" fill="url(#scan)" opacity=".22"/></svg>`
/** CCTV 밝기 단계별 실제 밝기 (기본이 아주 어둡다) */
export const CCTV_LV: Record<number, number> = { [-40]: 0.04, [-20]: 0.07, 0: 0.1, 20: 0.24, 40: 0.95 }

function monstera() {
  const cx = 110, base = 150 // 로컬 좌표 (물체 220×240)
  const leaves = [[-70, -40, -60], [70, -35, 55], [-55, -85, -35], [55, -90, 35], [-20, -120, -12], [25, -125, 15], [0, -75, 5], [-85, -5, -75], [88, -8, 70], [-35, -45, -25], [38, -50, 25]]
  let s = ''
  for (const [dx, dy] of leaves) s += `<path d="M${cx} ${base + 4} Q${cx + dx * 0.3} ${base + dy * 0.5} ${cx + dx} ${base + dy}" stroke="#3d6b3a" stroke-width="4" fill="none"/>`
  for (const [dx, dy, rot] of leaves) {
    s += `<g transform="translate(${cx + dx} ${base + dy}) rotate(${rot})"><ellipse rx="42" ry="29" fill="#3f8a4a" stroke="#2f6e3a" stroke-width="1.5"/><line x1="-38" y1="0" x2="38" y2="0" stroke="#2f6e3a" stroke-width="1.5"/>`
    for (const k of [-22, -8, 6, 20]) s += `<path d="M${k} -29 L${k + 4} -10" stroke="#efe6d8" stroke-width="3"/><path d="M${k} 29 L${k + 4} 10" stroke="#efe6d8" stroke-width="3"/>`
    s += '</g>'
  }
  s += `<path d="M${cx - 58} ${base} h116 l-14 ${240 - base} h-88 z" fill="#d9cdb8" stroke="#bfae94" stroke-width="2"/><rect x="${cx - 62}" y="${base - 8}" width="124" height="12" rx="3" fill="#cbbda5"/>`
  return s
}

const lockers: ObjDef[] = Array.from({ length: 12 }, (_, i) => {
  const r = Math.floor(i / 4), c = i % 4, n = String(i + 1).padStart(2, '0')
  return {
    id: `L${n}`, name: `보관함 ${n}`, x: 650 + c * 46, y: 170 + r * 50, w: 42, h: 46, kind: 'shape', fill: '#9aa4ae', lock: `locker:${n}`,
    svg: `<rect width="42" height="46" fill="var(--f)" stroke="#7d8790"/><text x="7" y="16" font-size="10" font-weight="700" fill="#fff">${n}</text><rect x="28" y="22" width="9" height="12" rx="1" fill="#3a3f48"/>`,
  }
})

/* ───────── 정문 ───────── */
/** 정문 앞 버스 3대 (왼쪽부터). 우리 버스 = 왼쪽, 번호판 1207 */
export const BUS_PLATES = ['38라 1207', '38라 1027', '83라 1207'] // 왼쪽부터. 일부러 헷갈리게
export const OUR_BUS = 1
function busRear(n: number) {
  return `<rect x="0" y="0" width="160" height="140" rx="14" fill="#f4f4f4" stroke="#999" stroke-width="2"/><rect x="14" y="12" width="132" height="50" rx="6" fill="#3d4654"/>
<text x="80" y="88" font-size="15" font-weight="800" fill="#2f6f8f" text-anchor="middle">○○관광</text>
<rect x="8" y="96" width="16" height="24" rx="3" fill="#d33"/><rect x="136" y="96" width="16" height="24" rx="3" fill="#d33"/>
<rect x="52" y="102" width="56" height="20" rx="2" fill="#8a7a60"/><path d="M54 106 q10 8 22 2 t26 6 v8 h-48z" fill="#6f6249"/>
<circle cx="30" cy="140" r="14" fill="#222"/><circle cx="130" cy="140" r="14" fill="#222"/><text x="80" y="40" font-size="10" fill="#9fb0c4" text-anchor="middle">${n === 0 ? '' : ''}</text>`
}
function busFront(x: number, plate: string, ours: boolean) {
  return `<g transform="translate(${x} 0)"><rect width="66" height="62" rx="7" fill="#f4f4f4" stroke="#888"/><rect x="5" y="5" width="56" height="24" rx="3" fill="#3d4654"/>
${ours ? '<rect x="10" y="9" width="46" height="11" fill="#fff"/><text x="33" y="17.5" font-size="6.5" font-weight="700" fill="#c43e1c" text-anchor="middle">△△회사 워크숍</text>' : ''}
<rect x="9" y="44" width="48" height="12" fill="#fff" stroke="#555" stroke-width=".8"/><text x="33" y="53" font-size="8" font-weight="700" fill="#222" text-anchor="middle">${plate}</text>
<circle cx="9" cy="36" r="3.5" fill="#ffe28a"/><circle cx="57" cy="36" r="3.5" fill="#ffe28a"/></g>`
}
/** 버스 바로 뒤 유리창에 비친 그 버스의 앞모습 (그림은 정상 방향, 처음엔 좌우 대칭으로 보임) */
function paneSvg(i: number) {
  // 유리창 안쪽(128×94)에 비친 그 버스의 앞모습. 처음엔 아주 흐리고 좌우가 뒤집혀 보인다
  return `<rect width="128" height="94" fill="#dfeaf2"/><g transform="translate(31 18)">${busFront(0, BUS_PLATES[i], false)}</g>
<path d="M0 0 h26 l-26 44z M74 0 h20 l-58 94 h-20z" fill="#fff" opacity=".45"/>`
}
/** 어제 단체 사진 (전체 600×340). 처음엔 얼굴만 보이게 잘려 있음 */
const PHOTO_SVG = (() => {
  let people = ''
  for (let i = 0; i < 9; i++) {
    const x = 175 + i * 30, y = 118 + (i % 2) * 10
    people += `<circle cx="${x}" cy="${y}" r="12" fill="#f0c7a0"/><path d="M${x - 12} ${y - 4} q12 -16 24 0 v-5 q-12 -12 -24 0z" fill="#3b2a20"/><path d="M${x - 15} ${y + 40} q15 -32 30 0z" fill="${['#2f6f8f', '#c43e1c', '#3f8a4a', '#8a5fb0', '#e0a800'][i % 5]}"/>`
  }
  return `<rect width="600" height="340" fill="#bfe0f2"/><rect y="250" width="600" height="90" fill="#9c9c9c"/>
<rect x="20" y="60" width="140" height="190" fill="#e3d6c0"/><rect x="40" y="90" width="40" height="40" fill="#cfe4f2"/><rect x="100" y="90" width="40" height="40" fill="#cfe4f2"/><text x="90" y="80" font-size="12" font-weight="700" fill="#8a6d4b" text-anchor="middle">○○ RESORT</text>
<rect x="165" y="68" width="280" height="24" fill="#fff" stroke="#c43e1c" stroke-width="2"/><text x="305" y="85" font-size="14" font-weight="800" fill="#c43e1c" text-anchor="middle">2026 하반기 워크숍 ♥</text>
${people}
<g transform="translate(462 150)"><rect width="128" height="120" rx="12" fill="#f4f4f4" stroke="#888" stroke-width="2"/><rect x="10" y="10" width="108" height="46" rx="5" fill="#3d4654"/><rect x="20" y="18" width="88" height="20" fill="#fff"/><text x="64" y="32" font-size="11" font-weight="700" fill="#c43e1c" text-anchor="middle">△△회사 워크숍</text>
<rect x="24" y="86" width="80" height="22" fill="#fff" stroke="#555"/><text x="64" y="102" font-size="14" font-weight="800" fill="#222" text-anchor="middle">${BUS_PLATES[0]}</text><circle cx="16" cy="70" r="6" fill="#ffe28a"/><circle cx="112" cy="70" r="6" fill="#ffe28a"/></g>`
})()

/* ───────── 슬라이드 ───────── */
export const SLIDES: SlideDef[] = [
  {
    id: 'cover', section: 0,
    bg: `<rect width="880" height="495" fill="#2f6f8f"/><rect y="380" width="880" height="115" fill="#285f7b"/>`,
    objs: [
      { id: 'c_title', name: '제목', x: 140, y: 170, w: 600, h: 70, kind: 'text', svg: `<text x="300" y="52" font-size="44" font-weight="800" fill="#fff" text-anchor="middle">2026 하반기 워크숍</text>` },
      { id: 'c_sub', name: '부제목', x: 240, y: 250, w: 400, h: 40, kind: 'text', svg: `<text x="200" y="26" font-size="18" fill="#cfe5f0" text-anchor="middle">일정표 · 총무 박○○</text>` },
      { id: 'c_date', name: '날짜', x: 300, y: 410, w: 280, h: 40, kind: 'text', svg: `<text x="140" y="26" font-size="16" fill="#cfe5f0" text-anchor="middle">11.05(목) ~ 11.06(금) · ○○리조트</text>` },
    ],
    notes: '귀가 버스는 금요일 10:00 정각 출발. 늦으면 진짜 두고 감 — 총무',
  },
  {
    id: 'room', section: 0,
    bg: `<rect width="880" height="495" fill="#efe6d8"/><rect y="345" width="880" height="150" fill="#b89b78"/>`,
    objs: [
      { id: 'window', name: '창문', x: 60, y: 50, w: 200, h: 140, kind: 'picture', svg: `<rect x="4" y="4" width="192" height="132" fill="#cfe4f2" stroke="#a88f70" stroke-width="8"/><line x1="100" y1="0" x2="100" y2="140" stroke="#a88f70" stroke-width="5"/>`, say: '창밖은 맑다. 다들 벌써 정문에 모였겠지…' },
      { id: 'bed', name: '침대', x: 40, y: 228, w: 382, h: 144, kind: 'shape', fill: '#ffffff', svg: `<rect x="1" y="22" width="380" height="120" rx="8" fill="var(--f)" stroke="#c9c1b4" stroke-width="3"/><rect x="1" y="2" width="90" height="50" rx="10" fill="#f6f2ea" stroke="#c9c1b4" stroke-width="2"/><path d="M110 32 q60 -30 120 0 q60 30 140 -10 l0 40 l-260 0 z" fill="#e8e0f2"/>` },
      { id: 'laptop', name: '노트북', x: 300, y: 340, w: 160, h: 50, kind: 'picture', svg: `<rect x="10" y="0" width="140" height="40" fill="#3a3f48"/><rect x="0" y="40" width="160" height="10" fill="#333"/>`, say: '총무 노트북. 워크숍 일정표 파일이 열려 있다.' },
      { id: 'stand', name: '협탁', x: 440, y: 276, w: 110, h: 94, kind: 'shape', fill: '#a07850', svg: `<rect x="0" y="14" width="110" height="80" fill="var(--f)"/><rect x="12" y="24" width="86" height="14" fill="#8a643f"/><rect x="30" y="0" width="30" height="16" rx="3" fill="#333"/><text x="45" y="12" font-size="9" fill="#5f5" text-anchor="middle">09:40</text>` },
      { id: 'safe', name: '객실 금고', x: 610, y: 190, w: 150, h: 150, kind: 'shape', fill: '#565b63', lock: 'safe', svg: `<rect width="150" height="150" fill="var(--f)"/><rect x="12" y="12" width="126" height="126" fill="#6c727b"/><circle cx="90" cy="75" r="22" fill="#4a4f56" stroke="#999" stroke-width="3"/><rect x="26" y="24" width="40" height="22" fill="#1d2b1d"/><text x="46" y="40" font-size="12" fill="#6f6" text-anchor="middle">- - - -</text>` },
      { id: 'shelf', name: '선반', x: 590, y: 340, w: 190, h: 20, kind: 'shape', fill: '#7a5a3a', svg: `<rect width="190" height="20" fill="var(--f)"/>` },
      { id: 'stkA', name: '참가상 스티커 1', x: 120, y: 392, w: STK_W, h: STK_H, kind: 'shape', fill: '#f2b400', movable: true, svg: stickerSvg(STK_A), tip: '어젯밤 레크리에이션에서 받은 참가상 스티커. 바닥에 떨어져 있다' },
      { id: 'stkB', name: '참가상 스티커 2', x: 616, y: 392, w: STK_W, h: STK_H, kind: 'shape', fill: '#ff7a45', movable: true, svg: stickerSvg(STK_B), tip: '참가상 스티커가 하나 더? 무늬가 다르다' },
    ],
    notes: '[어젯밤의 나] 금고 비번 까먹을까 봐 적어둠 ㅋㅋ\n앞자리 = 퀴즈 내 점수 / 뒷자리 = 참가상 스티커 두 장, 겹친 부분만 남기면 나옴',
  },
  {
    id: 'quiz', section: 0,
    bg: `<rect width="880" height="495" fill="#fff"/><rect width="880" height="70" fill="#2f6f8f"/>`,
    objs: [
      { id: 'q_title', name: '제목', x: 30, y: 12, w: 820, h: 50, kind: 'text', svg: `<text x="10" y="34" font-size="26" font-weight="700" fill="#fff">어젯밤 레크리에이션 — 스피드 퀴즈 결과</text>` },
      { id: 'q_board', name: '점수표', x: 190, y: 120, w: 500, h: 230, kind: 'text', svg: `<g font-size="20" fill="#333"><text x="10" y="40">1위　3조 · 이○○</text><text x="330" y="40">52점</text><text x="10" y="95">2위　2조 · 나</text><text x="330" y="95">38점</text><text x="10" y="150">3위　1조 · 최○○</text><text x="330" y="150">31점</text><text x="10" y="205">4위　4조 · 정○○</text><text x="330" y="205">12점</text></g>` },
      { id: 'cover', name: '가림막', x: 170, y: 110, w: 540, h: 250, kind: 'shape', fill: '#f2c94c', svg: `<rect width="540" height="250" rx="10" fill="var(--f)"/><text x="270" y="140" font-size="30" font-weight="800" fill="#7a5a00" text-anchor="middle">결과는 아침에 공개!</text>` },
      { id: 'q_prize', name: '상품 안내', x: 240, y: 400, w: 400, h: 30, kind: 'text', svg: `<text x="200" y="20" font-size="15" fill="#888" text-anchor="middle">상품: 1위 커피 쿠폰 · 꼴찌 설거지 · 참가상 스티커</text>` },
    ],
    notes: '꼴찌 4조는 오늘 아침 설거지 당번 ㅋㅋ',
  },
  {
    id: 'lobby', section: 1,
    bg: `<rect width="880" height="495" fill="#efe6d8"/>${Array.from({ length: 20 }, (_, i) => `<rect x="${i * 44}" y="0" width="44" height="330" fill="${i % 2 ? '#e9dfcf' : '#efe6d8'}"/>`).join('')}<rect y="330" width="880" height="165" fill="#d8ccb6"/>${Array.from({ length: 13 }, (_, i) => `<line x1="${i * 80}" y1="330" x2="${i * 80 - 60}" y2="495" stroke="#c9bca3"/>`).join('')}
<text x="300" y="60" font-size="22" font-weight="800" fill="#8a6d4b" text-anchor="middle" letter-spacing="6">○○ RESORT</text>${[180, 420].map((x) => `<line x1="${x}" y1="0" x2="${x}" y2="40" stroke="#555"/><path d="M${x - 14} 54 h28 l-6 -14 h-16z" fill="#f2d48a"/>`).join('')}<text x="742" y="160" font-size="11" fill="#666" text-anchor="middle">짐 보관함</text>`,
    objs: [
      { id: 'frame', name: '액자', x: 250, y: 110, w: 110, h: 78, kind: 'picture', svg: `<rect width="110" height="78" fill="#8a6d4b"/><rect x="8" y="8" width="94" height="62" fill="#c7d9e6"/><path d="M8 70 l30 -34 l22 22 l14 -12 l28 24z" fill="#7da37a"/>` },
      { id: 'clock', name: '벽시계', x: 160, y: 125, w: 72, h: 72, kind: 'picture', svg: `<circle cx="36" cy="36" r="31" fill="#fff" stroke="#6b5a45" stroke-width="5"/>${Array.from({ length: 12 }, (_, k) => { const a = (k / 12) * Math.PI * 2; return `<line x1="${36 + 26 * Math.sin(a)}" y1="${36 - 26 * Math.cos(a)}" x2="${36 + 22 * Math.sin(a)}" y2="${36 - 22 * Math.cos(a)}" stroke="#555" stroke-width="2"/>` }).join('')}<line x1="36" y1="36" x2="${36 + 14 * Math.sin((1.75 / 12) * Math.PI * 2)}" y2="${36 - 14 * Math.cos((1.75 / 12) * Math.PI * 2)}" stroke="#222" stroke-width="4" stroke-linecap="round"/><line x1="36" y1="36" x2="${36 + 22 * Math.sin((45 / 60) * Math.PI * 2)}" y2="${36 - 22 * Math.cos((45 / 60) * Math.PI * 2)}" stroke="#222" stroke-width="2.5" stroke-linecap="round"/><circle cx="36" cy="36" r="3" fill="#c43e1c"/>`, say: '시계가 멈춰 있다. 1시 45분…' },
      { id: 'plant', name: '몬스테라 화분', x: 86, y: 90, w: 220, h: 240, kind: 'picture', svg: monstera() },
      { id: 'desk', name: '프런트 데스크', x: 240, y: 250, w: 260, h: 110, kind: 'shape', fill: '#8b6b4a', svg: `<rect width="260" height="20" rx="3" fill="#ece6dc" stroke="#cfc6b8"/><rect x="10" y="20" width="240" height="90" fill="var(--f)"/>${Array.from({ length: 6 }, (_, i) => `<rect x="${18 + i * 40}" y="30" width="34" height="70" fill="#7a5c3e"/>`).join('')}<text x="130" y="70" font-size="14" fill="#f3e6cf" text-anchor="middle" font-weight="700">FRONT</text>` },
      { id: 'bell', name: '호출 벨', x: 450, y: 234, w: 20, h: 18, kind: 'picture', svg: `<circle cx="10" cy="10" r="8" fill="#d8b23a"/><rect x="2" y="14" width="16" height="3" fill="#b8962a"/>`, say: '띵! …아무도 안 나온다.' },
      { id: 'cctv', name: 'CCTV 화면', x: 380, y: 70, w: 230, h: 140, kind: 'picture', cctv: true, svg: cctvScene(), hud: CCTV_HUD },
      ...lockers,
      { id: 'sofa', name: '소파', x: 530, y: 340, w: 120, h: 64, kind: 'shape', fill: '#6d7f8f', svg: `<rect y="20" width="120" height="44" rx="10" fill="var(--f)"/><rect width="120" height="26" rx="8" fill="#7e90a0"/>` },
    ],
  },
  {
    id: 'rooms', section: 1,
    bg: `<rect width="880" height="495" fill="#fff"/><rect width="880" height="70" fill="#2f6f8f"/>`,
    objs: [
      { id: 'r_title', name: '제목', x: 30, y: 12, w: 820, h: 50, kind: 'text', svg: `<text x="10" y="34" font-size="26" font-weight="700" fill="#fff">방 배정표 (12층)</text>` },
      { id: 'r_table', name: '표', x: 120, y: 110, w: 640, h: 260, kind: 'text', svg: `<g font-size="18" fill="#333">${[['호실', '1조', '2조'], ['1205호', '박○○ (총무)', '정○○'], ['1206호', '이○○', '최○○ 팀장'], ['1207호', '나', '최대리'], ['1208호', '김○○', '윤○○']].map((r, i) => `<rect x="0" y="${i * 52}" width="640" height="52" fill="${i === 0 ? '#e1edf3' : i % 2 ? '#fff' : '#f7f9fa'}" stroke="#d5dde2"/>${r.map((t, j) => `<text x="${20 + j * 210}" y="${i * 52 + 33}" font-weight="${i === 0 ? 700 : 400}">${t}</text>`).join('')}`).join('')}</g>` },
      { id: 'r_note', name: '안내', x: 120, y: 400, w: 640, h: 30, kind: 'text', svg: `<text x="0" y="20" font-size="14" fill="#888">※ 엘리베이터는 객실 카드키를 찍어야 움직여요. 짐은 로비 보관함 이용</text>` },
    ],
  },
  {
    id: 'gate', section: 2,
    bg: `<rect width="880" height="495" fill="#bfe0f2"/><circle cx="820" cy="50" r="26" fill="#fff4c2"/><rect x="60" y="20" width="760" height="300" fill="#e3d6c0"/><rect x="60" y="20" width="760" height="40" fill="#cdbd9f"/><text x="440" y="48" font-size="20" font-weight="800" fill="#8a6d4b" text-anchor="middle" letter-spacing="6">○○ RESORT · 정문</text><rect x="90" y="80" width="40" height="240" fill="#cdbd9f"/><rect x="750" y="80" width="40" height="240" fill="#cdbd9f"/>${[0, 1, 2].map((i) => `<rect x="${160 + i * 210}" y="92" width="140" height="106" fill="#7b8794"/><rect x="${166 + i * 210}" y="98" width="128" height="94" fill="#dfeaf2"/><path d="M${166 + i * 210} 98 h26 l-26 44z M${240 + i * 210} 98 h20 l-58 94 h-20z" fill="#fff" opacity=".45"/>`).join('')}<rect y="320" width="880" height="175" fill="#9c9c9c"/><rect y="320" width="880" height="10" fill="#b5b5b5"/>${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${40 + i * 125}" y="455" width="60" height="6" fill="#eee"/>`).join('')}`,
    objs: [
      ...[0, 1, 2].map((i): ObjDef => ({ id: `pane${i + 1}`, name: '유리창에 비친 모습', x: 166 + i * 210, y: 98, w: 128, h: 94, kind: 'picture', fh: true, t: 85, svg: paneSvg(i) })),
      ...[0, 1, 2].map((i): ObjDef => ({ id: `bus${i + 1}`, name: '관광버스', x: 150 + i * 210, y: 250, w: 160, h: 156, kind: 'picture', lock: `bus:${i + 1}`, svg: busRear(i) })),
    ],
    notes: '귀가 버스 10:00 정문 앞 출발. 다른 회사랑 같은 관광사 버스라 헷갈림 주의!! — 총무',
  },
  {
    id: 'photo', section: 2,
    bg: `<rect width="880" height="495" fill="#fff"/><rect width="880" height="70" fill="#2f6f8f"/>`,
    objs: [
      { id: 'p_title', name: '제목', x: 30, y: 12, w: 820, h: 50, kind: 'text', svg: `<text x="10" y="34" font-size="26" font-weight="700" fill="#fff">어제 단체 사진 📸</text>` },
      { id: 'photo', name: '단체 사진', x: 140, y: 100, w: 600, h: 340, kind: 'picture', crop: [150, 50, 300, 160], svg: PHOTO_SVG },
    ],
    notes: '사진이 너무 커서 얼굴만 나오게 잘라둠 ㅋㅋ — 총무',
  },
]

export const slideIndex = (id: string) => SLIDES.findIndex((s) => s.id === id)
export const ALL_OBJS: Record<string, ObjDef & { slide: string }> = {}
SLIDES.forEach((s) => s.objs.forEach((o) => { ALL_OBJS[o.id] = { ...o, slide: s.id } }))

/* ───────── 이야기 ───────── */
export const INTRO: StoryPage[] = [
  P('화면 보호기 해제', 'info', '오전 9:40. 노트북 화면이 켜졌다.\n여긴… 워크숍 리조트 1207호?'),
  P('기억', 'error', '방이 텅 비었다. 같은 방 최대리 짐도, 내 휴대폰도 없다.\n어젯밤 레크리에이션 이후 기억이 없다.\n금고에 뭔가 넣은 것 같기도…?'),
  P('문 앞 쪽지', 'info', '"10시 정각 버스 출발!! 안 오면 진짜 두고 감 — 총무 박○○"'),
  P('엘리베이터', 'warn', '이 리조트 엘리베이터는 카드키를 찍어야 움직인다.\n카드키도 없다.'),
  P('워크숍 일정표.pptx', 'info', '총무가 두고 간 노트북에 일정표 파일이 열려 있다.\n어젯밤 기록이 다 여기 있을지도.'),
  P('플레이 방법', 'info', '· PPT 기능이 퍼즐 도구예요\n· 물건을 클릭하면 선택돼요. 여러 개는 드래그로 둘러싸거나 Ctrl+클릭\n· 화면 아래 [슬라이드 노트]도 꼭 읽어 보세요\n· 잠긴 물건은 클릭해서 비밀번호를 입력해요\n· 얻은 물건은 오른쪽 [내 소지품]에 모여요\n· 막히면 [힌트]'),
  P('버스 출발까지 20:00', 'warn', '10시 전에 버스에 타면 성공!\n늦어도 끝까지 할 수는 있어요.\n[확인]을 누르면 시계가 가요.'),
]
export const SAFE_OPEN: StoryPage[] = [
  P('객실 금고', 'ok', '삑- 금고가 열렸다!\n휴대폰과 카드키(1207호)가 들어 있다. 어제의 나, 칭찬해.'),
  P('엘리베이터', 'info', '카드키를 찍자 엘리베이터가 움직인다.\n로비로 내려가자.'),
]
export const LOBBY_ENTER: StoryPage[] = [P('로비', 'warn', '로비 도착. 그런데 내 캐리어가 없다.\n단체방을 보니 총무가 맡겨놨다는데…')]
export const LOCKER_OPEN: StoryPage[] = [P('짐 보관함', 'ok', '07번 보관함이 열렸다. 빨간 캐리어 회수!\n이제 정문으로!')]
export const GATE_ENTER: StoryPage[] = [P('리조트 정문', 'warn', '정문 앞에 똑같이 생긴 관광버스 3대가 정문을 보고 서 있다.\n나한테는 뒷모습만 보여서 번호판이 안 보인다. 어느 게 우리 버스지?')]
export const END_SAFE: StoryPage[] = [
  P('탑승', 'ok', '치익- 버스 문이 열린다.\n총무: "살아 있었네? 맨 뒤 자리 맡아놨다 빨리 타"'),
  P('출발', 'ok', '번호판 38라 1207, 맨 뒷자리에 무사히 탑승!\n최대리: "어제 기억 나?" … 아니.'),
]
export const END_LATE: StoryPage[] = [
  P('출발', 'error', '그 자리에 있던 버스가 막 출발했다…\n번호판 38라 1207이 멀어진다.'),
  P('지각', 'error', '총무: "택시 타고 와… 택시비는 네가 내"'),
]
export const WRONG_BUS: StoryPage[] = [P('다른 버스', 'error', '기사님: "△△회사요? 여긴 다른 회사 단체인데…"\n머쓱하게 내리느라 2분을 날렸다. (시계 +2분)')]

/* 단체방 */
export interface ChatMsg { at: number; from: string; text: string } // at = 9시 몇 분
export const CHAT: ChatMsg[] = [
  { at: 20, from: '총무', text: '다들 10시까지 정문 앞!! 늦으면 두고 감' },
  { at: 21, from: '총무', text: '1207호 캐리어 보관함에 넣어둠 ㅋㅋ 어제 쓰러져서 내가 맡김' },
  { at: 21, from: '총무', text: '몇 번인진 기억 안 남. 비번은 프런트 시계 보면 앎 ㅋㅋ' },
  { at: 22, from: '총무', text: '어제 단체 사진 일정표 마지막 장에 넣어둠 ㅋㅋ 우리 버스도 같이 찍힘' },
  { at: 50, from: '총무', text: '야 어디야?? 버스 10시 출발이다' },
  { at: 60, from: '총무', text: '출발한다… 택시 타고 와' },
]

/* 힌트: 방마다 아직 안 푼 첫 단계를 보여준다 */
/** 방마다 퍼즐 2개. 마지막 단계에 비밀번호 입력·버스 고르기까지 */
export const HINTS: { section: number; until: string; label: string; sub: string; slide: string; steps: string[] }[][] = [
  [
    { section: 0, until: 'quiz', label: '퀴즈 점수', sub: '금고 앞자리', slide: 'quiz', steps: ['숙소 슬라이드(2번)를 연 채로 화면 아래 [슬라이드 노트]를 읽어 보세요. 금고 비밀번호 앞자리는 퀴즈 내 점수래요.', '퀴즈 점수는 3번 슬라이드 "어젯밤 레크리에이션"에 있는데 노란 가림막에 가려져 있어요. 가림막이 비쳐 보이게 하려면?', '가림막 선택 → [투명도] 50% 이상 → 점수판이 비쳐서 2조 "나"의 점수 38점이 보여요. 노트에서 이게 금고 비밀번호의 어느 자리였는지 떠올려 보세요.'] },
    { section: 0, until: 'sticker', label: '참가상 스티커', sub: '금고 뒷자리', slide: 'room', steps: ['숙소 슬라이드 노트: "뒷자리 = 참가상 스티커 두 장, 겹친 부분만 남기면 나옴". 바닥에 떨어진 스티커 두 장을 찾아보세요.', '스티커는 끌어서 옮길 수 있어요. 한 장을 다른 한 장 위로 가져가면 딱 맞게 붙어요. 그다음 겹친 부분만 남기는 기능은?', '겹친 스티커 클릭(두 장 다 선택됨) → [도형 병합] → 교차 → 겹친 부분에 27이 남아요. 노트에서 이게 금고 비밀번호의 어느 자리였는지 떠올려 보세요.'] },
  ],
  [
    { section: 1, until: 'cctv', label: 'CCTV 화면', sub: '보관함 번호', slide: 'lobby', steps: ['단체방을 보면 총무가 캐리어를 로비 짐 보관함에 넣었대요. 몇 번인지는 프런트 뒤 CCTV 화면에 찍혔을 텐데 너무 어두워요.', 'CCTV 화면을 사진 보정하듯이 밝게 할 수 있어요.', 'CCTV 화면 선택 → [밝기/대비] → 밝기 +40% → 07번 보관함'] },
    { section: 1, until: 'clock', label: '프런트 시계', sub: '보관함 비밀번호', slide: 'lobby', steps: ['단체방: "비번은 프런트 시계 보면 앎". 그런데 시계가 몬스테라 화분에 가려져 있어요.', '화분을 시계보다 뒤로 보낼 수 있을까요?', '화분 선택 → [맨 뒤로] → 화분 뒤에 가려져 있던 시계가 보여요. 바늘이 가리키는 시각을 잘 보세요.'] },
  ],
  [
    { section: 2, until: 'photo', label: '단체 사진', sub: '우리 버스 번호판', slide: 'photo', steps: ['단체방: 어제 단체 사진을 일정표 마지막 장(7번 슬라이드)에 넣어놨고 우리 버스도 같이 찍혔대요. 그런데 사진이 얼굴만 나오게 잘려 있어요.', '잘린 사진을 원래대로 되돌릴 수 있을까요?', '사진 선택 → [자르기] → 자르기 원래대로 → 뒤에 찍힌 우리 버스 번호판 38라 1207'] },
    { section: 2, until: 'mirror', label: '유리창에 비친 버스', sub: '어느 버스인지', slide: 'gate', steps: ['정문 앞 버스는 뒷모습이라 번호판이 안 보여요. 버스 바로 뒤 유리창에 앞모습이 비치는데, 너무 투명해서 흐릿해요.', '비친 모습을 진하게(투명도를 낮게) 하고, 유리에 비친 글자는 좌우가 뒤집혀 있다는 걸 기억하세요. 번호판이 서로 비슷하니 꼼꼼히! (잘못 타면 2분 손해)', '유리창 셋을 드래그로 둘러싸서 선택 → [투명도] 0% → [회전] → 좌우 대칭 → 번호판이 똑바로 보여요. 단체 사진 속 우리 버스 번호판과 같은 유리창을 찾고, 그 바로 앞 버스를 타세요.'] },
  ],
]

/** 마우스를 올리면 뜨는 설명 (개체에 tip 이 없으면 여기서) */
export const TIPS: Record<string, string> = {
  c_title: '총무가 밤새 만든 워크숍 일정표 표지', c_sub: '총무 박○○… 일 잘한다', c_date: '1박 2일. 벌써 둘째 날 아침이다',
  window: '창밖이 너무 밝다. 늦잠 잤다…', bed: '어젯밤 쓰러져 잠든 침대. 기억이 없다', laptop: '총무가 두고 간 노트북. 일정표 파일이 열려 있다',
  stand: '협탁 위 시계 9:40… 망했다', safe: '객실 금고. 어젯밤 뭔가 넣은 것 같은데…', shelf: '금고 받침 선반',
  stkM: '겹친 부분만 남은 참가상 스티커',
  q_title: '어젯밤 레크리에이션 결과 슬라이드', q_board: '스피드 퀴즈 점수표', cover: '"결과는 아침에 공개!" 가림막. 아래에 점수가 있을 텐데', q_prize: '상품 목록. 꼴찌는 설거지 ㅋㅋ',
  frame: '로비 액자. 산 풍경 사진', clock: '프런트 벽시계', plant: '커다란 몬스테라 화분. 뒤에 뭐가 있나?', desk: '프런트 데스크. 직원이 아무도 없다',
  bell: '호출 벨', cctv: '짐 보관함 쪽 CCTV 녹화 화면. 너무 어두워서 잘 안 보인다', sofa: '로비 소파. 누워서 더 자고 싶다',
  r_title: '방 배정표', r_table: '1207호: 나, 최대리', r_note: '엘리베이터·짐 보관 안내',
  pane1: '유리창에 바로 앞 버스가 비친다. 그런데 너무 투명해서 잘 안 보인다', pane2: '유리창에 바로 앞 버스가 비친다. 그런데 너무 투명해서 잘 안 보인다', pane3: '유리창에 바로 앞 버스가 비친다. 그런데 너무 투명해서 잘 안 보인다', bus1: '관광버스 뒷모습. 번호판이 흙탕물에 가렸다', bus2: '관광버스 뒷모습. 번호판이 흙탕물에 가렸다', bus3: '관광버스 뒷모습. 번호판이 흙탕물에 가렸다',
  p_title: '어제 단체 사진 슬라이드', photo: '어제 찍은 단체 사진. 얼굴만 나오게 잘려 있다',
}
for (let i = 1; i <= 12; i++) { const n = String(i).padStart(2, '0'); TIPS[`L${n}`] = `짐 보관함 ${n}번` }
