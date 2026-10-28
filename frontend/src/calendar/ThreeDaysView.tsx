// Three days ("rolling"): the anchor with the day before and after, as three equal columns split by
// 1 px dividers (`02-calendar-three-days.png`). Each column is a compact day: the small header, its
// daily note slot and the day's sections, without the chips and filter tabs. One `api.calendar`
// range for the three days and one `api.rows` call per load of it.
import { useMemo } from 'react'
import { DayHeader } from './DayHeader'
import { DailyNoteSlot } from './DailyNoteSlot'
import { DaySections, useCalendarRows } from './DaySections'
import { rangeFor, todayYmd, type Day, type WeekStart } from './dates'
import { useCalendarRange } from './useCalendarRange'

export interface MultiDayViewProps {
  anchor: Day
  weekStart: WeekStart
}

export function ThreeDaysView({ anchor, weekStart }: MultiDayViewProps) {
  const range = useMemo(() => rangeFor('rolling', anchor, weekStart), [anchor, weekStart])
  const { data, reload } = useCalendarRange(range)
  const rows = useCalendarRows(data)
  const today = data?.today ?? todayYmd()

  return (
    <div data-testid="three-days-view" className="grid min-h-full grid-cols-3 divide-x divide-line">
      {range.days.map((day) => {
        const cd = data?.days[day] ?? null
        return (
          <div key={day} data-testid="three-days-column" data-day={day} className="flex min-w-0 flex-col gap-4 px-6 pt-10 pb-24">
            <DayHeader day={day} today={today} weekStart={weekStart} size="sm" />
            {data && <DailyNoteSlot day={day} note={cd?.dailyNote ?? null} onChanged={reload} />}
            <DaySections day={day} today={today} calendarDay={cd} rows={rows} showDailyNote={false} onChanged={reload} />
          </div>
        )
      })}
    </div>
  )
}
