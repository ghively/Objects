/**
 * Puts the device settings that act app-wide onto `<html>` once they are loaded (so the defaults
 * never overwrite what `index.html` painted first):
 * - the text size (`--app-zoom`, `zoom.ts`);
 * - the spellcheck language (`lang`, `spellcheck.ts`; the browser's spellchecker follows it);
 * - "Keep type settings inside Settings only" (`data-hide-type-settings`: `index.css`
 *   hides every `[data-type-setting]` entry point while it is set);
 * - the highlight style (`data-highlight-style`; Object has no highlight blocks yet, so nothing
 *   reads it so far).
 * - M31 "App icon": the tab icon in the chosen colour (`appIcon.ts`).
 * Mounted once by `shell/GlobalOverlays.tsx`.
 */
import { useEffect } from 'react'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { useAppIcon } from './appIcon'
import { documentLang } from './spellcheck'
import { applyZoom } from './zoom'

export function DeviceSettingsFollower() {
  const settings = useSettings((s) => s.settings)
  const loaded = useSettings((s) => s.loaded)
  const ready = loaded || settings !== settingsDefaults
  const { zoom, spellCheckLang, hideTypeSettings, highlightStyle } = settings
  useAppIcon()
  useEffect(() => {
    if (ready) applyZoom(zoom)
  }, [ready, zoom])
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('lang', documentLang(spellCheckLang))
    root.toggleAttribute('data-hide-type-settings', !!hideTypeSettings)
    root.setAttribute('data-highlight-style', highlightStyle === 'minimal' ? 'minimal' : 'default')
  }, [spellCheckLang, hideTypeSettings, highlightStyle])
  return null
}
