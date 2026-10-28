// The Calendar page: the chrome over the view chosen in `useCalendar`, and the calendar sidebar
// (the mini month) at its right edge, open unless `ui.calendar.hideCalendarSidebar`.
import type { Target } from '@/nav/tabs'
import { useUiStore } from '@/shell/usePinned'
import { CalendarChrome } from './CalendarChrome'
import { CalendarSidePanel } from './CalendarSidePanel'
import { saveCalendarUi } from './calendarUi'
import { rangeFor } from './dates'
import { DayView } from './DayView'
import { MonthView } from './MonthView'
import { ThreeDaysView } from './ThreeDaysView'
import { WeekView } from './WeekView'
import { useCalendar, useWeekStart } from './useCalendar'

export interface CalendarPageProps {
  onOpenTarget: (t: Target) => void
}

/** Whether the calendar sidebar is open (`ui.calendar.hideCalendarSidebar` absent or false). */
export function useCalendarSidebarOpen(): boolean {
  return useUiStore((s) => s.ui.calendar?.hideCalendarSidebar) !== true
}

/** Show or hide the calendar sidebar ("Toggle calendar sidebar"), saved to `ui.json`. */
export function toggleCalendarSidebar(): Promise<void> {
  const hidden = useUiStore.getState().ui.calendar?.hideCalendarSidebar === true
  return saveCalendarUi({ hideCalendarSidebar: !hidden })
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
      {sidebarOpen && (
        <aside aria-label="Calendar sidebar" className="h-full w-[300px] shrink-0 overflow-auto border-l border-line">
          <CalendarSidePanel />
        </aside>
      )}
    </div>
  )
}
