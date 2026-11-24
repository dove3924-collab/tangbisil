/** 링크 전체 또는 코드만 붙여넣어도 방 코드를 뽑아낸다 */
export function parseRoomCode(input: string): string | null {
  const s = input.trim()
  const m = s.match(/\/r\/([A-Za-z0-9]{4})\b/) ?? s.match(/^([A-Za-z0-9]{4})$/)
  return m ? m[1].toUpperCase() : null
}
