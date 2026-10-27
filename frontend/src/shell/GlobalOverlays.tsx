/**
 * App-wide overlays mounted beside `<App />` in `main.tsx`: the theme follower, the Settings modal,
 * the Shortcuts sheet and the spaces dialogs (Tasks 16–18 fill it).
 *
 * Task 16: applies the device settings' theme to `<html>` (once they are loaded or changed here,
 * so the defaults never overwrite the cached first-paint theme) and binds `toggleDarkMode`.
 *
 * Task 17: mounts the Settings modal and the Shortcuts sheet and binds `openSettings` and
 * `toggleShortcutsMenu` (also while typing: neither changes text).
 *
 * Task 18: mounts the "Create new space" dialog and the "Switching space…" overlay.
 */
import { useEffect } from 'react'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { applyTheme } from '@/theme/applyTheme'
import { useThemeShortcuts } from '@/theme/shortcuts'
import { useGlobalShortcut } from '@/lib/shortcuts'
import { SettingsModal } from '@/settings/SettingsModal'
import { ShortcutsSheet } from '@/settings/ShortcutsSheet'
import { useSettingsModal } from '@/settings/useSettingsModal'
import { CreateSpaceDialog } from '@/spaces/CreateSpaceDialog'
import { SpaceSwitchOverlay } from '@/spaces/SpacesMenu'

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

function SettingsOverlays() {
  useGlobalShortcut('openSettings', () => useSettingsModal.getState().open(), { allowInEditable: true })
  useGlobalShortcut('toggleShortcutsMenu', () => useSettingsModal.getState().toggleShortcuts(), { allowInEditable: true })
  return (
    <>
      <SettingsModal />
      <ShortcutsSheet />
    </>
  )
}

export function GlobalOverlays() {
  return (
    <>
      <ThemeFollower />
      <SettingsOverlays />
      <CreateSpaceDialog />
      <SpaceSwitchOverlay />
    </>
  )
}

export default GlobalOverlays
