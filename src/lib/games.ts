export type FileType = 'MSG' | 'XLSX' | 'EML' | 'DOCX' | 'PPTX' | 'PC' | 'VSDX'
export interface Game {
  id: string
  title: string
  desc: string
  type: FileType
  players: string
  minutes?: number
  playable: boolean
  kind: 'party' | 'escape' | 'puzzle'
  preview?: boolean // 테스트 서버에서만 보임
}

export const FILE_LABEL: Record<FileType, string> = {
  MSG: '메신저',
  XLSX: '시트',
  EML: '메일',
  DOCX: '문서',
  PPTX: '발표',
  PC: '원격 접속',
  VSDX: '구성도',
}

const ALL_GAMES: Game[] = [
  { id: 'liar', title: '라이어 게임', desc: '제시어를 모르는 라이어 한 명을 찾아라', type: 'MSG', players: '3~8명', minutes: 5, playable: true, kind: 'party' },
  { id: 'escape', title: '야근 탈출', desc: '아무도 없는 줄 알고 잠겨버린 사무실에서 엑셀 기능으로 단서를 찾아 퇴근하기', type: 'XLSX', players: '1인', minutes: 15, playable: true, kind: 'escape' },
  { id: 'workshop', title: '워크숍 조난기', desc: '늦잠 잔 워크숍 아침, PPT 기능으로 단서를 찾아 10시 버스에 타기', type: 'PPTX', players: '1인', minutes: 20, playable: true, kind: 'escape' },
  { id: 'framed', title: '누명 탈출', desc: '법인카드 3,200만 원 부정 사용 누명을 쓴 금요일 밤. 새벽 3시 본사 감사위원회 회의 전에 감사팀 PC에서 진짜 범인을 찾아라', type: 'PC', players: '1인', minutes: 30, playable: true, kind: 'escape' },
  { id: 'bell', title: '할리갈리', desc: '차례대로 카드를 펼치고, 같은 아이콘 합계가 정확히 5가 되면 가장 먼저 승인! 펼쳐진 카드를 모두 가져가요', type: 'PPTX', players: '2~4명', minutes: 5, playable: true, kind: 'party' },
  { id: 'shapevs', title: '도형 배치 대결', desc: '같은 슬라이드를 동시에! 부서 도형을 먼저 빈틈없이 채우는 사람이 1점. 혼자 연습은 퍼즐의 「도형 배치」', type: 'PPTX', players: '2~4명', minutes: 5, playable: true, kind: 'party' },
  { id: 'alkkagi', title: '알까기', desc: '슬라이드 위 원형 도형을 튕겨서 상대 도형을 영역 밖으로! 자기 진영에 몰래 배치하고, 마지막까지 남으면 승리', type: 'PPTX', players: '2명', minutes: 5, playable: true, kind: 'party' },
  { id: 'cablevs', title: '케이블 연결 대결', desc: '같은 네트워크 구성도를 동시에! 케이블을 돌려 서버와 모든 PC를 먼저 이으면 1점. 혼자 연습은 퍼즐의 「케이블 연결」', type: 'VSDX', players: '2~4명', minutes: 5, playable: true, kind: 'party' },
  { id: 'bingo', title: '빙고', desc: '주제 단어로 판을 채우고, 먼저 완성해서 [빙고!]를 누르면 승리', type: 'DOCX', players: '2~8명', minutes: 8, playable: true, kind: 'party' },
  { id: 'wordball', title: '영단어 야구', desc: '5글자 영단어 맞히기. 스트라이크·볼로 좁혀서 정규 9회 안에, 못 맞히면 연장전', type: 'XLSX', players: '1인', minutes: 3, playable: true, kind: 'puzzle' },
  { id: 'mines', title: '지뢰찾기', desc: '재고 점검표 속 지뢰 피하기. 초급·중급·고급, 양쪽 클릭으로 주변 열기까지', type: 'XLSX', players: '1인', minutes: 3, playable: true, kind: 'puzzle' },
  { id: 'sudoku', title: '스도쿠', desc: '예산 배분표 빈칸 채우기. 초급·중급·고급, 메모·자동 메모·되돌리기 지원', type: 'XLSX', players: '1인', minutes: 10, playable: true, kind: 'puzzle' },
  { id: 'shapes', title: '도형 배치', desc: '조직 개편안 슬라이드의 빈 공간에 부서 도형을 빈틈없이 채우기. 돌리고 뒤집어서 딱 맞게. 친구랑 겨루려면 파티 게임의 「도형 배치 대결」', type: 'PPTX', players: '1인', minutes: 3, playable: true, kind: 'puzzle' },
  { id: 'cable', title: '케이블 연결', desc: '네트워크 구성도의 케이블 조각을 돌려서 서버와 모든 PC를 잇기. 클릭 한 번에 90도. 친구랑 겨루려면 파티 게임의 「케이블 연결 대결」', type: 'VSDX', players: '1인', minutes: 3, playable: true, kind: 'puzzle' },
  { id: 'mafia', title: '마피아 게임', desc: '비밀 미션을 수행하며 마피아를 색출', type: 'MSG', players: '5~10명', minutes: 15, playable: false, kind: 'party' },
]

/** 본서버에서는 테스트 전용 게임을 뺀다 */
export const GAMES: Game[] = ALL_GAMES.filter((g) => !g.preview || __PREVIEW__)
