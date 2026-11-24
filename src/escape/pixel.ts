/** 방 그림(픽셀) 그리기 도우미 */
export function canvas(w: number, h: number, bg: string) {
  const px = Array.from({ length: h }, () => Array<string>(w).fill(bg))
  const rect = (x: number, y: number, rw: number, rh: number, c: string) => {
    for (let j = y; j < y + rh; j++)
      for (let i = x; i < x + rw; i++) if (j >= 0 && j < h && i >= 0 && i < w) px[j][i] = c
  }
  const dot = (x: number, y: number, c: string) => rect(x, y, 1, 1, c)
  return { px, rect, dot }
}

/** 3x5 숫자 글꼴 */
export const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
}

/** 숫자 문자열을 (x,y)부터 scale 배로 그린다. 글자 간격 gap */
export function drawDigits(
  rect: (x: number, y: number, w: number, h: number, c: string) => void,
  text: string, x: number, y: number, scale: number, gap: number, color: string,
) {
  text.split('').forEach((d, k) => {
    DIGITS[d].forEach((row, j) =>
      row.split('').forEach((b, i) => {
        if (b === '1') rect(x + k * (3 * scale + gap) + i * scale, y + j * scale, scale, scale, color)
      }),
    )
  })
}

/** 숫자 문자열을 3x5 글꼴로 놓았을 때 켜지는 칸 (행, 열) 집합 */
export function digitMask(text: string, gap: number): boolean[][] {
  const w = text.length * 3 + (text.length - 1) * gap
  const m = Array.from({ length: 5 }, () => Array<boolean>(w).fill(false))
  text.split('').forEach((d, k) =>
    DIGITS[d].forEach((row, j) => row.split('').forEach((b, i) => { if (b === '1') m[j][k * (3 + gap) + i] = true })),
  )
  return m
}
