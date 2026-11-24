/** 잠금 화면 사진·영수증 그림 (SVG 문자열) */

const dog = (x: number, y: number, s: number) => `<g transform="translate(${x} ${y}) scale(${s})">
  <ellipse cx="0" cy="22" rx="30" ry="22" fill="#f2e3c9"/><circle cx="0" cy="-6" r="20" fill="#f4e7d0"/>
  <ellipse cx="-17" cy="-12" rx="7" ry="13" fill="#c9a77a"/><ellipse cx="17" cy="-12" rx="7" ry="13" fill="#c9a77a"/>
  <circle cx="-7" cy="-7" r="2.6" fill="#2a2420"/><circle cx="7" cy="-7" r="2.6" fill="#2a2420"/><ellipse cx="0" cy="1" rx="4" ry="3" fill="#2a2420"/>
  <path d="M-4 6 q4 4 8 0" stroke="#2a2420" stroke-width="1.5" fill="none"/></g>`

const kid = (x: number, y: number, s: number, shirt: string, hair: string) => `<g transform="translate(${x} ${y}) scale(${s})">
  <path d="M-20 60 q0 -34 20 -34 q20 0 20 34z" fill="${shirt}"/><circle cx="0" cy="8" r="16" fill="#f0c7a0"/><path d="M-16 6 q16 -22 32 0 v-6 q-16 -14 -32 0z" fill="${hair}"/>
  <circle cx="-5" cy="9" r="1.6" fill="#333"/><circle cx="5" cy="9" r="1.6" fill="#333"/><path d="M-4 15 q4 3 8 0" stroke="#333" stroke-width="1.3" fill="none"/></g>`

/* ───────── 사진 ───────── */
export const dogPhoto = () => `<svg viewBox="0 0 300 260" width="300" height="260"><rect width="300" height="260" fill="#c9b48a"/><rect x="18" y="18" width="264" height="190" fill="#9cc0e6"/>
<rect x="18" y="160" width="264" height="48" fill="#e8d8b8"/><path d="M200 168 l10 -40 l10 40z" fill="#f2c94c"/><rect x="190" y="168" width="40" height="30" rx="4" fill="#fff"/><text x="210" y="190" font-size="14" text-anchor="middle" fill="#c0392b">1</text>
${dog(120, 120, 2.6)}<path d="M82 150 q38 22 76 0" stroke="#c0392b" stroke-width="7" fill="none"/><circle cx="120" cy="172" r="17" fill="#f2c94c" stroke="#b8901c" stroke-width="2"/><text x="120" y="176" font-size="11" font-weight="800" text-anchor="middle" fill="#5a4400" font-family="sans-serif">KONG</text><path d="M100 60 l18 -26 l18 26z" fill="#e55" /><circle cx="118" cy="34" r="5" fill="#ffd"/>
<text x="150" y="238" fill="#5a4630" font-size="18" text-anchor="middle" font-family="sans-serif">우리집 막내 콩이 ♥</text></svg>`
export const familyPhoto = () => `<svg viewBox="0 0 320 240" width="320" height="240"><rect width="320" height="240" fill="#2d2a26"/><rect x="14" y="14" width="292" height="212" fill="#9cc6e0"/>
<rect x="14" y="150" width="292" height="76" fill="#e2c890"/><circle cx="260" cy="50" r="20" fill="#fff3c0"/>
${kid(80, 100, 2, '#3a5f9a', '#2a2018')}${kid(140, 110, 1.8, '#c0392b', '#2a2018')}${kid(200, 128, 1.25, '#f2a65e', '#3a2a20')}${kid(250, 140, 1.05, '#6aa86a', '#3a2a20')}
<text x="160" y="216" fill="#5a4630" font-size="15" text-anchor="middle" font-family="sans-serif">2019 여름 · 제주</text></svg>`
/** 11월 탁상 달력 */
/** 영수증 (호텔: 진짜 증거 / 상품권: 카드 번호 인쇄 불량 / 명품관: 흔들림) */
export function receiptSvg(kind: 'r1' | 'r2' | 'r3') {
  const L = kind === 'r2'
    ? ['○○호텔 강남', '서울 강남구 테헤란로 ○○', '사업자 211-8*-*****', '------------------------------', '일시  2026-11-03 14:12', '객실  1204 (DAYUSE)', '금액  1,280,000원', '------------------------------', '카드  ****-****-****-7730', '승인  30417712', '할부  일시불', '', '서명', '------------------------------', '이용해 주셔서 감사합니다']
    : kind === 'r1'
      ? ['상품권나라 강남점', '서울 강남구 역삼동 ○○', '------------------------------', '일시  2026-10-06 10:10', '품목  백화점 상품권 50만×10', '금액  5,000,000원', '------------------------------', '카드  ****-****-****-▒▒▒▒', '승인  2210▒▒▒▒', '', '(인쇄 상태 불량)', '------------------------------']
      : ['○○백화점 명품관', '------------------------------', '일시  2026-11-03 21:40', '금액  3,400,000원', '카드  ****-****-****-????', '서명', '------------------------------']
  const h = 40 + L.length * 22 + 40
  const blur = kind === 'r3' ? 'filter="url(#rb)"' : ''
  return `<svg viewBox="0 0 300 ${h}" width="300" height="${h}"><defs><filter id="rb"><feGaussianBlur stdDeviation="2.4"/></filter></defs>
<rect width="300" height="${h}" fill="#f7f5ef"/><g ${blur} font-family="'Courier New', monospace" font-size="13" fill="#333">
${L.map((t, i) => `<text x="20" y="${46 + i * 22}" ${i === 0 ? 'font-size="17" font-weight="700"' : ''}>${t}</text>`).join('')}
${kind !== 'r1' ? `<path d="M70 ${46 + (L.indexOf('서명') + 1) * 22 - 6} c20 -24 30 20 50 -6 s30 -20 40 6 s20 10 40 -10" stroke="#1d3a8a" stroke-width="2" fill="none"/>` : ''}</g>
<rect width="300" height="${h}" fill="none" stroke="#ddd"/></svg>`
}

