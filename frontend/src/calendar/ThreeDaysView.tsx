// Three days ("rolling"): the anchor with the day before and after, as three equal columns split by
// 1 px dividers (`02-calendar-three-days.png`). Each column is the small day header over its daily
// note slot (`MultiDayDay`), and nothing else: the Tasks, Created and Backlinks sections are the Day view's (the
// reference and Capacities show none here). One `api.calendar` range for the three days.
import { useMemo } from 'react'
import { rangeFor, todayYmd, type Day, type WeekStart } from './dates'
import { MultiDayDay } from './MultiDayDay'
import { useCalendarRange } from './useCalendarRange'

export interface MultiDayViewProps {
  anchor: Day
  weekStart: WeekStart
}

export function ThreeDaysView({ anchor, weekStart }: MultiDayViewProps) {
  const range = useMemo(() => rangeFor('rolling', anchor, weekStart), [anchor, weekStart])
  const { data, reload } = useCalendarRange(range)
  const today = data?.today ?? todayYmd()

  return (
    <div data-testid="three-days-view" className="grid min-h-full grid-cols-3 divide-x divide-line">
      {range.days.map((day) => (
        <div key={day} data-testid="three-days-column" data-day={day} className="flex min-w-0 flex-col gap-4 px-6 pt-10 pb-24">
          <MultiDayDay
            day={day}
            today={today}
            weekStart={weekStart}
            note={data ? (data.days[day]?.dailyNote ?? null) : undefined}
            onChanged={reload}
          />
        </div>
      ))}
    </div>
  )
}
