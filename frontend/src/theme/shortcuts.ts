/**
 * The theme's shortcut: `toggleDarkMode` ("Toggle dark mode", `shortcuts.toggleDarkMode.name`;
 * provisional key Mod-Shift-d, Gene confirms it in the hand-check). Toggling flips the device
 * setting `themeMode` through `useSettings().patch`; `GlobalOverlays` applies the result.
 */
import { registerShortcuts, useGlobalShortcut } from '@/lib/shortcuts'
import { useSettings } from '@/settings/useSettings'

registerShortcuts([
  { id: 'toggleDarkMode', category: 'global', name: 'Toggle dark mode', keys: ['Mod-Shift-d'], scope: 'global', provisional: true },
])

/** Switch between the light and the dark theme (each keeps its own Light/Dimmed choice). */
export function toggleDarkMode(): Promise<void> {
  const { settings, patch } = useSettings.getState()
  return patch({ themeMode: settings.themeMode === 'light' ? 'dark' : 'light' })
}

/** Bind `toggleDarkMode` for the whole window (also while typing: it changes no text). */
export function useThemeShortcuts(): void {
  useGlobalShortcut(
    'toggleDarkMode',
    () => {
      // A failed save keeps the switched theme on screen; the next load shows the stored one.
      toggleDarkMode().catch(() => undefined)
    },
    { allowInEditable: true },
  )
}
