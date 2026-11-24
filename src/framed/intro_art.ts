// @ts-nocheck
/* eslint-disable */
// 인트로·엔딩 장면 그림 (실루엣·조명). 시안 intro4 를 옮김
export interface Ov { html: string; x: number; y: number; extra: string }
/* ───────── 공통 재료 ───────── */
const lg = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;
const rg = (id, stops, cx = .5, cy = .5, r = .5) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`;
const DEFS = `<defs>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .07 0"/></filter>
  <filter id="blur4"><feGaussianBlur stdDeviation="4"/></filter>
  <filter id="blur10"><feGaussianBlur stdDeviation="10"/></filter>
  <filter id="blur24"><feGaussianBlur stdDeviation="24"/></filter>
  ${rg('vig', [[.55, '#000', 0], [1, '#000', .55]], .5, .5, .75)}
  ${rg('screenglow', [[0, '#cfe0ff', .55], [.45, '#7aa6ff', .18], [1, '#7aa6ff', 0]])}
  ${rg('warm', [[0, '#ffe2b0', .6], [1, '#ffb070', 0]])}
  ${rg('redglow', [[0, '#ff7a6b', .55], [1, '#ff3b30', 0]])}
  ${rg('lampglow', [[0, '#fff1c9', .7], [1, '#ffd98a', 0]])}
</defs>`;
const finish = `<rect width="960" height="540" fill="url(#vig)"/><rect width="960" height="540" filter="url(#grain)" opacity=".9"/>`;
const blinds = (x, y, w, h, gap, col, op = 1, th = 5) => Array.from({ length: Math.ceil(h / gap) }, (_, i) => `<rect x="${x}" y="${y + i * gap}" width="${w}" height="${th}" fill="${col}" opacity="${op}"/>`).join('');

// 옆모습 (오른쪽을 봄). (x,y) = 정수리, s = 크기
const profile = (x, y, s, fill, rim) => `<g transform="translate(${x} ${y}) scale(${s})">
  <path d="M2 0 C34 -2 56 18 58 46 C59 54 63 60 70 68 C66 72 62 72 60 74 C62 80 60 84 56 86 C58 92 54 98 48 100 C44 108 36 112 28 113 L26 132 C64 138 104 152 118 196 L-76 196 C-70 154 -44 136 -16 130 L-14 112 C-34 102 -44 82 -44 54 C-44 22 -26 2 2 0 Z" fill="${fill}"/>
  ${rim ? `<path d="M58 46 C59 54 63 60 70 68 C66 72 62 72 60 74 C62 80 60 84 56 86 C58 92 54 98 48 100 C44 108 36 112 28 113" stroke="${rim}" stroke-width="3" fill="none" opacity=".9"/>` : ''}</g>`;
// 뒷모습 (앉은 상반신)
const backView = (x, y, s, fill, rim) => `<g transform="translate(${x} ${y}) scale(${s})">
  <path d="M-38 -8 C-40 -48 -20 -70 0 -70 C22 -70 40 -48 38 -8 C36 6 26 16 14 20 L14 34 C56 40 92 58 100 110 L-100 110 C-92 58 -56 40 -14 34 L-14 20 C-28 16 -36 6 -38 -8 Z" fill="${fill}"/>
  ${rim ? `<path d="M38 -8 C40 -48 22 -70 0 -70" stroke="${rim}" stroke-width="3" fill="none"/><path d="M14 34 C56 40 92 58 100 110" stroke="${rim}" stroke-width="3" fill="none" opacity=".7"/>` : ''}</g>`;
// 정면 상반신 (얼굴 안 보이게 역광)
const front = (x, y, s, fill) => `<g transform="translate(${x} ${y}) scale(${s})">
  <path d="M-34 -40 C-36 -78 -18 -96 0 -96 C18 -96 36 -78 34 -40 C33 -22 24 -10 14 -6 L14 8 C60 14 100 34 108 90 L-108 90 C-100 34 -60 14 -14 8 L-14 -6 C-24 -10 -33 -22 -34 -40 Z" fill="${fill}"/></g>`;

/* ── 인물: 나(짧은 머리·셔츠·사원증) / 사수(웨이브 머리·가디건) / 팀장(넘긴 머리·안경·정장) ── */
const HEAD = "M2 0 C34 -2 56 18 58 46 C59 54 63 60 70 68 C66 72 62 72 60 74 C62 80 60 84 56 86 C58 92 54 98 48 100 C44 108 36 112 28 113 L26 132 L-14 130 L-14 112 C-34 102 -44 82 -44 54 C-44 22 -26 2 2 0 Z";
const HAIR = {
  me: "M-46 58 C-48 18 -26 -6 4 -4 C34 -6 58 14 60 40 C46 30 26 26 12 32 C2 38 -6 52 -8 70 C-20 74 -40 76 -46 58 Z",
  sasu: "M-56 70 C-66 30 -40 -14 6 -10 C40 -12 66 12 64 44 C52 34 40 34 30 40 C34 30 22 26 12 32 C0 40 -6 60 -4 90 C-16 100 -40 100 -50 92 C-58 86 -60 80 -56 70 Z",
  boss: "M-44 60 C-46 20 -24 -2 6 -2 C30 -2 52 10 58 32 C42 24 24 22 10 28 C2 32 -4 44 -6 64 C-18 70 -38 72 -44 60 Z",
};
const BODY = {
  me: { col: '#2c3a55', collar: '#e9eef6', extra: (r) => `<path d="M-4 132 L10 196 M30 134 L18 196" stroke="#3a6fd1" stroke-width="5"/><rect x="2" y="182" width="26" height="16" rx="2" fill="#f2f5fa"/>` },
  sasu: { col: '#6b5643', collar: '#cdbba3', extra: () => `${Array.from({length:6},(_,i)=>`<path d="M${-60+i*30} 160 l8 30" stroke="#5a4636" stroke-width="3"/>`).join('')}` },
  boss: { col: '#1f2533', collar: '#e9eef6', extra: () => `<path d="M8 134 L18 150 L10 196 L0 150 Z" fill="#7a2230"/>` },
};
function person(who, x, y, s, { flip = false, skin = '#b88a6c', light = '#ffd9b0', rim = null, dark = .55 } = {}) {
  const b = BODY[who], gid = 'fs' + who + Math.round(x) + Math.round(y);
  const glasses = who === 'boss' ? `<path d="M36 46 h22 M40 46 v8 h14 v-8" stroke="#dfe8ff" stroke-width="2.5" fill="none" opacity=".9"/><path d="M36 48 L-2 52" stroke="#1a1f2b" stroke-width="2.5"/>` : '';
  return `<g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="${dark}"/><stop offset=".6" stop-color="#000" stop-opacity="${dark * .35}"/><stop offset="1" stop-color="${light}" stop-opacity=".25"/></linearGradient></defs>
    <path d="M-14 128 C-46 134 -72 152 -78 196 L122 196 C116 152 88 136 28 130 Z" fill="${b.col}"/>
    <path d="M-14 128 L6 150 L28 130 L18 124 L6 136 L-6 124 Z" fill="${b.collar}"/>
    ${b.extra()}
    <path d="${HEAD}" fill="${skin}"/><path d="${HEAD}" fill="url(#${gid})"/>
    <ellipse cx="-8" cy="62" rx="7" ry="11" fill="${skin}"/><ellipse cx="-8" cy="62" rx="7" ry="11" fill="#000" opacity=".3"/>
    <path d="${HAIR[who]}" fill="${who === 'sasu' ? '#2a2018' : '#15151c'}"/>
    ${who === 'boss' ? `<path d="M-30 14 C-10 -2 20 -4 44 10" stroke="#9aa6c0" stroke-width="2" fill="none" opacity=".5"/>` : ''}
    ${glasses}
    ${rim ? `<path d="M58 46 C59 54 63 60 70 68 C66 72 62 72 60 74 C62 80 60 84 56 86 C58 92 54 98 48 100 C44 108 36 112 28 113" stroke="${rim}" stroke-width="3" fill="none"/><path d="M60 40 C56 16 36 -4 4 -4" stroke="${rim}" stroke-width="2.5" fill="none" opacity=".8"/>` : ''}
  </g>`;
}
/* 뒤통수 + 어깨 (뒤에서 본 모습) */
function backOf(who, x, y, s, rim) {
  const b = BODY[who];
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <path d="M-100 110 C-92 58 -56 40 -14 34 L14 34 C56 40 92 58 100 110 Z" fill="${b.col}"/>
    <path d="M-16 30 L16 30 L14 44 L-14 44 Z" fill="#a07a60"/><path d="M-22 36 L0 46 L22 36 L22 42 L0 52 L-22 42 Z" fill="${b.collar}"/>
    ${who === 'me' ? `<path d="M-30 40 C-20 60 20 60 30 40" stroke="#3a6fd1" stroke-width="5" fill="none"/>` : ''}
    <ellipse cx="0" cy="-14" rx="40" ry="46" fill="${who === 'sasu' ? '#2a2018' : '#15151c'}"/>
    <ellipse cx="-40" cy="-6" rx="6" ry="11" fill="#4a3a32"/><ellipse cx="40" cy="-6" rx="6" ry="11" fill="#4a3a32"/>
    ${rim ? `<path d="M40 -14 C40 -44 22 -60 0 -60" stroke="${rim}" stroke-width="3" fill="none"/><path d="M14 34 C56 40 92 58 100 110" stroke="${rim}" stroke-width="3" fill="none" opacity=".7"/>` : ''}
  </g>`;
}
const monitor = (x, y, w, h, frame, screen) => `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${frame}"/><rect x="${x + 7}" y="${y + 7}" width="${w - 14}" height="${h - 20}" rx="2" fill="${screen}"/>
  <path d="M${x + w / 2 - 14} ${y + h} h28 l8 30 h-44 Z" fill="${frame}"/><rect x="${x + w / 2 - 50}" y="${y + h + 28}" width="100" height="7" rx="3" fill="${frame}"/></g>`;