export const photoSvg = (id: string) => {
  if (id === 'p_kong') return dogPhoto()
  if (id === 'p_family') return familyPhoto()
  if (id === 't_kong') return `<svg viewBox="0 0 300 260" width="300" height="260"><defs><filter id="kb"><feGaussianBlur stdDeviation="7"/></filter></defs><rect width="300" height="260" fill="#9cc0e6"/><g filter="url(#kb)">${dog(150, 130, 3)}</g></svg>`
  return `<svg viewBox="0 0 300 220" width="300" height="220"><rect width="300" height="220" fill="#8fd18a"/><rect width="300" height="90" fill="#bfe3ff"/><circle cx="210" cy="120" r="22" fill="#2a5a2a"/><rect x="208" y="70" width="3" height="50" fill="#fff"/><path d="M211 70 l20 8 l-20 8z" fill="#e33"/><circle cx="120" cy="160" r="5" fill="#fff"/><text x="150" y="206" font-size="14" text-anchor="middle" fill="#234" font-family="sans-serif">홀인원인 줄 알았던 공 (2m 남음)</text></svg>`
}

/** 생일 케이크 사진 */
export const cakePhoto = (text: string, n: number, stamp = '') => `<svg viewBox="0 0 300 260" width="300" height="260"><rect width="300" height="260" fill="#3a2a40"/>
<circle cx="150" cy="120" r="120" fill="#ffcf8a" opacity=".18"/>
<ellipse cx="150" cy="200" rx="110" ry="18" fill="#e9e1d2"/><rect x="70" y="130" width="160" height="70" rx="8" fill="#f7e0e8"/><rect x="70" y="130" width="160" height="20" rx="8" fill="#fff"/>
${[0, 1].map((i) => `<rect x="${125 + i * 26}" y="92" width="8" height="38" fill="#8fc0f0"/><path d="M${129 + i * 26} 78 q6 8 0 14 q-6 -6 0 -14z" fill="#ffd166"/>`).join('')}
<text x="150" y="182" font-size="15" text-anchor="middle" fill="#b04a6a" font-family="sans-serif" font-weight="700">${text}</text>
<text x="150" y="50" font-size="22" text-anchor="middle" fill="#ffd166" font-family="sans-serif" font-weight="800">${n}번째 생일</text>
${stamp ? `<text x="288" y="250" font-size="15" text-anchor="end" fill="#ff8a2a" font-family="'Courier New', monospace" font-weight="700" opacity=".95">${stamp}</text>` : ''}</svg>`

/**
 * 잠금 화면 배경: 공원 가족사진 (엄마가 찍어서 화면에 없음)
 * 장식용 배경 (숫자 단서 없음)
 */
