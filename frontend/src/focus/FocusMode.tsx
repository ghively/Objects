/**
 * Focus mode's effects on the shell and its timer. Mounted once in `shell/GlobalOverlays.tsx`.
 *
 * While `useFocusMode().on`, one stylesheet hides the left sidebar, the tab strip, the side panel
 * and the main view's property panel; the page centres itself (the content column is `mx-auto`).
 * None of those parts' own state is touched, so leaving shows each exactly as it was before.
 * Off an object (any other tab target) focus mode leaves again with "Focus mode is not available
 * here" (our rule). Binds `toggleFocusMode` (Mod-Shift-f).
 */
import { useEffect } from 'react'
import { useGlobalShortcut } from '@/lib/shortcuts'
import { currentTarget, useTabs } from '@/nav/tabs'
import { FocusTimer } from './FocusTimer'
import { FOCUS_TEXT, useFocusMode } from './useFocusMode'

/** The `<html>` attribute set while focus mode is on. */
export const FOCUS_ATTR = 'data-focus-mode'

/** The chrome hidden in focus mode. */
export const FOCUS_HIDDEN_SELECTORS = [
  'aside[aria-label="Sidebar"]',
  '[data-slot="tab-strip"]',
  'aside[aria-label="Side panel"]',
  '[data-main-column] aside[aria-label="Properties"]',
  '[data-main-column] [data-properties-inline]',
] as const

export const FOCUS_CSS = `${FOCUS_HIDDEN_SELECTORS.map((s) => `html[${FOCUS_ATTR}] ${s}`).join(',\n')} { display: none !important; }`

const NOTICE_MS = 3000

function useChromeHidden(on: boolean) {
  useEffect(() => {
    if (!on) return
    const root = document.documentElement
    const style = document.createElement('style')
    style.setAttribute('data-focus-mode-style', '')
    style.textContent = FOCUS_CSS
    document.head.appendChild(style)
    root.setAttribute(FOCUS_ATTR, '')
    return () => {
      root.removeAttribute(FOCUS_ATTR)
      style.remove()
    }
  }, [on])
}

export function FocusMode() {
  const on = useFocusMode((s) => s.on)
  const notice = useFocusMode((s) => s.notice)
  const isObject = useTabs((s) => currentTarget(s)?.kind === 'object')

  useGlobalShortcut('toggleFocusMode', () => useFocusMode.getState().toggle(), { allowInEditable: true })

  useEffect(() => {
    if (on && !isObject) {
      const s = useFocusMode.getState()
      s.leave()
      s.setNotice(FOCUS_TEXT.unavailable)
    }
  }, [on, isObject])

  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => useFocusMode.getState().setNotice(null), NOTICE_MS)
    return () => clearTimeout(id)
  }, [notice])

  const shown = on && isObject
  useChromeHidden(shown)

  return (
    <>
      <FocusTimer show={shown} />
      {notice && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-line bg-raised px-3 py-2 text-[14px] text-fg shadow-sm"
        >
          {notice}
        </div>
      )}
    </>
  )
}

export default FocusMode
