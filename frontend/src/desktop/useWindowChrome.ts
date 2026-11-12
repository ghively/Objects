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
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { barDragsWindow, desktop, type DesktopControls } from './bridge'
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

export const FULLSCREEN_CLASS = 'desktop-fullscreen'
export const DRAG_CLASS = 'desktop-drag'
const CONTROLS: readonly DesktopControls[] = ['overlay', 'traffic', 'custom', 'none']
export const controlsClass = (c: DesktopControls) => `desktop-controls-${c}`

/** Mounted once (`DesktopChrome`). */
export function useWindowChrome(): void {
  useEffect(() => {
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
