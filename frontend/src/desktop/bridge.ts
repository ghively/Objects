/**
 * M33: the bridge to the desktop shell (`window.objectDesktop`, set by `desktop/preload.js` of the
 * Electron shell). It is absent in a browser tab and in the old pywebview window: there `desktop()`
 * is null and nothing of `frontend/src/desktop/` shows or runs (no class on `<html>`, no drag
 * region, no room kept for window buttons, no buttons).
 *
 * The type is the plan's Contract, word for word, plus `framed` (the coordinator's addition of
 * 2026-11-12 for the shell's `--frame system` mode).
 */

export type DesktopPlatform = 'win32' | 'darwin' | 'linux'
/** Where the window's own controls are. */
export type DesktopControls = 'overlay' | 'traffic' | 'custom' | 'none'
/** The device setting "Window buttons" (`windowButtons`): "Automatic", "Show", "Hide". */
export type WindowButtons = 'auto' | 'show' | 'hide'

export interface ObjectDesktop {
  platform: DesktopPlatform
  /** Where the window's own controls are. 'overlay': the system draws them at the top right (Windows);
   *  'traffic': at the top left (macOS); 'custom': the page draws them (Linux); 'none': no buttons. */
  controls: DesktopControls
  /** True when the window has the system's ordinary frame (the shell's `--frame system`): `controls`
   *  is then 'none' on every system and the frame's own title bar moves the window. Missing: false. */
  framed?: boolean
  minimize(): void
  toggleMaximize(): void
  close(): void
  isMaximized(): Promise<boolean>
  isFullScreen(): Promise<boolean>
  /** Calls back when maximised or full screen changes; returns an unsubscribe. */
  onWindowState(cb: (s: { maximized: boolean; fullScreen: boolean }) => void): () => void
  /** The page's theme, so the system parts match: mode and the top bar's colours as CSS hex. */
  setTheme(t: { mode: 'light' | 'dark'; background: string; foreground: string }): void
  /** The shell is about to close the window: save, then resolve. One handler; returns an unsubscribe. */
  onBeforeClose(handler: () => Promise<void>): () => void
  /** Linux only: apply the "Window buttons" setting now ('auto' | 'show' | 'hide'); resolves the controls
   *  now in force. */
  setWindowButtons(v: 'auto' | 'show' | 'hide'): Promise<'custom' | 'none'>
}

declare global {
  interface Window {
    objectDesktop?: ObjectDesktop
  }
}

const PLATFORMS: readonly string[] = ['win32', 'darwin', 'linux']

/** The desktop shell's bridge, or null in a browser tab and in the pywebview window. */
export function desktop(): ObjectDesktop | null {
  if (typeof window === 'undefined') return null
  const d = window.objectDesktop as Partial<ObjectDesktop> | undefined
  if (!d || typeof d !== 'object' || !PLATFORMS.includes(d.platform as string)) return null
  return d as ObjectDesktop
}

/**
 * Whether the top bar moves the window. Not in a window with the system's frame (its own title bar
 * does), and not on Windows or macOS without window buttons (there that only happens with the
 * system's frame). On Linux a frameless window without buttons (a tiling compositor, or "Window
 * buttons: Hide") is still moved by the bar.
 */
export function barDragsWindow(d: Pick<ObjectDesktop, 'platform' | 'framed'>, controls: DesktopControls): boolean {
  if (d.framed === true) return false
  return controls !== 'none' || d.platform === 'linux'
}

const BUTTONS: readonly string[] = ['auto', 'show', 'hide']

/** A stored "Window buttons" value; anything else (an older settings file has none) is 'auto'. */
export function windowButtonsValue(v: unknown): WindowButtons {
  return typeof v === 'string' && BUTTONS.includes(v) ? (v as WindowButtons) : 'auto'
}
