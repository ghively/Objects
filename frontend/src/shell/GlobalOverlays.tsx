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
 *
 * M8 Task 3: mounts the Version History and Merge dialogs, focus mode, the presentation and the
 * "Add to whiteboard" dialog (each filled by its owner task).
 */
import { Suspense, useEffect, useState } from 'react'
import { lazyWithReload } from '@/lib/lazyReload'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { DeviceSettingsFollower } from '@/settings/DeviceSettingsFollower'
import { applyTheme } from '@/theme/applyTheme'
import { useThemeShortcuts } from '@/theme/shortcuts'
import { useGlobalShortcut } from '@/lib/shortcuts'
import { useSettingsModal } from '@/settings/useSettingsModal'
import { CreateSpaceDialog } from '@/spaces/CreateSpaceDialog'
import { SpaceSwitchOverlay } from '@/spaces/SpacesMenu'
import { VersionHistoryDialog } from '@/history/VersionHistoryDialog'
import { MergeDialog } from '@/merge/MergeDialog'
import { FocusMode } from '@/focus/FocusMode'
import { Presentation } from '@/present/Presentation'

// Not needed to paint the shell: the Settings modal and the Shortcuts sheet load when first
// opened; the "Add to whiteboard" dialog (and the whiteboard code behind it) loads after the
// first paint, off the start-up path (audit 2026-11-01 F1).
const SettingsModal = lazyWithReload(() => import('@/settings/SettingsModal').then((m) => ({ default: m.SettingsModal })))
const ShortcutsSheet = lazyWithReload(() => import('@/settings/ShortcutsSheet').then((m) => ({ default: m.ShortcutsSheet })))
const AddToWhiteboardDialog = lazyWithReload(() => import('@/whiteboard/AddToWhiteboardDialog').then((m) => ({ default: m.AddToWhiteboardDialog })))

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
  // Mounted (and its code loaded) once either has been opened; from then on it stays, so the
  // closing animation and the remembered section work as before.
  const opened = useSettingsModal((s) => s.isOpen || s.shortcutsOpen)
  const [everOpened, setEverOpened] = useState(opened)
  useEffect(() => {
    if (opened) setEverOpened(true)
  }, [opened])
  if (!everOpened) return null
  return (
    <Suspense fallback={null}>
      <SettingsModal />
      <ShortcutsSheet />
    </Suspense>
  )
}

export function GlobalOverlays() {
  return (
    <>
      <ThemeFollower />
      <DeviceSettingsFollower />
      <SettingsOverlays />
      <CreateSpaceDialog />
      <SpaceSwitchOverlay />
      <VersionHistoryDialog />
      <MergeDialog />
      <FocusMode />
      <Presentation />
      <Suspense fallback={null}>
        <AddToWhiteboardDialog />
      </Suspense>
    </>
  )
}

export default GlobalOverlays