const cup = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})">
  <path d="M0 0 L46 0 L40 64 L6 64 Z" fill="#f4efe6"/><path d="M3 22 L43 22 L41 44 L5 44 Z" fill="#9b6b44"/>
  <rect x="-3" y="-8" width="52" height="10" rx="3" fill="#ece5d8"/><rect x="2" y="-12" width="42" height="6" rx="3" fill="#d9d0c0"/>
  <path d="M0 0 L46 0 L44 20 L2 20 Z" fill="#fff" opacity=".35"/></g>`;
const steam = (x, y) => `<g stroke="#fff" stroke-opacity=".5" stroke-width="3" fill="none" stroke-linecap="round" filter="url(#blur4)"><path d="M${x} ${y} q-10 -18 0 -34 q10 -16 0 -32"/><path d="M${x + 16} ${y + 2} q-8 -14 0 -28 q8 -14 0 -26"/></g>`;
const plant = (x, y, s, col) => `<g transform="translate(${x} ${y}) scale(${s})" fill="${col}"><path d="M-18 0 L18 0 L14 34 L-14 34 Z"/>${[[-30,-60,-6],[-10,-90,0],[14,-70,6],[30,-48,10],[-36,-30,-10]].map(([dx,dy])=>`<path d="M0 0 Q${dx/2} ${dy/2} ${dx} ${dy} Q${dx/2+6} ${dy/2+4} 0 0" />`).join('')}</g>`;
const chair = (x, y, s, col) => `<g transform="translate(${x} ${y}) scale(${s})" fill="${col}"><path d="M-40 -110 Q0 -124 40 -110 L36 -20 Q0 -10 -36 -20 Z"/><rect x="-44" y="-16" width="88" height="16" rx="6"/><rect x="-4" y="0" width="8" height="34"/><path d="M-40 40 L40 40 L36 34 L-36 34 Z"/></g>`;
const deskRow = (y, x0, n, w, gap, col, monCol) => Array.from({ length: n }, (_, i) => { const x = x0 + i * (w + gap); return `<rect x="${x}" y="${y}" width="${w}" height="10" fill="${col}"/><rect x="${x + w / 2 - 22}" y="${y - 34}" width="44" height="30" rx="2" fill="${monCol}"/><rect x="${x + w / 2 - 3}" y="${y - 4}" width="6" height="4" fill="${monCol}"/>`; }).join('');

export function introScene(id: string): { svg: string; ov: Ov[] } {
  const ovs: Ov[] = []
  const ov = (html: string, x: number, y: number, extra = '') => { ovs.push({ html, x, y, extra }) }
  let svg = ''
  switch (id) {
/* 1. 클로즈업: 키보드 옆으로 커피를 내려놓는 손, 오후 햇살 */
case '1':
  svg = `${lg('sky1', [[0, '#ffd89a'], [1, '#f2a65e']])}${lg('desk1', [[0, '#7a5a40'], [1, '#4a3424']])}${lg('beam1', [[0, '#fff1c9', .45], [1, '#fff1c9', 0]], 1, 1)}
    <rect width="960" height="540" fill="#6b4f3c"/>
    <rect x="-20" y="-20" width="640" height="300" fill="url(#sky1)"/>
    <g opacity=".85">${blinds(-20, -14, 640, 290, 18, '#8a6247', .6, 7)}</g>
    <rect x="610" y="-20" width="370" height="300" fill="#5a4334"/>
    ${plant(700, 210, 1.3, '#3e3226')}
    <polygon points="40,-20 300,-20 900,540 300,540" fill="url(#beam1)"/>
    <polygon points="0,300 960,250 960,540 0,540" fill="url(#desk1)"/>
    <g transform="translate(250 360) rotate(-8)"><rect width="380" height="110" rx="10" fill="#2c2420"/>${Array.from({length:4},(_,r)=>Array.from({length:13},(_,c)=>`<rect x="${14+c*27}" y="${12+r*24}" width="22" height="18" rx="3" fill="#3d332c"/>`).join('')).join('')}</g>
    <g transform="translate(600 400) rotate(-6)"><rect width="140" height="100" fill="#efe8da"/><rect x="14" y="16" width="90" height="6" fill="#b9ad98"/><rect x="14" y="32" width="110" height="5" fill="#cfc4b0"/><rect x="14" y="44" width="80" height="5" fill="#cfc4b0"/></g>
    <ellipse cx="520" cy="430" rx="90" ry="20" fill="#2a1d14" opacity=".35" filter="url(#blur10)"/>
    ${cup(490, 300, 1.55)}
    ${steam(520, 285)}
    <!-- 소매와 손 -->
    <path d="M306 246 L346 254 L332 338 L300 324 Z" fill="#c99a7c"/>
    <path d="M336 252 C380 250 430 262 470 290 C488 302 494 318 486 330 C496 336 498 350 486 356 C494 364 490 378 476 380 C478 392 466 400 452 396 C420 388 380 370 330 340 Z" fill="#c99a7c"/>
    <path d="M470 290 C488 302 494 318 486 330" stroke="#ffe0bd" stroke-width="3" fill="none" opacity=".8"/>
    <path d="M440 300 C470 296 500 300 520 316" stroke="#a87a5e" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M-40 150 C80 170 220 210 316 246 L290 326 C190 300 70 280 -40 270 Z" fill="#1f2a44"/>
    <path d="M-40 150 C80 170 220 210 316 246" stroke="#3a4a6e" stroke-width="5" fill="none" opacity=".9"/>
    <path d="M60 196 C120 214 180 232 240 254" stroke="#16203a" stroke-width="3" fill="none" opacity=".8"/>
    <rect x="250" y="268" width="10" height="8" rx="2" fill="#c9cfdb" transform="rotate(18 255 272)"/><rect x="232" y="262" width="10" height="8" rx="2" fill="#c9cfdb" transform="rotate(18 237 266)"/>
    <path d="M308 238 L344 250 L322 334 L284 322 Z" fill="#f2f5fa"/><path d="M308 238 L344 250" stroke="#ffffff" stroke-width="3"/>
    <path d="M320 290 L330 293" stroke="#c9d1df" stroke-width="2"/>
    <g transform="translate(348 296) rotate(15)">
      <rect x="-9" y="-46" width="18" height="92" rx="6" fill="#2a2420"/>
      <rect x="-9" y="-46" width="18" height="92" rx="6" fill="none" stroke="#1a1512" stroke-width="1.5"/>
      <circle r="17" fill="#c9ced8"/><circle r="17" fill="none" stroke="#8d939f" stroke-width="2.5"/>
      <circle r="13" fill="#1d2433"/>
      ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => { const a = i * Math.PI / 6; return `<line x1="${(Math.sin(a) * 11).toFixed(1)}" y1="${(-Math.cos(a) * 11).toFixed(1)}" x2="${(Math.sin(a) * 13).toFixed(1)}" y2="${(-Math.cos(a) * 13).toFixed(1)}" stroke="#e8ecf4" stroke-width="${i % 3 ? 1 : 2}"/>` }).join('')}
      <path d="M0 0 L0 -9 M0 0 L7 3" stroke="#f2f4f8" stroke-width="2" stroke-linecap="round"/><circle r="1.6" fill="#ffd166"/>
      <rect x="16" y="-3" width="4" height="6" rx="1" fill="#a9afba"/>
      <path d="M-12 -12 A17 17 0 0 1 8 -15" stroke="#fff" stroke-width="2" fill="none" opacity=".6"/>
    </g>
    ${finish}`;
  break;
/* 2. 옆모습: 노을 진 창가, 내 옆얼굴과 모니터 알림 */
case '2':
  svg = `${lg('sky2', [[0, '#2f3a6b'], [.5, '#8b4f7a'], [1, '#f19a5a']])}${lg('room2', [[0, '#2a2a40'], [1, '#1a1a2a']])}
    <rect width="960" height="540" fill="url(#room2)"/>
    <rect x="0" y="0" width="560" height="360" fill="url(#sky2)"/>
    <g fill="#2a2440">${[[0,250,70,110],[70,190,60,170],[140,230,90,130],[240,160,70,200],[320,210,80,150],[410,180,60,180],[480,240,80,120]].map(([x,y,w,h])=>`<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`).join('')}</g>
    <g fill="#ffcf7a">${Array.from({length:60},(_,i)=>`<rect x="${(i*53)%540+6}" y="${200+((i*37)%140)}" width="5" height="7" opacity="${.4+(i%3)*.2}"/>`).join('')}</g>
    <rect x="0" y="0" width="560" height="360" fill="none" stroke="#1b1a2c" stroke-width="16"/><rect x="276" y="0" width="10" height="360" fill="#1b1a2c"/>
    <rect x="0" y="360" width="960" height="180" fill="#151524"/>
    <rect x="0" y="352" width="960" height="12" fill="#2b2b44"/>
    <ellipse cx="700" cy="250" rx="320" ry="220" fill="url(#screenglow)"/>
    ${monitor(560, 110, 330, 220, '#0d0e18', '#e9eef7')}
    <rect x="574" y="124" width="302" height="18" fill="#d3dbe8"/><rect x="574" y="146" width="70" height="164" fill="#eef2f8"/>
    ${Array.from({length:6},(_,i)=>`<rect x="656" y="${158+i*22}" width="${190-(i%3)*40}" height="7" fill="#cbd3e0"/>`).join('')}
    ${person('me', 330, 196, 1.3, { rim: '#ffd6a8', light: '#cfe0ff', dark: .6 })}
    ${cup(160, 312, .7)}
    ${finish}`;
  ov(`<div class="msgr"><div class="h"><span>메신저</span><span>오후 5:50</span></div><div class="b"><small>감사팀 박○○ 팀장</small>김 대리님, 퇴근 전에 3번 회의실로 잠깐 오시죠.</div></div>`, 635, 205);
  break;
/* 3. 회의실: 테이블 건너 역광의 팀장, 미끄러져 오는 출력물 */
case '3':
  svg = `${lg('win3', [[0, '#b9cfe8'], [1, '#7f9cc4']])}${lg('wall3', [[0, '#34405a'], [1, '#262f45']])}${lg('table3', [[0, '#4a3b31'], [1, '#2a211b']])}
    <rect width="960" height="540" fill="url(#wall3)"/>
    <rect x="170" y="20" width="620" height="300" fill="url(#win3)"/>
    <g>${blinds(170, 24, 620, 296, 15, '#3a4763', .75, 6)}</g>
    <rect x="170" y="20" width="620" height="300" fill="none" stroke="#1f2638" stroke-width="12"/>
    <ellipse cx="480" cy="170" rx="330" ry="190" fill="#dbe7ff" opacity=".18" filter="url(#blur24)"/>
    ${chair(540, 372, 1.5, '#141a28')}
    ${person('boss', 540, 140, 1.25, { flip: true, rim: '#e6efff', light: '#dbe7ff', skin: '#a98068', dark: .65 })}
    <polygon points="0,350 960,350 960,540 0,540" fill="url(#table3)"/>
    <polygon points="0,350 960,350 960,358 0,358" fill="#6a5646"/>
    <!-- 깍지 낀 손 -->
    <path d="M380 352 C390 332 420 322 456 324 C470 326 480 336 482 352 Z" fill="#0e1220"/><path d="M380 352 C390 332 420 322 456 324" stroke="#e6efff" stroke-width="2" fill="none" opacity=".6"/>
    <!-- 출력물 -->
    <g transform="translate(300 400) rotate(-4)">
      <polygon points="40,0 360,0 400,140 0,140" fill="#f3f0e8"/>
      ${[0,1,2,3,4,5,6].map(i=>`<line x1="${30+i*1.5}" y1="${18+i*16}" x2="${330+i*6}" y2="${18+i*16}" stroke="#c4bdb0" stroke-width="3"/>`).join('')}
      <line x1="34" y1="50" x2="300" y2="50" stroke="#ef4b3f" stroke-width="10" opacity=".7"/>
      <line x1="38" y1="82" x2="340" y2="82" stroke="#ef4b3f" stroke-width="10" opacity=".7"/>
      <text x="44" y="14" font-size="10" fill="#555" font-family="Noto Sans KR">법인카드 사용 내역 · 김○○</text>
    </g>
    <path d="M610 386 C640 378 680 382 700 396 L690 420 C670 410 640 408 616 414 Z" fill="#0e1220"/>
    ${finish}`;
  break;
/* 4. 붉은 화면에 물든 내 옆얼굴, 벽 달력 */
case '4':
  svg = `${lg('wall4', [[0, '#3b2430'], [1, '#22151c']])}
    <rect width="960" height="540" fill="url(#wall4)"/>
    <rect x="0" y="0" width="960" height="70" fill="#2c1b24"/>${Array.from({length:4},(_,i)=>`<rect x="${60+i*240}" y="22" width="150" height="16" fill="#f5e6c8" opacity=".35"/>`).join('')}
    <rect x="0" y="380" width="960" height="160" fill="#1a1016"/>
    <!-- 파티션과 달력 -->
    <rect x="650" y="110" width="310" height="270" fill="#4a3440"/>
    <g transform="translate(700 140) rotate(2)"><rect width="200" height="200" fill="#efe8dc"/><rect width="200" height="30" fill="#b9372e"/><text x="100" y="21" fill="#fff" font-size="14" text-anchor="middle" font-family="Noto Sans KR" font-weight="700">11월</text>
      ${['월','화','수','목','금'].map((d,i)=>`<text x="${22+i*38}" y="48" fill="#776" font-size="11" text-anchor="middle" font-family="Noto Sans KR">${d}</text>`).join('')}
      ${Array.from({length:4},(_,r)=>Array.from({length:5},(_,c)=>`<rect x="${6+c*38}" y="${56+r*35}" width="34" height="31" fill="#e2d9c9"/><text x="${10+c*38}" y="${68+r*35}" fill="#776" font-size="9" font-family="Noto Sans KR">${2+r*7+c}</text>`).join('')).join('')}
      <circle cx="23" cy="107" r="21" fill="none" stroke="#e5302a" stroke-width="5"/><text x="23" y="138" fill="#c0392b" font-size="10" text-anchor="middle" font-family="Noto Sans KR" font-weight="700">징계위</text></g>
    <ellipse cx="380" cy="250" rx="360" ry="240" fill="url(#redglow)"/>
    ${monitor(200, 100, 380, 250, '#120a0e', '#fbeaea')}
    <rect x="0" y="380" width="960" height="12" fill="#2e1c24"/>
    ${person('me', 40, 150, 1.45, { rim: '#ff8a7a', light: '#ff8a7a', skin: '#a8705e', dark: .5 })}
    ${finish}`;
  ov(`<div class="mail"><div class="h">[징계위원회 소집] 법인카드 부정 사용 건</div><div class="b">수신: 김○○ 대리<br>일시: 11월 9일(월) <b style="color:#c0392b">09:00</b>, 대회의실<br>사유: 법인카드 32,000,000원 부정 사용<br><span style="color:#888">결과에 따라 고발 조치 예정 — 감사팀</span></div></div>`, 268, 130);
  break;
/* 5. 소실점 원근: 불이 하나둘 꺼지는 통로, 비어 있는 사수 자리 */
case '5':
  svg = `${lg('wall5', [[0, '#2a3048'], [1, '#1c2033']])}${lg('floor5', [[0, '#262a3c'], [1, '#14161f']])}
    <rect width="960" height="540" fill="url(#wall5)"/>
    <!-- 천장 조명 (원근) -->
    ${[0,1,2,3,4].map(k=>{const t=k/5,y=20+t*120,w=280-t*200,on=k>=3;return `<rect x="${480-w/2}" y="${y}" width="${w}" height="${10-t*6}" fill="${on?'#fff3cf':'#3a3f55'}" opacity="${on?.9:1}"/>`}).join('')}
    <polygon points="400,140 560,140 760,540 200,540" fill="url(#floor5)"/>
    <ellipse cx="480" cy="150" rx="70" ry="40" fill="#fff3cf" opacity=".3" filter="url(#blur10)"/>
    <!-- 양쪽 책상 줄 (원근) -->
    ${[0,1,2,3].map(k=>{const s=1-k*.2,y=470-k*90,xl=200-k*50*1,xr=760+k*50*1;return `<g fill="#151827"><rect x="${0+k*90}" y="${y}" width="${260*s}" height="${16*s}"/><rect x="${960-k*90-260*s}" y="${y}" width="${260*s}" height="${16*s}"/></g>
      <rect x="${60+k*90}" y="${y-70*s}" width="${90*s}" height="${60*s}" rx="3" fill="${k===0?'#cfe0ff':'#0f1220'}"/><rect x="${960-k*90-150*s}" y="${y-70*s}" width="${90*s}" height="${60*s}" rx="3" fill="#0f1220"/>`}).join('')}
    <ellipse cx="160" cy="400" rx="160" ry="110" fill="url(#screenglow)"/>
    <!-- 사수 자리: 빈 의자 + 커피잔 -->
    ${chair(740, 470, 1.05, '#0d0f19')}
    <path d="M700 340 C716 330 764 330 780 342 L784 420 C770 430 730 430 716 420 Z" fill="#1f2a44" opacity=".97"/><path d="M740 334 L734 380 L746 380 Z" fill="#c9cfdb" opacity=".6"/>
    <g transform="rotate(14 740 420)"></g>
    ${cup(820, 420, .55)}
    <rect x="690" y="460" width="270" height="14" fill="#151827"/>
    <text x="830" y="512" fill="#9aa3bd" font-size="12" font-family="Noto Sans KR" text-anchor="middle">정○○</text>
    <rect x="796" y="498" width="68" height="20" fill="none" stroke="#3a4060"/>
    ${finish}`;
  ov(`<div class="typing"><div class="h">정○○ 선배님</div><div class="b"><span class="dots3"><i></i><i></i><i></i></span><div class="t">정○○ 선배님이 입력 중…</div></div></div>`, 58, 330, 'transform:scale(.8);transform-origin:left top');
  break;
/* 6a. 위에서 내려다본 구도: 어두운 사무실 속 홀로 켜진 내 자리 */
case '6a':
  svg = `${lg('floor6', [[0, '#1d2336'], [1, '#141827']])}
    <rect width="960" height="540" fill="url(#floor6)"/>
    ${Array.from({length:3},(_,r)=>Array.from({length:4},(_,c)=>{const x=60+c*230,y=40+r*170;return `<rect x="${x}" y="${y}" width="190" height="90" rx="4" fill="#222a40"/><rect x="${x+70}" y="${y+12}" width="50" height="10" fill="#151a2a"/><circle cx="${x+95}" cy="${y+120}" r="26" fill="#181d2e"/>`}).join('')).join('')}
    <ellipse cx="520" cy="300" rx="260" ry="200" fill="url(#lampglow)" opacity=".75"/>
    <rect x="390" y="210" width="260" height="110" rx="6" fill="#4a4a5c"/>
    <rect x="460" y="222" width="120" height="12" fill="#1c1f2c"/>
    <rect x="464" y="226" width="112" height="4" fill="#cfe0ff"/>
    <rect x="430" y="270" width="100" height="34" rx="4" fill="#2a2d3c"/>
    <rect x="560" y="262" width="60" height="46" fill="#efe8da" transform="rotate(8 590 285)"/>
    <!-- 엎드린 나 (위에서) -->
    <ellipse cx="510" cy="352" rx="92" ry="56" fill="#2c3a55"/><path d="M420 330 C440 290 470 284 500 290 L520 330 Z" fill="#33425f"/><path d="M600 330 C580 292 550 284 520 290 L500 330 Z" fill="#33425f"/><path d="M470 330 C490 360 530 360 550 330" stroke="#3a6fd1" stroke-width="5" fill="none"/><circle cx="505" cy="300" r="38" fill="#15151c"/><path d="M480 288 C492 278 518 278 530 290" stroke="#3a3a48" stroke-width="3" fill="none"/>
    <path d="M478 284 C490 270 520 270 536 286" stroke="#ffe6b0" stroke-width="3" fill="none" opacity=".7"/>
    ${chair(510, 470, .9, '#0d0f18')}
    ${finish}`;
  ov(`<div class="search">🔍 업무상 횡령 처벌 수위</div>`, 432, 182, 'transform:scale(.8);transform-origin:left top');
  break;
/* 6b. 뒷모습: 고개를 든 나, 어두운 사무실 건너 불 켜진 감사팀 유리방 */
case '6b':
  svg = `${lg('wall6', [[0, '#1f2840'], [1, '#161c2e']])}${lg('glass6', [[0, '#fff2cc'], [1, '#f2d08a']])}
    <rect width="960" height="540" fill="url(#wall6)"/>
    <!-- 멀리 감사팀 유리방 -->
    <rect x="380" y="120" width="420" height="170" fill="url(#glass6)" opacity=".92"/>
    ${[0,1,2,3,4,5].map(i=>`<rect x="${380+i*84}" y="120" width="5" height="170" fill="#8a7a5a"/>`).join('')}
    <rect x="380" y="120" width="420" height="170" fill="none" stroke="#5a5040" stroke-width="6"/>
    <text x="590" y="110" fill="#d9c79a" font-size="14" text-anchor="middle" font-family="Noto Sans KR" letter-spacing="3">감사팀</text>
    <ellipse cx="590" cy="220" rx="320" ry="140" fill="#ffe2a0" opacity=".2" filter="url(#blur24)"/>
    ${[[450,290,.42],[560,292,.4],[700,290,.42]].map(([x,y,s])=>backView(x,y,s,'#3a3328')).join('')}
    <polygon points="380,290 800,290 980,540 200,540" fill="#ffe2a0" opacity=".06"/>
    <!-- 중간 책상 줄 -->
    ${deskRow(330, 0, 6, 150, 18, '#121626', '#0f1220')}
    <rect x="0" y="330" width="960" height="210" fill="#10131f" opacity=".5"/>
    <!-- 내 뒷모습 + 내 모니터 -->
    <ellipse cx="200" cy="380" rx="160" ry="110" fill="url(#screenglow)" opacity=".6"/>
    ${monitor(110, 310, 170, 110, '#0b0d16', '#9fb6e0')}
    ${backOf('me', 300, 470, 1.35, '#ffe2a0')}
    <rect x="0" y="470" width="960" height="70" fill="#0b0d16"/>
    ${finish}`;
  break;
/* 7. 파티션 뒤에 숨은 나(전경), 멀리 닫히는 엘리베이터 */
case '7':
  svg = `${lg('wall7', [[0, '#1c2438'], [1, '#141a2a']])}${lg('elev7', [[0, '#ffe8b8'], [1, '#f3c77a']])}
    <rect width="960" height="540" fill="url(#wall7)"/>
    <!-- 멀리 엘리베이터 -->
    <rect x="560" y="90" width="230" height="250" fill="#2a3044"/>
    <rect x="610" y="110" width="130" height="230" fill="url(#elev7)"/>
    <rect x="600" y="110" width="36" height="230" fill="#3a4258"/><rect x="714" y="110" width="36" height="230" fill="#3a4258"/>
    ${backView(660, 300, .5, '#2b2418')}${front(700, 300, .45, '#2b2418')}
    <rect x="640" y="70" width="70" height="18" rx="2" fill="#0c0f18"/><text x="675" y="84" fill="#ffcf6b" font-size="12" text-anchor="middle" font-family="Noto Sans KR">▼ 1F</text>
    <polygon points="636,340 714,340 860,540 480,540" fill="#ffe8b8" opacity=".12"/>
    <ellipse cx="675" cy="230" rx="200" ry="150" fill="#ffe2a0" opacity=".15" filter="url(#blur24)"/>
    <!-- 꺼진 감사팀 유리방 -->
    <rect x="60" y="120" width="420" height="160" fill="#1f283c"/>${[0,1,2,3,4].map(i=>`<rect x="${60+i*84}" y="120" width="4" height="160" fill="#141a28"/>`).join('')}
    <text x="270" y="110" fill="#5d6888" font-size="13" text-anchor="middle" font-family="Noto Sans KR" letter-spacing="3">감사팀</text>
    <!-- 전경: 파티션과 숨은 나 -->
    <rect x="0" y="380" width="960" height="160" fill="#0d111c"/>
    ${person('me', 200, 290, 1.2, { rim: '#ffe2a0', light: '#ffe2a0', skin: '#8f6a55', dark: .7 })}
    <rect x="0" y="395" width="620" height="145" fill="#1a2030"/><rect x="0" y="390" width="620" height="10" fill="#2a3246"/>
    ${finish}`;
  break;
/* 8. 어깨 너머: 감사팀장 책상, 02:30 잠금 화면, 강아지 액자, 포스트잇 */
/* 엔딩: 해 뜨는 창가, 뒷모습 */
case 'e-good':
  svg = `${lg('skyG', [[0, '#3d5a8a'], [.55, '#f2a76b'], [1, '#ffe0a8']])}${lg('roomG', [[0, '#2a2f44'], [1, '#1b1f2e']])}
    <rect width="960" height="540" fill="url(#roomG)"/>
    <rect x="80" y="40" width="800" height="330" fill="url(#skyG)"/>
    <circle cx="640" cy="330" r="70" fill="#fff1c9" opacity=".95"/><circle cx="640" cy="330" r="160" fill="#ffe2a0" opacity=".25" filter="url(#blur24)"/>
    <g fill="#2a2a40">${[[80,250,90,120],[170,200,70,170],[240,260,110,110],[350,180,80,190],[430,240,100,130],[530,210,70,160],[600,280,120,90],[720,220,90,150],[810,260,70,110]].map(([x,y,w,h])=>`<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`).join('')}</g>
    <rect x="80" y="40" width="800" height="330" fill="none" stroke="#1b1f2e" stroke-width="18"/><rect x="474" y="40" width="12" height="330" fill="#1b1f2e"/>
    <polygon points="80,370 880,370 960,540 0,540" fill="#ffd9a0" opacity=".08"/>
    <rect x="0" y="370" width="960" height="170" fill="#151824"/>
    ${backOf('me', 470, 470, 1.6, '#ffd6a0')}
    <rect x="0" y="480" width="960" height="60" fill="#0d0f18"/>
    ${finish}`;
  break;
case 'e-mid': return introScene('6a');
case 'e-bad':
  svg = introScene('4').svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  ov(`<div class="mail"><div class="h" style="background:#2b579a">메일 · 03:00</div><div class="b">예약된 메일이 발송되었습니다.<br><b>[최종 보고] 영업2팀 김○○ 대리 법인카드 부정 사용 건</b><br><span style="color:#888">받는 사람: 본사 감사위원회</span></div></div>`, 268, 130);
  return { svg: `<svg width="960" height="540" viewBox="0 0 960 540">${svg}</svg>`, ov: ovs };
/* 엔딩: 새벽 모니터에 뜬 전송 완료 (어깨 너머) */
case 'e-sent': {
  const base = introScene('8')
  svg = base.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
  ov(`<div class="msgr" style="width:250px"><div class="h" style="background:#1e8a5a"><span>메일</span><span>오전 2:58</span></div><div class="b"><small>보낸 메일</small><b>소명서_김○○.docx</b><br>본사 감사위원회로 전송했습니다. ✔</div></div>`, 445, 150);
  return { svg: `<svg width="960" height="540" viewBox="0 0 960 540">${svg}</svg>`, ov: ovs };
}
/* 엔딩: 월요일 본사 감사 — 역광의 감사관 셋, 고개 숙인 팀장 */
case 'e-hq':
  svg = `${lg('winH', [[0, '#dfe9f6'], [1, '#a9c1e0']])}${lg('wallH', [[0, '#3a4560'], [1, '#2a3348']])}${lg('tabH', [[0, '#5a4a3e'], [1, '#2e241d']])}
    <rect width="960" height="540" fill="url(#wallH)"/>
    <rect x="60" y="30" width="840" height="290" fill="url(#winH)"/>
    <g>${blinds(60, 34, 840, 286, 16, '#4a5878', .45, 4)}</g>
    <rect x="60" y="30" width="840" height="290" fill="none" stroke="#232b3e" stroke-width="12"/>
    <ellipse cx="300" cy="170" rx="320" ry="170" fill="#ffffff" opacity=".22" filter="url(#blur24)"/>
    ${[[170, 330], [300, 322], [430, 330]].map(([x, y]) => front(x, y, .95, '#151b2a')).join('')}
    ${person('boss', 740, 180, 1.05, { flip: true, rim: '#cfe0ff', light: '#cfe0ff', skin: '#9a7462', dark: .7 }).replace('scale(-1.05 1.05)', 'scale(-1.05 1.05) rotate(14)')}
    <polygon points="0,380 960,370 960,540 0,540" fill="url(#tabH)"/><rect x="0" y="370" width="960" height="10" fill="#7a6656"/>
    ${[[150, 410], [290, 404], [430, 410]].map(([x, y]) => `<rect x="${x}" y="${y}" width="90" height="26" rx="2" fill="#efe9dc"/><text x="${x + 45}" y="${y + 17}" font-size="11" fill="#555" text-anchor="middle" font-family="Noto Sans KR">본사 감사위원</text>`).join('')}
    <g transform="translate(600 430) rotate(-6)"><rect width="200" height="80" fill="#f3f0e8"/><text x="14" y="22" font-size="11" fill="#555" font-family="Noto Sans KR">법인카드 발급대장 · 14행</text><rect x="14" y="36" width="170" height="14" fill="#fff2a8"/><text x="18" y="47" font-size="10" fill="#8a3a00" font-family="Noto Sans KR">****-7730 · 박○○ · 감사팀</text></g>
    ${finish}`;
  break;
/* 엔딩: 징계위원회 — 긴 책상 너머 위원들, 앞에 선 사람의 뒷모습 */
case 'e-panel':
  svg = `${lg('wallP', [[0, '#2a2f3f'], [1, '#1a1e2a']])}
    <rect width="960" height="540" fill="url(#wallP)"/>
    <rect x="300" y="40" width="360" height="40" fill="#14182a"/><text x="480" y="67" font-size="18" fill="#9aa6c0" text-anchor="middle" font-family="Noto Sans KR" letter-spacing="6">징 계 위 원 회</text>
    <ellipse cx="480" cy="250" rx="380" ry="170" fill="#cfd8ef" opacity=".08" filter="url(#blur24)"/>
    ${[[230, 300], [370, 292], [510, 292], [650, 300]].map(([x, y]) => front(x, y, .82, '#0f1320')).join('')}
    <rect x="120" y="330" width="720" height="22" fill="#3a3242"/><rect x="120" y="352" width="720" height="70" fill="#251f2c"/>
    ${[[190, 326], [330, 322], [470, 322], [610, 326]].map(([x, y]) => `<rect x="${x}" y="${y - 18}" width="70" height="16" rx="2" fill="#cfc6b4"/>`).join('')}
    <polygon points="380,0 580,0 700,540 260,540" fill="#e9eefc" opacity=".05"/>
    <rect x="0" y="450" width="960" height="90" fill="#0d0f16"/>
    ${backOf('me', 480, 520, 1.25, '#b9c6e6')}
    ${finish}`;
  break;
/* 엔딩: 아침, 키보드 옆 커피 두 잔과 쪽지 */
case 'e-coffee': {
  const base = introScene('1')
  svg = base.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
  ov(`<div style="background:#ffe066;color:#4a3b00;width:118px;padding:9px 10px;font-size:13px;line-height:1.5;transform:rotate(-5deg);box-shadow:0 6px 16px rgba(0,0,0,.35)">미안하다.<br>이번엔 점심도 살게.<br><span style="display:block;text-align:right">— 정</span></div>`, 640, 250);
  return { svg: `<svg width="960" height="540" viewBox="0 0 960 540">${svg}</svg>`, ov: ovs };
}
case '8':
  svg = `${lg('wall8', [[0, '#1d2844'], [1, '#141c30']])}${lg('desk8', [[0, '#3a3240'], [1, '#221d28']])}
    <rect width="960" height="540" fill="url(#wall8)"/>
    <rect x="40" y="30" width="360" height="230" fill="#2a3a5e"/>${blinds(40, 34, 360, 226, 14, '#16203a', .9, 6)}
    <circle cx="300" cy="90" r="26" fill="#e8eeff" opacity=".9"/><circle cx="300" cy="90" r="60" fill="#e8eeff" opacity=".12" filter="url(#blur10)"/>
    <polygon points="40,260 400,260 620,540 120,540" fill="#9fb8ff" opacity=".08"/>
    <rect x="820" y="40" width="80" height="30" fill="#0e5c33"/><rect x="830" y="47" width="22" height="16" fill="#7ff0b2" opacity=".85"/>
    <polygon points="0,350 960,330 960,540 0,540" fill="url(#desk8)"/>
    <ellipse cx="560" cy="250" rx="300" ry="200" fill="url(#screenglow)"/>
    ${monitor(430, 120, 280, 190, '#0b0e18', '#2c5fbf')}
    <rect x="437" y="127" width="266" height="80" fill="#3a74d6" opacity=".5"/>
    <!-- 강아지 액자 (비밀번호 힌트) -->
    <g transform="translate(760 250) rotate(-5)"><rect width="90" height="100" rx="3" fill="#c9b48a"/><rect x="8" y="8" width="74" height="70" fill="#8fb0d8"/>
      <ellipse cx="45" cy="56" rx="22" ry="18" fill="#f2e3c9"/><circle cx="45" cy="38" r="14" fill="#f2e3c9"/><ellipse cx="33" cy="32" rx="5" ry="9" fill="#c9a77a"/><ellipse cx="57" cy="32" rx="5" ry="9" fill="#c9a77a"/>
      <circle cx="40" cy="38" r="2" fill="#333"/><circle cx="50" cy="38" r="2" fill="#333"/><text x="45" y="94" fill="#5a4630" font-size="10" text-anchor="middle" font-family="Noto Sans KR">콩이 ♥</text></g>
    <rect x="716" y="140" width="40" height="40" fill="#ffe066" transform="rotate(6 736 160)"/>
    <rect x="470" y="380" width="220" height="40" rx="4" fill="#15131c" transform="rotate(-2 580 400)"/>
    <!-- 어깨 너머 나 -->
    ${backOf('me', 220, 520, 1.6, '#9fb8ff')}
    <path d="M300 470 C340 440 380 420 430 410 C440 408 448 414 446 422 C430 430 400 440 370 460 Z" fill="#06080f"/>
    ${finish}`;
  ov(`<div class="lock" style="width:266px"><div class="t">02:30</div><div class="d">11월 7일 토요일</div><div class="d" style="margin-top:10px">🔒 박○○ 팀장</div></div>`, 437, 160);
  ov(`<div style="font-size:10px;color:#5b4b00;transform:rotate(6deg);width:38px;line-height:1.2">PW<br>바꿈!</div>`, 720, 148);
  break;
}
  return { svg: `<svg width="960" height="540" viewBox="0 0 960 540">${DEFS}${svg}</svg>`, ov: ovs }
}
