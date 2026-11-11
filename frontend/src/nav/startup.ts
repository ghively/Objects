/**
 * "When this space opens": what the active tab shows once a space
 * has loaded its tabs. `lastOpenedPage` ("Where I left off", the default) keeps the restored tabs;
 * `today` ("Calendar today") opens the Calendar's Day view on today; `calendar` opens the Calendar;
 * `specificObject` opens that object in the active tab; `home` (M32) shows Home there.
 *
 * M32: Home is what a tab with no page shows (`home/HomePage`), so "Where I left off" with nothing
 * to restore (the first open of a space: no tab) is Home without anything being opened here.
 */
import type { DeviceSettings } from '@/api/types'
import { useCalendar } from '@/calendar/useCalendar'
import { sameTarget, tabTarget, useTabs, type Target } from './tabs'

export type OpenOnStart = DeviceSettings['openOnStart'][string]

export function applyOpenOnStart(choice: OpenOnStart | undefined): void {
  if (!choice) return
  const tabs = useTabs.getState()
  switch (choice.mode) {
    case 'today':
      useCalendar.getState().setView('day')
      useCalendar.getState().today()
      tabs.open({ kind: 'calendar' })
      return
    case 'calendar':
      tabs.open({ kind: 'calendar' })
      return
    case 'specificObject': {
      if (!choice.path) return
      const target: Target = { kind: 'object', path: choice.path }
      // A tab already showing it is activated; else the active tab navigates to it, even a
      // persistent one, so a start never stacks a new tab behind it (audit 2026-11-01).
      const shown = tabs.tabs.find((t) => sameTarget(tabTarget(t), target))
      if (shown) tabs.activate(shown.id)
      else tabs.open(target, { inPlace: true })
      return
    }
    case 'home':
      tabs.openHome()
      return
    case 'lastOpenedPage':
      return
  }
}
