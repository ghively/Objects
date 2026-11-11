/**
 * The tab shortcuts: close, open, cycle, the tab menu, back and
 * forward; and the panel shortcuts: the side panel, the left
 * sidebar and the calendar sidebar. Their keys are in `lib/shortcuts.ts`; `App`
 * binds them with `useTabShortcuts()` and `usePanelShortcuts()`. Back/forward (Ctrl+←/→, Ctrl+[/])
 * and the panel keys (Ctrl+Shift+←/→) stay out of text fields and editors, where those keys move
 * and select by word (our call, M31: unlike Ctrl+, or Ctrl+Shift+M, which type nothing, Ctrl+Shift+→
 * is the field's own "extend the selection by a word", so a field in the side panel keeps it; the
 * panel closes with the key from outside the field, the top bar button or the palette).
 *
 * The General keys of the 2026-11-08 sweep (`useGeneralShortcuts()`: Create new task) ride along
 * with the tab shortcuts, so `App` binds them with the same call.
 */
import { toggleCalendarSidebar } from '@/calendar/calendarUi'
import { useCalendar } from '@/calendar/useCalendar'
import { createAndOpen } from '@/create/createAndOpen'
import { showToast } from '@/editor/media/upload'
import { useLinkIndex } from '@/links/linkIndex'
import { M7_SHORTCUTS, registerShortcuts, useGlobalShortcut } from '@/lib/shortcuts'
import { openTodaysNote } from '@/calendar/openTodaysNote'
import { currentTarget, useTabs } from '@/nav/tabs'
import { isTasksHidden } from '@/tasks/tasksHidden'
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

/** The basic Task type of this space (by flag and name, as the server infers it), or none. */
export function taskTypeId(): string | undefined {
  const types = useLinkIndex.getState().types
  return (types.find((t) => t.basic && t.name.toLowerCase() === 'task') ?? types.find((t) => t.id === 'task'))?.id
}

export const CREATE_TASK_FAILED = 'Could not create the task.'

/**
 * "Create new task" (Ctrl+Shift+T): the New menu's flow for the Task type, outside editable
 * targets. A failure shows its message as a toast, as the New menu shows it. M32: nothing while
 * the space hides Tasks ("Hide Tasks in this space").
 */
export function createNewTask(): void {
  if (isTasksHidden()) return
  const id = taskTypeId()
  if (!id) return
  void createAndOpen(id).catch((err: unknown) => showToast(err instanceof Error && err.message ? err.message : CREATE_TASK_FAILED))
}

/**
 * "Go to Calendar" (Ctrl+Alt+H): open the Calendar in the current tab; pressed again while it is
 * open, jump to today (the catalog: "press twice to jump to today").
 */
export function goToCalendar(): void {
  const tabs = useTabs.getState()
  if (currentTarget(tabs)?.kind === 'calendar') useCalendar.getState().today()
  else tabs.open({ kind: 'calendar' })
}

/**
 * The General keys of the 2026-11-08 sweep. Inside the editor Ctrl+Shift+T stays "Make this line
 * a task"; Ctrl+Alt+H types nothing, so it works there too.
 */
export function useGeneralShortcuts(): void {
  useGlobalShortcut('createNewTask', createNewTask)
  useGlobalShortcut('goToCalendar', goToCalendar, { allowInEditable: true })
}

export function useTabShortcuts(): void {
  useGeneralShortcuts()
  useGlobalShortcut('closeTab', closeActiveTab)
  useGlobalShortcut('openNewTab', () => useTabs.getState().newTab())
  useGlobalShortcut('navigateTabs', cycleTabs, { allowInEditable: true })
  // "Show or hide the list of open tabs".
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
  // M32: also with the caret in a note's text or title (no editor binds Ctrl+Shift+D).
  useGlobalShortcut('openTodaysNote', () => void openTodaysNote(), { allowInEditable: true })
}
