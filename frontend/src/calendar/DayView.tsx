// The Day view: header, quick-create chips, filter tabs and the day's sections (the Daily note's
// header pill holds Reviewed and the note's `…` menu; on today the header links to Tasks › Today,
// decision T1; M32: the plain Tasks page's Today list, or Work's Today while Work is on) in
// one scrolling column at the main content width (50rem). One `api.calendar` range for
// the day and one `api.rows` call per load of it.
import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import { TASKS, WORK } from '@/lib/words'
import { useTabs, type Target } from '@/nav/tabs'
import { useTasksHidden } from '@/tasks/tasksHidden'
import { useWorkOn } from '@/work/useWorkOn'
import { DayHeader, ReviewedButton } from './DayHeader'
import { DaySections, DayTabs, dayTabs, useCalendarRows, type DayFilter } from './DaySections'
import { QuickCreateChips } from './QuickCreateChips'
import { todayYmd, type Day } from './dates'
import { useCalendarRange } from './useCalendarRange'
import { useWeekStart } from './useCalendar'

/**
 * The header's link to today's task list, on today only (decision T1; it read "Tasks dashboard").
 * M32: "Open Tasks" opens the Tasks page on its Today list; while Work is on for the space it reads
 * "Open Work" and opens the Work page's Today, as before. Both are the `work` target on `today`: with
 * Work off the app shows the Tasks page's Today list for it. Not shown while the space hides Tasks.
 */
export const TODAYS_TASKS_LINK = { tasks: `Open ${TASKS}`, work: `Open ${WORK}` } as const

/** Today's task list (Ctrl/Cmd+click: in a new tab). */
function TodaysTasksLink() {
  const workOn = useWorkOn()
  const hidden = useTasksHidden()
  if (hidden) return null
  return (
    <button
      type="button"
      onClick={(e) => useTabs.getState().open({ kind: 'work', view: 'today' }, { newTab: e.ctrlKey || e.metaKey })}
      className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
    >
      <Icon name={workOn ? 'ph-briefcase' : 'ph-check-circle'} size={14} />
      {workOn ? TODAYS_TASKS_LINK.work : TODAYS_TASKS_LINK.tasks}
    </button>
  )
}

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
      <DayHeader day={day} today={today} weekStart={weekStart} aside={day === today ? <TodaysTasksLink /> : undefined} />
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
