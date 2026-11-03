/**
 * The text size: Capacities' desktop zoom factor (electron-settings.ts `zoom`, default 1.0), with its
 * steps (`setZoomLevel`: ±0.05, refusing a step that reaches 1.5 going in or 0.6 going out).
 * Object runs in a browser, so instead of zooming the window it scales the note body: the root is
 * Capacities' 15.5px (`tokens.css`), the body is `calc(1rem * var(--app-zoom))` (`editor.css`
 * `.object-body-text`) and everything inside it is in `em` (our choice: the chrome keeps its size).
 * `applyZoom` sets `--app-zoom` on `<html>` and caches it in `localStorage` `object.zoom`, which
 * `index.html` reads before the first paint.
 */

export const ZOOM_MIN = 0.6
export const ZOOM_MAX = 1.5
export const ZOOM_STEP = 0.05
export const ZOOM_CACHE_KEY = 'object.zoom'

export type ZoomMode = 'in' | 'out' | 'reset'

const round = (z: number) => Math.round(z * 100) / 100

export function validZoom(z: unknown): z is number {
  return typeof z === 'number' && Number.isFinite(z) && z >= ZOOM_MIN && z <= ZOOM_MAX
}

/** The zoom after one step from `current` (`current` again when the step is refused). */
export function nextZoom(current: number, mode: ZoomMode): number {
  if (mode === 'reset') return 1
  const base = validZoom(current) ? current : 1
  const update = round(base + (mode === 'in' ? ZOOM_STEP : -ZOOM_STEP))
  if ((mode === 'in' && update >= ZOOM_MAX) || (mode === 'out' && update <= ZOOM_MIN)) return base
  return update
}

export function zoomPercent(z: number): string {
  return `${Math.round(z * 100)}%`
}

/** Put `zoom` on `root` as `--app-zoom` (removed at 1) and cache it for the next first paint. */
export function applyZoom(zoom: number, root: HTMLElement = document.documentElement): void {
  const z = validZoom(zoom) ? round(zoom) : 1
  if (z === 1) root.style.removeProperty('--app-zoom')
  else root.style.setProperty('--app-zoom', String(z))
  try {
    if (z === 1) localStorage.removeItem(ZOOM_CACHE_KEY)
    else localStorage.setItem(ZOOM_CACHE_KEY, String(z))
  } catch {
    // Storage blocked: the zoom still applies; the next start paints at 100% first.
  }
}
