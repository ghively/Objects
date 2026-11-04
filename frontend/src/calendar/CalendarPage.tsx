// The Calendar page: the chrome over the view chosen in `useCalendar`, and in the Day view the
// calendar sidebar (the mini month) at its right edge, open unless `ui.calendar.hideCalendarSidebar`.
// The other views (Month, Week, Three days) have no sidebar.
import type { Target } from '@/nav/tabs'
import { CalendarChrome } from './CalendarChrome'
import { CalendarSidePanel } from './CalendarSidePanel'
import { toggleCalendarSidebar, useCalendarSidebarOpen } from './calendarUi'
import { rangeFor } from './dates'
import { DayView } from './DayView'
import { MonthView } from './MonthView'
import { ThreeDaysView } from './ThreeDaysView'
import { WeekView } from './WeekView'
import { useCalendar, useWeekStart } from './useCalendar'

// The sidebar switch lives in `calendarUi` (the shell's shortcut uses it without this page's code).
export { toggleCalendarSidebar, useCalendarSidebarOpen }

export interface CalendarPageProps {
  onOpenTarget: (t: Target) => void
}

export function CalendarPage({ onOpenTarget }: CalendarPageProps) {
  const sidebarOpen = useCalendarSidebarOpen()
  const view = useCalendar((s) => s.view)
  const anchor = useCalendar((s) => s.anchor)
  const weekStart = useWeekStart()
  const range = rangeFor(view, anchor, weekStart)

  let body
  switch (view) {
    case 'day':
      body = <DayView day={anchor} onOpenTarget={onOpenTarget} />
      break
    case 'rolling':
      body = <ThreeDaysView anchor={anchor} weekStart={weekStart} />
      break
    case 'week':
      body = <WeekView anchor={anchor} weekStart={weekStart} />
      break
    case 'month':
      body = <MonthView anchor={anchor} weekStart={weekStart} />
      break
  }

  return (
    <div className="flex h-full min-h-0" aria-label="Calendar">
      <div className="flex min-w-0 flex-1 flex-col">
        <CalendarChrome
          weekStart={weekStart}
          rightPanelOpen={sidebarOpen}
          onToggleRightPanel={() => void toggleCalendarSidebar()}
          onOpenTarget={onOpenTarget}
        />
        <div className="min-h-0 flex-1 overflow-auto" data-view={view} data-from={range.from} data-to={range.to}>
          {body}
        </div>
      </div>
      {sidebarOpen && view === 'day' && (
        <aside aria-label="Calendar sidebar" className="h-full w-[26rem] shrink-0 overflow-auto border-l border-line">
          <CalendarSidePanel />
        </aside>
      )}
    </div>
  )
}
