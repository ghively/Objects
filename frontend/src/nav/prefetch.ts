/**
 * Warm the lazy page chunks once the shell is idle after start (re-measured after the
 * 2026-11-01 audit fix pass: splitting the graph page off the entry chunk made its first
 * open 0.7 s slower on a small space). The loads run off the startup path and never
 * block it; a loader that fails is left to its `React.lazy` boundary to retry.
 */
export type Loader = () => Promise<unknown>

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
  cancelIdleCallback?: (id: number) => void
}

/** Run `loaders` in order when the browser is idle; returns a cancel function. */
export function prefetchOnIdle(loaders: readonly Loader[], win: IdleWindow = window as IdleWindow): () => void {
  let cancelled = false
  const run = () => {
    if (cancelled) return
    for (const load of loaders) void load().catch(() => undefined)
  }
  if (typeof win.requestIdleCallback === 'function') {
    const id = win.requestIdleCallback(run, { timeout: 5_000 })
    return () => {
      cancelled = true
      win.cancelIdleCallback?.(id)
    }
  }
  const id = setTimeout(run, 1_500)
  return () => {
    cancelled = true
    clearTimeout(id)
  }
}
