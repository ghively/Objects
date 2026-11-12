/**
 * M33: mounted once beside `<App />` (`main.tsx`). Inside the desktop shell it keeps `<html>`'s
 * `desktop-…` classes and the window's state (`useWindowChrome`), tells the window the theme
 * (`useWindowTheme`) and watches the open notes' save states for the before-close handler
 * (`SaveWatch`). It draws nothing, and in a browser tab and in the pywebview window it does nothing.
 */
import { desktop } from './bridge'
import { SaveWatch } from './SaveWatch'
import { useWindowChrome } from './useWindowChrome'
import { useWindowTheme } from './windowTheme'

export function DesktopChrome() {
  useWindowChrome()
  useWindowTheme()
  return desktop() ? <SaveWatch /> : null
}
