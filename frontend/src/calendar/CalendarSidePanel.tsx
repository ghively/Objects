// The calendar sidebar (the mini month), rendered by `CalendarPage` at its right edge.
import { todayYmd } from './dates'
import { MiniMonth } from './MiniMonth'
import { useCalendar, useWeekStart } from './useCalendar'

export function CalendarSidePanel() {
  const anchor = useCalendar((s) => s.anchor)
  const setAnchor = useCalendar((s) => s.setAnchor)
  const weekStart = useWeekStart()
  // Clicking a day sets the anchor; the view is kept, so Month and Week show the period holding it.
  return <MiniMonth anchor={anchor} today={todayYmd()} weekStart={weekStart} onSelect={setAnchor} />
}
