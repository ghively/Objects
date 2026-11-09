// Gene's redesign, phase 2: one Today. The dashboard's day timeline (meetings, focus lines in the
// gaps, the now-line, deadline countdowns: `TodayView`) on top, and today's task list under it, so
// "what's my day" is one view. Decision T1 (option B): the list is the Calendar Day view's Tasks
// section for today (`DayTasksSection`: date covers today, deadline today, Overdue (n), done ones
// struck, "N open, M done"), so both pages list the same tasks, with "Open in Calendar" under it.
// While the space hides task management, the list is left out and Today is the timeline alone
// (M23's Today).
import { useMemo, type JSX } from 'react'
import { Icon } from '@/components/Icon'
import { DayTasksSection, taskPaths, useCalendarRows } from '@/calendar/DaySections'
import { useCalendar } from '@/calendar/useCalendar'
import { useCalendarRange } from '@/calendar/useCalendarRange'
import { useZonedToday } from '@/lib/zonedShell'
import { useTabs } from '@/nav/tabs'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import type { WorkDataState } from '../state/useWorkData'
import { TodayView } from './TodayView'

export const TODAY_TASKS_HEADING = 'Today’s tasks'
/** Our string (decision T1). */
export const OPEN_IN_CALENDAR = 'Open in Calendar'

/** The Calendar's Day view on today (Ctrl/Cmd+click: in a new tab). */
export function openCalendarToday(newTab = false): void {
  const calendar = useCalendar.getState()
  calendar.setView('day')
  calendar.today()
  useTabs.getState().open({ kind: 'calendar' }, { newTab })
}

function TodayTasks() {
  const today = useZonedToday()
  const range = useMemo(() => ({ from: today, to: today }), [today])
  const { data, reload } = useCalendarRange(range)
  const rows = useCalendarRows(data, taskPaths)
  const day = data?.today ?? today
  return (
    <div data-today-tasks="" className="flex flex-col gap-2">
      <DayTasksSection
        day={day}
        today={day}
        calendarDay={data?.days[day] ?? null}
        rows={rows}
        onChanged={reload}
        label={TODAY_TASKS_HEADING}
      />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={(e) => openCalendarToday(e.ctrlKey || e.metaKey)}
          className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
        >
          <Icon name="ph-calendar" size={14} />
          {OPEN_IN_CALENDAR}
        </button>
      </div>
    </div>
  )
}

export function TodayWithTasks({ data, now }: { data: WorkDataState; now: Date }): JSX.Element {
  const hideTasks = useSpaceInfo((s) => s.space?.hideTaskManagement ?? false)
  return (
    <div data-work-today="" className="flex min-w-0 flex-col gap-6">
      <TodayView data={data} now={now} />
      {!hideTasks && <TodayTasks />}
    </div>
  )
}
