// Week: seven stacked day blocks, one per day of the anchor's week in order, each with its small
// header and daily note slot (no sections, no chips; `MultiDayDay`). The anchor's block (`week-<day>`) is scrolled
// into view when the view opens or the anchor changes. One `api.calendar` range for the week.
import { useEffect, useMemo } from 'react'
import { rangeFor, todayYmd } from './dates'
import { MultiDayDay } from './MultiDayDay'
import type { MultiDayViewProps } from './ThreeDaysView'
import { useCalendarRange } from './useCalendarRange'

export function WeekView({ anchor, weekStart }: MultiDayViewProps) {
  const range = useMemo(() => rangeFor('week', anchor, weekStart), [anchor, weekStart])
  const { data, reload } = useCalendarRange(range)
  const today = data?.today ?? todayYmd()

  useEffect(() => {
    document.getElementById(`week-${anchor}`)?.scrollIntoView?.({ block: 'start' })
  }, [anchor])

  return (
    <div data-testid="week-view" className="mx-auto flex w-full max-w-[50rem] flex-col gap-10 px-6 pt-10 pb-24">
      {range.days.map((day) => (
        <section key={day} id={`week-${day}`} data-testid="week-day" data-day={day} className="flex scroll-mt-4 flex-col gap-4">
          <MultiDayDay
            day={day}
            today={today}
            weekStart={weekStart}
            note={data ? (data.days[day]?.dailyNote ?? null) : undefined}
            onChanged={reload}
          />
        </section>
      ))}
    </div>
  )
}
