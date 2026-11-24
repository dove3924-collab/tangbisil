/** 엑셀 탈출: 방 = 시트 한 장. 셀 하나 = 그림의 픽셀 하나 */

export interface CellDef {
  v?: string | number
  id?: string
  serial?: number // 엑셀 날짜 일련번호
  dateFmt?: boolean // 처음부터 날짜 서식인지
  lock?: string // 잠긴 물건 (=열기(암호))
  white?: boolean // 흰 글씨
  comment?: string // 셀 메모
  bold?: boolean
  color?: string
  align?: 'left' | 'right' | 'center'
}
export type CellIn = CellDef | string | number | null

export interface RowDef {
  cells: CellIn[]
  showIf?: string // 플래그가 켜져야 보이는 줄
}

/** 시트 위에 놓인 표 (물건 영역 안에 들어감) */
export interface TableDef {
  id: string
  x: number
  y: number
  spans: number[] // 열마다 차지하는 셀 수 (병합)
  title?: string
  titleColor?: string
  header?: string[]
  headerFill?: string
  rows: RowDef[]
  color?: string // 글자 색
  sortable?: boolean
  cf?: boolean // 조건부 서식 대상
  narrowCol?: number // 이 열은 좁아서 #### 로 보임 (열 너비 자동 맞춤 필요)
}

export interface Hotspot {
  x: number
  y: number
  w: number
  h: number
  label: string
  say?: string[] // 클릭하면 짧은 메모 (없으면 그 위치로 확대)
}

export interface StoryPage {
  title: string
  icon: 'warn' | 'info' | 'error' | 'ok'
  text: string
}

export interface Lock {
  id: string
  answer: string
  title: string
  onOpen: StoryPage[]
}

export type Flags = Record<string, boolean>

export interface RoomDef {
  name: string
  password?: string
  w: number
  h: number
  art: (f: Flags) => string[][]
  tables: TableDef[]
  hotspots: (f: Flags) => Hotspot[]
  hiddenRows: number[] // 처음에 숨겨진 행 (0부터)
  blink?: { x: number; y: number }[] // 깜빡이는 셀
  locks: Lock[]
  enter: StoryPage[]
  hints: { until: string; steps: string[] }[]
}
