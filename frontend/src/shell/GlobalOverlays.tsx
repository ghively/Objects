/**
 * App-wide overlays mounted beside `<App />` in `main.tsx`: the theme follower, the Settings modal,
 * the Shortcuts sheet and the spaces dialogs (Tasks 16–18 fill it).
 *
 * Task 16: applies the device settings' theme to `<html>` (once they are loaded or changed here,
 * so the defaults never overwrite the cached first-paint theme) and binds `toggleDarkMode`.
 */
import { useEffect } from 'react'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { applyTheme } from '@/theme/applyTheme'
import { useThemeShortcuts } from '@/theme/shortcuts'

function ThemeFollower() {
  const settings = useSettings((s) => s.settings)
  const loaded = useSettings((s) => s.loaded)
  const ready = loaded || settings !== settingsDefaults
  const { themeMode, lightTheme, darkTheme, font, monochromeTags, monochromeTypeLabels } = settings
  useEffect(() => {
    if (!ready) return
    applyTheme({ themeMode, lightTheme, darkTheme, font, monochromeTags, monochromeTypeLabels })
  }, [ready, themeMode, lightTheme, darkTheme, font, monochromeTags, monochromeTypeLabels])
  useThemeShortcuts()
  return null
}

export function GlobalOverlays() {
  return <ThemeFollower />
}

export default GlobalOverlays