export function parkPhoto() {
  const W = 1280, H = 800
  const adult = (x: number, y: number) => `<g transform="translate(${x} ${y})">
    <path d="M-62 250 q0 -150 62 -150 q62 0 62 150z" fill="#2f4f7f"/><path d="M-20 110 L0 140 L20 110z" fill="#f2f5fa"/>
    <rect x="-46" y="250" width="34" height="150" fill="#3a3f4b"/><rect x="12" y="250" width="34" height="150" fill="#3a3f4b"/>
    <circle cx="0" cy="62" r="40" fill="#e7b894"/><circle cx="-14" cy="62" r="3.5" fill="#2a2420"/><circle cx="14" cy="62" r="3.5" fill="#2a2420"/>
    <path d="M-26 56 h18 M8 56 h18 M-8 58 h16" stroke="#333" stroke-width="3" fill="none"/><path d="M-10 82 q10 8 20 0" stroke="#7a3a2a" stroke-width="3" fill="none"/>
    <path d="M-42 50 q42 -52 84 0 z" fill="#f4f4f0"/><path d="M-44 50 h106 q-8 12 -30 10 h-76z" fill="#e6e6e0"/>
    <circle cx="0" cy="34" r="7" fill="#1f4f9a"/>
    <path d="M58 170 q30 30 20 70" stroke="#e7b894" stroke-width="18" fill="none" stroke-linecap="round"/></g>`
  const child = (x: number, y: number, s: number, shirt: string, hair: string) => `<g transform="translate(${x} ${y}) scale(${s})">
    <path d="M-40 170 q0 -100 40 -100 q40 0 40 100z" fill="${shirt}"/>
    <rect x="-30" y="170" width="24" height="90" fill="#3a4a6a"/><rect x="6" y="170" width="24" height="90" fill="#3a4a6a"/>
    <circle cx="0" cy="38" r="30" fill="#f0c7a0"/><path d="M-30 34 q30 -44 60 0 v-10 q-30 -30 -60 0z" fill="${hair}"/>
    <circle cx="-10" cy="40" r="3" fill="#333"/><circle cx="10" cy="40" r="3" fill="#333"/><path d="M-8 52 q8 6 16 0" stroke="#333" stroke-width="2.5" fill="none"/></g>`
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="pkSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ec5f0"/><stop offset="1" stop-color="#d9efff"/></linearGradient>
<linearGradient id="pkGrass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8cc66a"/><stop offset="1" stop-color="#5c9a44"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#pkSky)"/>
<circle cx="1080" cy="120" r="56" fill="#fff6c8"/>
${[[160, 380, 90], [380, 360, 70], [980, 370, 100], [1180, 390, 80]].map(([x, y, r]) => `<rect x="${x - 10}" y="${y}" width="20" height="120" fill="#7a5a3a"/><circle cx="${x}" cy="${y - 20}" r="${r}" fill="#4f8f4a"/><circle cx="${x + r * .4}" cy="${y - r * .4}" r="${r * .6}" fill="#5ea657"/>`).join('')}
<rect y="460" width="${W}" height="${H - 460}" fill="url(#pkGrass)"/>
<path d="M0 640 q640 -60 1280 0 v160 h-1280z" fill="#e8d6a8" opacity=".7"/>
<!-- 함정: 공원 시계 -->
<rect x="1088" y="250" width="10" height="250" fill="#555"/><circle cx="1093" cy="240" r="34" fill="#fff" stroke="#555" stroke-width="6"/>
<path d="M1093 240 L1093 216 M1093 240 L1110 248" stroke="#222" stroke-width="4" stroke-linecap="round"/>
<!-- 함정: 벤치 번호판 -->
<g transform="translate(70 500)"><rect width="220" height="16" fill="#8a5a3a"/><rect y="30" width="220" height="16" fill="#8a5a3a"/><rect x="10" y="46" width="12" height="60" fill="#555"/><rect x="198" y="46" width="12" height="60" fill="#555"/>
<rect x="84" y="2" width="52" height="22" rx="2" fill="#d8d8d0" stroke="#777"/><text x="110" y="18" font-size="14" text-anchor="middle" fill="#333" font-family="monospace">1204</text></g>
<!-- 함정: 주차된 차 -->
<g transform="translate(1000 470)"><path d="M0 60 q10 -50 70 -56 h120 q50 4 80 56 v40 h-270z" fill="#c8ccd4"/><rect x="40" y="16" width="70" height="34" rx="4" fill="#9ec3e6"/><rect x="128" y="16" width="70" height="34" rx="4" fill="#9ec3e6"/>
<circle cx="56" cy="100" r="22" fill="#222"/><circle cx="214" cy="100" r="22" fill="#222"/><rect x="100" y="78" width="80" height="20" rx="2" fill="#fff" stroke="#333"/><text x="140" y="93" font-size="13" text-anchor="middle" fill="#111" font-family="sans-serif">52누 9180</text></g>
<!-- 가족 (왼쪽부터 서연 · 아빠 · 민준 · 콩이) -->
${child(430, 420, 1.0, '#f39bb6', '#3a2a20')}
<path d="M462 520 Q470 380 480 300" stroke="#888" stroke-width="2" fill="none"/>
<path d="M484 300 c-24 -30 -50 -6 -36 16 l36 34 l36 -34 c14 -22 -12 -46 -36 -16z" fill="#f27a9b" stroke="#d45578" stroke-width="3"/>
${adult(600, 300)}
${child(800, 380, 1.25, '#d33b3b', '#2a2018')}
${dog(960, 640, 2.2)}
<path d="M928 642 q32 18 64 0" stroke="#c0392b" stroke-width="6" fill="none"/>
<g transform="translate(960 668) rotate(-8)"><circle r="13" fill="#d8dde4" stroke="#8a919e" stroke-width="2"/></g>
<text x="${W - 24}" y="${H - 20}" font-size="14" text-anchor="end" fill="rgba(255,255,255,.85)" font-family="sans-serif">📷 2026 봄 · 한강공원 (엄마가 찍음)</text>
</svg>`
}
