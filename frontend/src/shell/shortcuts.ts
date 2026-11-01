/**
 * The tab shortcuts (`shortcuts.categories.navigation`): close, open, cycle, the tab menu, back and
 * forward; and the panel shortcuts (`shortcuts.categories.global`): the side panel, the left
 * sidebar and the calendar sidebar. Their keys are Object's (in `lib/shortcuts.ts`); `App`
 * binds them with `useTabShortcuts()` and `usePanelShortcuts()`. Back/forward (Ctrl+←/→, Ctrl+[/])
 * and the panel keys (Ctrl+Shift+←/→) stay out of text fields and editors, where those keys move
 * and select by word.
 */
import { toggleCalendarSidebar } from '@/calendar/calendarUi'
import { M7_SHORTCUTS, registerShortcuts, useGlobalShortcut } from '@/lib/shortcuts'
import { useTabs } from '@/nav/tabs'
import { useTabMenu } from '@/shell/TabMenu'

export const TAB_SHORTCUT_IDS = ['closeTab', 'openNewTab', 'navigateTabs', 'openTabList', 'navigateBack', 'navigateForward'] as const

export const PANEL_SHORTCUT_IDS = ['toggleSidepanel', 'toggleLeftSidebar', 'toggleCalendarSidebar'] as const

registerShortcuts(M7_SHORTCUTS.filter((d) => (TAB_SHORTCUT_IDS as readonly string[]).includes(d.id)))
registerShortcuts(M7_SHORTCUTS.filter((d) => (PANEL_SHORTCUT_IDS as readonly string[]).includes(d.id)))

/** Close the active tab (a pinned tab stays: it has no close button either; our rule). */
export function closeActiveTab(): void {
  const s = useTabs.getState()
  const tab = s.tabs.find((t) => t.id === s.activeId)
  if (tab && !tab.pinned) s.close(tab.id)
}

/** Activate the next tab, wrapping around. */
export function cycleTabs(): void {
  const s = useTabs.getState()
  if (s.tabs.length < 2) return
  const i = s.tabs.findIndex((t) => t.id === s.activeId)
  s.activate(s.tabs[(i + 1) % s.tabs.length].id)
}

export function useTabShortcuts(): void {
  useGlobalShortcut('closeTab', closeActiveTab)
  useGlobalShortcut('openNewTab', () => useTabs.getState().newTab())
  useGlobalShortcut('navigateTabs', cycleTabs, { allowInEditable: true })
  // "Toggle tab menu when multiple tabs are open" (shortcuts.openTabList.name).
  useGlobalShortcut('openTabList', () => {
    const menu = useTabMenu.getState()
    if (menu.open) menu.setOpen(false)
    else if (useTabs.getState().tabs.length > 1) menu.setOpen(true)
  })
  useGlobalShortcut('navigateBack', () => useTabs.getState().back())
  useGlobalShortcut('navigateForward', () => useTabs.getState().forward())
}

/** The side panel (per tab), the left sidebar (App's state) and the calendar sidebar (`ui.json`). */
export function usePanelShortcuts({ toggleLeftSidebar }: { toggleLeftSidebar: () => void }): void {
  useGlobalShortcut('toggleSidepanel', () => useTabs.getState().toggleSidepanel())
  useGlobalShortcut('toggleLeftSidebar', toggleLeftSidebar)
  useGlobalShortcut('toggleCalendarSidebar', () => void toggleCalendarSidebar())
}
