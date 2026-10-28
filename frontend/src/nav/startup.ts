/**
 * "When this space opens" (`EditorSettings.openOnStart.*`): what the active tab shows once a space
 * has loaded its tabs. `lastOpenedPage` ("Where I left off", the default) keeps the restored tabs;
 * `today` ("Calendar today") opens the Calendar's Day view on today; `calendar` opens the Calendar;
 * `specificObject` opens that object in the active tab.
 */
import type { DeviceSettings } from '@/api/types'
import { useCalendar } from '@/calendar/useCalendar'
import { useTabs } from './tabs'

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
    case 'specificObject':
      if (choice.path) tabs.open({ kind: 'object', path: choice.path })
      return
    case 'lastOpenedPage':
      return
  }
}
