/**
 * Puts the device settings that act app-wide onto `<html>` once they are loaded (so the defaults
 * never overwrite what `index.html` painted first):
 * - the text size (`--app-zoom`, `zoom.ts`);
 * - the spellcheck language (`lang`, `spellcheck.ts`; the browser's spellchecker follows it);
 * - "Hide object type settings outside of settings" (`data-hide-structure-settings`: `index.css`
 *   hides every `[data-structure-setting]` entry point while it is set);
 * - the highlight style (`data-highlight-style`; Object has no highlight blocks yet, so nothing
 *   reads it so far).
 * Mounted once by `shell/GlobalOverlays.tsx`.
 */
import { useEffect } from 'react'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { documentLang } from './spellcheck'
import { applyZoom } from './zoom'

export function DeviceSettingsFollower() {
  const settings = useSettings((s) => s.settings)
  const loaded = useSettings((s) => s.loaded)
  const ready = loaded || settings !== settingsDefaults
  const { zoom, spellCheckLang, hideStructureSettings, highlightStyle } = settings
  useEffect(() => {
    if (ready) applyZoom(zoom)
  }, [ready, zoom])
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('lang', documentLang(spellCheckLang))
    root.toggleAttribute('data-hide-structure-settings', !!hideStructureSettings)
    root.setAttribute('data-highlight-style', highlightStyle === 'minimal' ? 'minimal' : 'default')
  }, [spellCheckLang, hideStructureSettings, highlightStyle])
  return null
}
