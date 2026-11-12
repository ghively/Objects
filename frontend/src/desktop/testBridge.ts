// Tests only: a stand-in for the bridge the desktop shell's preload sets (`window.objectDesktop`).
// It records what the page asks of the window and lets a test play the shell's side.
import { vi } from 'vitest'
import type { DesktopControls, DesktopPlatform, ObjectDesktop, WindowButtons } from './bridge'

export interface FakeDesktop {
  bridge: ObjectDesktop
  /** The shell says the window was maximised, restored, or went in or out of full screen. */
  emitWindowState(s: { maximized: boolean; fullScreen: boolean }): void
  /** The shell is about to close the window: runs the page's handler, as the shell does. */
  beforeClose(): Promise<void>
  /** Whether the page has a before-close handler registered. */
  hasBeforeClose(): boolean
}

export function fakeDesktop(
  over: { platform?: DesktopPlatform; controls?: DesktopControls; maximized?: boolean; fullScreen?: boolean } = {},
): FakeDesktop {
  const listeners = new Set<(s: { maximized: boolean; fullScreen: boolean }) => void>()
  let state = { maximized: !!over.maximized, fullScreen: !!over.fullScreen }
  let handler: (() => Promise<void>) | null = null
  const platform = over.platform ?? 'linux'
  // What "Automatic" gives on this window: the page draws the buttons unless the shell said none.
  const auto: 'custom' | 'none' = over.controls === 'none' ? 'none' : 'custom'
  const bridge: ObjectDesktop = {
    platform,
    controls: over.controls ?? (platform === 'win32' ? 'overlay' : platform === 'darwin' ? 'traffic' : 'custom'),
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(async () => state.maximized),
    isFullScreen: vi.fn(async () => state.fullScreen),
    onWindowState: vi.fn((cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }),
    setTheme: vi.fn(),
    onBeforeClose: vi.fn((h) => {
      handler = h
      return () => {
        if (handler === h) handler = null
      }
    }),
    setWindowButtons: vi.fn(async (v: WindowButtons) => (v === 'show' ? 'custom' : v === 'hide' ? 'none' : auto)),
  }
  return {
    bridge,
    emitWindowState(s) {
      state = s
      for (const cb of [...listeners]) cb(s)
    },
    beforeClose: () => (handler ? handler() : Promise.resolve()),
    hasBeforeClose: () => handler !== null,
  }
}
