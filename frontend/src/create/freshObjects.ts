/**
 * Objects this window has just created and opened: their header focuses the title once, so a new
 * object can be named straight away (acceptance M2#3). `createAndOpen` marks the path; the header
 * that shows it first (peek or page) takes the mark.
 */
const fresh = new Set<string>()

/** Mark `path` as just created. */
export function markFresh(path: string): void {
  fresh.add(path)
}

/** True once for a path marked by `markFresh` (the mark is used up). */
export function takeFresh(path: string): boolean {
  return fresh.delete(path)
}

/** Tests: forget every mark. */
export function resetFresh(): void {
  fresh.clear()
}
