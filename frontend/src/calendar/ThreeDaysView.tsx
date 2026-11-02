// Three days ("rolling"): the anchor with the day before and after, as three equal columns split by
// 1 px dividers (`02-calendar-three-days.png`). Each column is the small day header over its daily
// note slot, and nothing else: the Tasks, Created and Backlinks sections are the Day view's (the
// reference and Object show none here). One `api.calendar` range for the three days.
import { useMemo } from 'react'
import { DayHeader } from './DayHeader'
import { DailyNoteSlot } from './DailyNoteSlot'
import { rangeFor, todayYmd, type Day, type WeekStart } from './dates'
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
      {range.days.map((day) => {
        const cd = data?.days[day] ?? null
        return (
          <div key={day} data-testid="three-days-column" data-day={day} className="flex min-w-0 flex-col gap-4 px-6 pt-10 pb-24">
            <DayHeader day={day} today={today} weekStart={weekStart} size="sm" />
            {data && <DailyNoteSlot day={day} note={cd?.dailyNote ?? null} onChanged={reload} />}
          </div>
        )
      })}
    </div>
  )
}
