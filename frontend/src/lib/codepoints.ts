/**
 * The backend reports text offsets as Python str indexes, which count code points. JS strings
 * index UTF-16 units, so an astral character (an emoji) before an offset shifts it by one.
 * Convert before slicing.
 */
export function cpToUtf16(text: string, n: number): number {
  if (n <= 0) return 0
  let i = 0
  let cp = 0
  while (i < text.length && cp < n) {
    const c = text.codePointAt(i)!
    i += c > 0xffff ? 2 : 1
    cp++
  }
  return cp < n ? text.length + (n - cp) : i
}
