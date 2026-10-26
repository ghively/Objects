// The Calendar page: the chrome over the view chosen in `useCalendar`.
import type { Target } from '@/nav/tabs'
import { rangeFor, type DayRange } from './dates'
import { CalendarChrome } from './CalendarChrome'
import { DayView } from './DayView'
import { useCalendar, useWeekStart } from './useCalendar'

export interface CalendarPageProps {
  /** App's right panel state (the mini month lives there). */
  rightPanelOpen: boolean
  onToggleRightPanel: () => void
  onOpenTarget: (t: Target) => void
}

/** A view's placeholder until its task lands (Three days, Week, Month: Task 14). */
function Pending({ view, range }: { view: string; range: DayRange }) {
  return (
    <div className="p-8 text-fg-muted" data-view={view} data-from={range.from} data-to={range.to}>
      Loading results…
    </div>
  )
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
      body = <Pending view="rolling" range={range} />
      break
    case 'week':
      body = <Pending view="week" range={range} />
      break
    case 'month':
      body = <Pending view="month" range={range} />
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
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
    </div>
  )
}
