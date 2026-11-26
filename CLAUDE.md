# 탕비실 — 작업 기록

## 이 프로젝트
- 직장인 토탈 사이트 「탕비실」. 월루(dove3924-collab/wollu, 회사에서 몰래 하는 게임 포털)를 확장한 두 번째 프로젝트로, 월루 코드를 복사해서 시작 (2026-11-24)
- 목표: 모든 직장인이 상태창을 화면에 띄워 두고(설치/항상 위 작은 창), 거기서 미니게임·운세·점심 추천으로 이동
- 무료(Vercel Hobby + Supabase Free + *.vercel.app)로 먼저 만들어 주변 반응을 본 뒤 정식 도메인 구매. 광고 수익화 계획 있음 (카카오 애드핏 먼저 → 애드센스. 상태창 작은 창·게임 진행 화면·보스키 위장 화면에는 광고 넣지 않기)
- Supabase 새 프로젝트: https://cjeinykdiveakcdilrml.supabase.co (publishable 키는 src/lib/config.ts). 익명 로그인 켜야 함. SQL 은 supabase/apply_all.sql 한 번에
- GA: 탕비실 전용 속성 아직 없음 (analytics.ts GA_ID 비어 있음 → 안 보냄)

## 작업 방식 (월루와 같음)
- 의견·논의를 물으면 만들기 전에 먼저 답하기. 화면은 시안 먼저 보여주고 컨펌 후 개발
- 보고는 반말·쉬운 말. 새 기능은 테스트 서버 먼저 → 정식 PR
- 실명 대신 ○○. 공용 CSS 클래스 이름에는 화면별 접두어 (월루에서 `.sp` 충돌로 엑셀 화면이 가려진 적 있음)

## 사이트 구조 (2026-11-24 결정)
- `/` 홈: 맨 위 '내 상태창 띠'(설정 전엔 기본값으로 바로 작동 + '3개만 고르면 내 상태창') → 메뉴 3개 🎮 게임 · 🔮 운세 · 🍱 점심 (오늘 내용 미리보기)
- `/status` 상태창 전용 (항상 위 작은 창·설치 앱이 여는 곳)
- `/games` 게임(월루 로비 내용), `/fortune` 운세, `/lunch` 점심
- 게임 공유 링크로 온 사람은 지금처럼 바로 게임으로
- 연차 플래너·직장인 도구·오늘의 지식은 뺌 (남은 연차는 상태창 숫자로만)

## 상태창
- 항목: 퇴근까지(HP 막대) · 오늘 번 돈(실시간, 초당 급여) · 월급날 D-day · 주말/다음 공휴일까지 · 남은 연차 · 레벨(근속) · 버프/디버프 · 운세 한 줄 · '오늘 월루로 번 돈'
- 스킨 4종 선택: 윈도우 위젯(기본) · 픽셀 RPG · 주식 앱 · 사원증. 보스키(Esc 두 번) = 윈도우 위젯
- 크기 3단계: 펼친 상태창 / 항상 위 작은 창(Document Picture-in-Picture) / 한 줄 미니 막대
- 첫 방문: 입력 없이 기본값(09–18시, 점심 12–13, 월 300만 원, 25일, 연차 15일)으로 바로 작동, 기본값 숫자엔 '기본값' 표시 → 상태창 안 질문 카드 3개(퇴근 시각 / 월급 구간 / 월급날, 버튼 선택) → 완성 후 '화면에 띄우기' 권유. 숫자 클릭으로 개별 수정, ⚙ 설정에서 나머지
- 월급 등 개인 정보는 브라우저에만 저장, 서버로 보내지 않음
- 브랜드: ☕ 탕비실, 크림·커피색 (#fbf6ee / #6b4426)

## 순서 (예정)
1. 상태창 (기본값 + 3문항 + 스킨 4종 + 화면에 띄우기)
2. 홈 개편 + 탕비실 디자인
3. 점심 메뉴 추천 (오늘의 추천·다시 뽑기·팀 투표)
4. 운세

## 상태창 1차 (claude/status-window)
- `/status` 페이지 + 홈 맨 위 한 줄 띠(`src/status/Strip.tsx`)
- 파일: `src/status/{settings.ts,calc.ts,Widget.tsx,EditPop.tsx,Onboard.tsx,SettingsPanel.tsx,pip.tsx,StatusPage.tsx,status.css}` — CSS 클래스는 전부 `st-` 접두사
- 저장: localStorage `tbs.status` (서버 전송 없음), 탭·작은 창끼리 바로 동기화
- 스킨 4개(위젯/RPG/주식/사원증), 👁 금액 가리기, 숫자 클릭 → 말풍선 편집, ⚙ 전체 설정
- 📌 항상 위 작은 창 = Document PiP (크롬·엣지). 미지원 브라우저는 `/status?popup=1` 일반 팝업
- 작은 창: ➖ 한 줄 바 ↔ ⤢ 펼치기, Esc 두 번 → 위젯 스킨 + 금액 가리기
- 월급날이 주말이면 앞 금요일로 계산 (공휴일은 아직 미반영)
- 운세·점심 메뉴는 '곧 열려요' 토스트

## 사이트 구조 개편 (claude/home-categories)
- `/` 홈(`src/site/Home.tsx`): 상태 요약 카드 + 🎮게임 / 🔮운세 / 🍱점심 카드 (오늘 미리보기)
- `/games` = 기존 Lobby (게임에서 나가기·로비로 버튼은 전부 `/games` 로)
- `/fortune`(`src/site/{Fortune.tsx,fortune.ts}`): 생년월일(선택) + 날짜 시드로 하루 고정 운세, 업무·금전·인간관계·퇴근운, 행운 5종, 띠별 한 줄, 결과 복사
- `/lunch` 점심 추천(`src/site/{Lunch.tsx,lunch.ts}`): 메뉴 117개, 후보 목록은 접기·펼치기, 종류·상황 필터, 뽑기, '이걸로 먹을래요' 기록(최근 3일 제외)
- 공통 머리글 `src/site/SiteHeader.tsx`, CSS 접두사 `ts-` (`src/site/site.css`)
- `/games` 디자인: `src/site/games.css` (`.lobby` 안에서만 덮어씀, 남색 바 → 크림 제목줄 + 칩 탭, 보스키 안내 + 방 코드 입장 한 줄, 둥근 카드)
- localStorage: `tbs.status`, `tbs.fortune.birth`, `tbs.lunch.hist`, `tbs.device`
- 월루 퍼즐 순위 기록 옮기기: `supabase/wollu_records_export.sql` (월루 SQL Editor 실행 → 결과 복사 → 탕비실 SQL Editor 실행). 브라우저에 저장된 개인 기록은 주소가 달라 자동으로 못 옮김

## 셀 링크 · 셀 링크 대결 (2026-11-26, 월루와 같이 정식 오픈)
- 월루에서 만든 그대로 옮김 (`src/link/`, `src/hooks/useLinkVs.ts`, DB `0014_link_battle.sql`). 자세한 내용은 월루 기록 참고
- 탕비실은 나가기가 `/games` 로 감 (ExcelFrame `onExit`, LinkVsGame)
- **탕비실 Supabase에도 0014 SQL 실행 필요**
