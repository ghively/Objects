// M32: the Tasks page's last list, per viewer and per space in browser storage
// (`object.tasksTab:<space root>`, holding the list's task section key), so a tab that is restored
// (a reload, a tab come back to, Back) shows the list it was on, and choosing a tab writes no
// file. Nothing stored (a first visit): Today. Going to Tasks from the sidebar starts on Today
// (plan item 9, "Opens on Today"): `openTasksOnToday` lets the remembered list go, and tells a
// page that is already open.
//
// `ui.json`'s `tasks.activeTab` (the old Tasks page's memory) is not read for this: every saved
// list view has written the old default (`inbox`) into it, so it no longer says what was open.
// A missing, garbled or unreadable value reads as none; blocked storage keeps nothing.
import { useSyncExternalStore } from 'react'
import type { TaskSectionKey } from '@/api/types'
import { spaceKey } from '@/nav/spaceStorage'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { TASKS_MORE_LISTS, TASKS_PAGE_TABS } from './taskTabs'

const BASE = 'object.tasksTab'

/** The lists the page can show: the five tabs' sections, then the "More" lists. */
export const TASKS_PAGE_LISTS: readonly TaskSectionKey[] = [...TASKS_PAGE_TABS.map((t) => t.section), ...TASKS_MORE_LISTS]

/** The list the page opens on when none is remembered. */
export const DEFAULT_TASKS_LIST: TaskSectionKey = 'today'

/** The list last shown in space `root` (null: no space known), or null. */
export function readTasksTab(root: string | null): TaskSectionKey | null {
  try {
    const raw = localStorage.getItem(spaceKey(BASE, root))
    return TASKS_PAGE_LISTS.find((k) => k === raw) ?? null
  } catch {
    return null
  }
}

/** Remember `key` as the list shown in space `root`. */
export function writeTasksTab(root: string | null, key: TaskSectionKey): void {
  try {
    localStorage.setItem(spaceKey(BASE, root), key)
  } catch {
    /* storage unavailable: nothing is remembered */
  }
}

// ---- going to Tasks from the sidebar: Today ----

let visits = 0
const watchers = new Set<() => void>()

/**
 * The person went to Tasks (the sidebar's entry): the page opens on Today. The list remembered
 * for the open space is let go, and a Tasks page already on screen goes to Today too.
 */
export function openTasksOnToday(): void {
  try {
    localStorage.removeItem(spaceKey(BASE, useSpaceInfo.getState().space?.root ?? null))
  } catch {
    /* storage unavailable: nothing was remembered */
  }
  visits += 1
  for (const w of [...watchers]) w()
}

/** Counts the goes to Tasks from the sidebar (a Tasks page forgets its own pick when it changes). */
export function useTasksVisits(): number {
  return useSyncExternalStore(
    (onChange) => {
      watchers.add(onChange)
      return () => watchers.delete(onChange)
    },
    () => visits,
  )
}
