/**
 * M33: the page's side of the desktop window (the Electron shell). Inside the shell, and only
 * there (`desktop()` is null in a browser tab and in the pywebview window, where this does
 * nothing at all), `<html>` gets:
 * - `desktop-win32` / `desktop-darwin` / `desktop-linux` (the system);
 * - `desktop-controls-overlay` / `-traffic` / `-custom` / `-none`: where the window's buttons are
 *   now. The room the top bar keeps free hangs on this alone, never on the system: 'overlay' the
 *   top right corner, 'traffic' the left end, 'custom' and 'none' nothing;
 * - `desktop-drag` while the top bar moves the window (`barDragsWindow`: not with the system's frame);
 * - `desktop-fullscreen` while the window is full screen.
 * `desktop.css` hangs everything on those classes. `useChrome` holds the same facts for
 * `WindowControls`.
 *
 * On Linux it also applies the device setting "Window buttons" (`windowButtons`: Automatic, Show,
 * Hide; Settings > Appearance) once the settings are read and whenever it changes.
 */
import { useEffect, useLayoutEffect } from 'react'
import { create } from 'zustand'
import type { DeviceSettings } from '@/api/types'
import { useSettings } from '@/settings/useSettings'
import { barDragsWindow, desktop, windowButtonsValue, type DesktopControls, type WindowButtons } from './bridge'
import './desktop.css'

export interface ChromeState {
  /** The window buttons in force; null outside the shell and until the chrome is mounted. */
  controls: DesktopControls | null
  maximized: boolean
  fullScreen: boolean
}

const INITIAL: ChromeState = { controls: null, maximized: false, fullScreen: false }

export const useChrome = create<ChromeState>(() => INITIAL)

/** Tests: back to a window nothing is known about. */
export function resetChrome(): void {
  useChrome.setState(INITIAL)
}

/** The stored "Window buttons" choice; 'auto' when a settings file holds none, or none of the three. */
export function storedWindowButtons(settings: Partial<Pick<DeviceSettings, 'windowButtons'>>): WindowButtons {
  return windowButtonsValue(settings.windowButtons)
}

/** Whether "Window buttons" means anything here: the desktop window on Linux, without the system's frame. */
export function windowButtonsApply(): boolean {
  const d = desktop()
  return !!d && d.platform === 'linux' && d.framed !== true
}

let asked = 0

/**
 * Apply a "Window buttons" choice now: the shell answers with the buttons in force and the top
 * bar draws them or not at once. The latest call wins. Nothing outside the Linux desktop window.
 */
export async function applyWindowButtons(v: WindowButtons): Promise<void> {
  const d = desktop()
  if (!d || !windowButtonsApply()) return
  const mine = ++asked
  try {
    const controls = await d.setWindowButtons(v)
    if (mine === asked) useChrome.setState({ controls })
  } catch {
    // The shell could not say: the buttons stay as they are.
  }
}

export const FULLSCREEN_CLASS = 'desktop-fullscreen'
export const DRAG_CLASS = 'desktop-drag'
const CONTROLS: readonly DesktopControls[] = ['overlay', 'traffic', 'custom', 'none']
export const controlsClass = (c: DesktopControls) => `desktop-controls-${c}`

/** Mounted once (`DesktopChrome`). */
export function useWindowChrome(): void {
  // Linux: the stored "Window buttons" choice, once the settings are read and when it changes
  // (here or in another window).
  const loaded = useSettings((s) => s.loaded)
  const buttons = useSettings((s) => storedWindowButtons(s.settings))
  useEffect(() => {
    if (loaded) void applyWindowButtons(buttons)
  }, [loaded, buttons])

  // In the layout phase: the classes (the room for the system's buttons, the drag region) are on
  // `<html>` before the top bar is painted for the first time, so no frame shows it un-padded.
  useLayoutEffect(() => {
    const d = desktop()
    if (!d) return
    const root = document.documentElement
    const platformClass = `desktop-${d.platform}`
    root.classList.add(platformClass)

    /** `<html>`'s classes say what the store says. */
    const sync = (s: ChromeState) => {
      const controls = s.controls ?? d.controls
      for (const c of CONTROLS) root.classList.toggle(controlsClass(c), c === controls)
      root.classList.toggle(DRAG_CLASS, barDragsWindow(d, controls))
      root.classList.toggle(FULLSCREEN_CLASS, s.fullScreen)
    }
    const unsubscribe = useChrome.subscribe(sync)
    useChrome.setState({ controls: d.controls })
    sync(useChrome.getState())

    let live = true
    /** A change the shell told us about is newer than the answer to the first question. */
    let told = false
    const apply = (s: { maximized: boolean; fullScreen: boolean }) => {
      if (live) useChrome.setState({ maximized: !!s.maximized, fullScreen: !!s.fullScreen })
    }
    const off = d.onWindowState((s) => {
      told = true
      apply(s)
    })
    void Promise.all([d.isMaximized(), d.isFullScreen()])
      .then(([maximized, fullScreen]) => {
        if (!told) apply({ maximized, fullScreen })
      })
      .catch(() => undefined)

    return () => {
      live = false
      off()
      unsubscribe()
      root.classList.remove(platformClass, FULLSCREEN_CLASS, DRAG_CLASS, ...CONTROLS.map(controlsClass))
      useChrome.setState(INITIAL)
    }
  }, [])
}
