/**
 * M33: mounted once beside `<App />` (`main.tsx`). It draws nothing. Inside the desktop shell it
 * keeps `<html>`'s `desktop-…` classes and the window's state (`useWindowChrome`) and tells the
 * window the theme (`useWindowTheme`); in a browser tab and in the pywebview window it does nothing.
 */
import { useWindowChrome } from './useWindowChrome'
import { useWindowTheme } from './windowTheme'

export function DesktopChrome() {
  useWindowChrome()
  useWindowTheme()
  return null
}
