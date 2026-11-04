// The Day view: header, quick-create chips, filter tabs and the day's sections (the Daily note's
// header pill holds Reviewed and the note's `…` menu) in
// one scrolling column at the main content width (50rem). One `api.calendar` range for
// the day and one `api.rows` call per load of it.
import { useEffect, useMemo, useState } from 'react'
import type { Target } from '@/nav/tabs'
import { DayHeader, ReviewedButton } from './DayHeader'
import { DaySections, DayTabs, dayTabs, useCalendarRows, type DayFilter } from './DaySections'
import { QuickCreateChips } from './QuickCreateChips'
import { todayYmd, type Day } from './dates'
import { useCalendarRange } from './useCalendarRange'
import { useWeekStart } from './useCalendar'

export interface DayViewProps {
  day: Day
  onOpenTarget?: (t: Target) => void
}

export function DayView({ day }: DayViewProps) {
  const weekStart = useWeekStart()
  const range = useMemo(() => ({ from: day, to: day }), [day])
  const { data, reload } = useCalendarRange(range)
  const rows = useCalendarRows(data)
  const cd = data?.days[day] ?? null
  const today = data?.today ?? todayYmd()
  const [filter, setFilter] = useState<DayFilter>('all')

  const tabs = dayTabs(day, today, cd)
  const active = tabs.some((t) => t.key === filter) ? filter : 'all'
  useEffect(() => {
    if (active !== filter) setFilter(active)
  }, [active, filter])

  const note = cd?.dailyNote ?? null
  return (
    <div data-testid="day-view" data-day={day} className="mx-auto flex w-full max-w-[50rem] flex-col gap-5 px-6 pt-10 pb-24">
      <DayHeader day={day} today={today} weekStart={weekStart} />
      <QuickCreateChips day={day} calendarDay={cd} summaries={data?.summaries ?? {}} onCreated={reload} />
      <DayTabs tabs={tabs} active={active} onSelect={setFilter} />
      <DaySections
        day={day}
        today={today}
        calendarDay={cd}
        rows={rows}
        filter={active}
        onChanged={reload}
        dailyNoteExtra={<ReviewedButton note={note} version={note ? rows.byPath.get(note.path)?.version : undefined} onWritten={reload} />}
      />
    </div>
  )
}
