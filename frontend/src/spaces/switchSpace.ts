// Switching spaces: every open editor saves first (`flushAll`), then the server is asked to switch
// (`POST /api/spaces/switch`, 202), and while the launcher restarts the server on the new space we
// poll `GET /api/space` until its root is the new folder, then reload the page so every store
// starts again on that space. A failed save stops the switch; a server that doesn't come back on
// the new space within the time limit shows an error and leaves us where we are.
import { create } from 'zustand'
import { api } from '@/api/client'
import { flushAll } from '@/lib/flush'

export const SWITCH_TEXT = {
  switching: 'Switching space…', // our string
  timeout: "The space didn't open. Try again.", // our string
  dismiss: 'Close', // FindInPage.close
} as const

export const SWITCH_POLL_MS = 200
export const SWITCH_TIMEOUT_MS = 15_000

export type SwitchPhase = 'idle' | 'switching' | 'error'

export interface SpaceSwitchState {
  phase: SwitchPhase
  /** The folder being switched to (while switching, or the one that failed). */
  path: string | null
  error: string | null
  dismiss(): void
}

export const useSpaceSwitch = create<SpaceSwitchState>()((set) => ({
  phase: 'idle',
  path: null,
  error: null,
  dismiss() {
    set({ phase: 'idle', path: null, error: null })
  },
}))

/** Back to idle (tests). */
export function resetSpaceSwitch(): void {
  useSpaceSwitch.setState({ phase: 'idle', path: null, error: null })
}

/** Seams for tests: the page reload and the wait between polls. */
export const switchDeps = {
  reload: (): void => window.location.reload(),
  sleep: (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)),
  now: (): number => Date.now(),
}

/** Folder paths compared without trailing separators and with one separator style. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const s = p.replace(/\\/g, '/')
    const t = s.length > 1 ? s.replace(/\/+$/, '') : s
    // Windows drive paths are case-insensitive.
    return /^[A-Za-z]:/.test(t) ? t.toLowerCase() : t
  }
  return norm(a) === norm(b)
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export interface SwitchOptions {
  pollMs?: number
  timeoutMs?: number
}

/**
 * Switch to the space at `path`. Resolves `true` once the page is reloading on the new space,
 * `false` when the switch stopped (the error is in `useSpaceSwitch`).
 */
export async function switchSpace(path: string, opts: SwitchOptions = {}): Promise<boolean> {
  const pollMs = opts.pollMs ?? SWITCH_POLL_MS
  const timeoutMs = opts.timeoutMs ?? SWITCH_TIMEOUT_MS
  const fail = (error: string) => {
    useSpaceSwitch.setState({ phase: 'error', path, error })
    return false
  }
  if (useSpaceSwitch.getState().phase === 'switching') return false

  try {
    await flushAll()
  } catch (e) {
    return fail(message(e))
  }

  let target = path
  try {
    const res = await api.switchSpace(path)
    if (res?.path) target = res.path
  } catch (e) {
    return fail(message(e))
  }

  useSpaceSwitch.setState({ phase: 'switching', path, error: null })
  const deadline = switchDeps.now() + timeoutMs
  while (switchDeps.now() < deadline) {
    await switchDeps.sleep(pollMs)
    try {
      const space = await api.space()
      if (space && (samePath(space.root, target) || samePath(space.root, path))) {
        switchDeps.reload()
        return true
      }
    } catch {
      // The server is restarting: keep polling until the deadline.
    }
  }
  return fail(SWITCH_TEXT.timeout)
}
