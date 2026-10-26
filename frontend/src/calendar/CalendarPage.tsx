// The Calendar page: the chrome over the view chosen in `useCalendar`.
import type { Target } from '@/nav/tabs'
import { CalendarChrome } from './CalendarChrome'
import { rangeFor } from './dates'
import { DayView } from './DayView'
import { MonthView } from './MonthView'
import { ThreeDaysView } from './ThreeDaysView'
import { WeekView } from './WeekView'
import { useCalendar, useWeekStart } from './useCalendar'

export interface CalendarPageProps {
  /** App's right panel state (the mini month lives there). */
  rightPanelOpen: boolean
  onToggleRightPanel: () => void
  onOpenTarget: (t: Target) => void
}

export function CalendarPage({ rightPanelOpen, onToggleRightPanel, onOpenTarget }: CalendarPageProps) {
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
    <div className="flex h-full min-h-0 flex-col" aria-label="Calendar">
      <CalendarChrome
        weekStart={weekStart}
        rightPanelOpen={rightPanelOpen}
        onToggleRightPanel={onToggleRightPanel}
        onOpenTarget={onOpenTarget}
      />
      <div className="min-h-0 flex-1 overflow-auto" data-view={view} data-from={range.from} data-to={range.to}>
        {body}
      </div>
    </div>
  )
}
