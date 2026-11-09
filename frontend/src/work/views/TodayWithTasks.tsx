// Gene's redesign, phase 2: one Today. The dashboard's day timeline (meetings, focus lines in the
// gaps, the now-line, deadline countdowns: `TodayView`) on top, and today's task list (the Today
// section: overdue and due today, not done) under it, so "what's my day" is one view. While the space
// hides task management, the list is left out and Today is the timeline alone (M23's Today).
import type { JSX } from 'react'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { TaskSectionPanel } from '@/tasks/TasksPage'
import type { WorkDataState } from '../state/useWorkData'
import { TodayView } from './TodayView'

export const TODAY_TASKS_HEADING = 'Today’s tasks'

export function TodayWithTasks({ data, now }: { data: WorkDataState; now: Date }): JSX.Element {
  const hideTasks = useSpaceInfo((s) => s.space?.hideTaskManagement ?? false)
  if (hideTasks) {
    return (
      <div data-work-today="" className="flex min-w-0 flex-col gap-6">
        <TodayView data={data} now={now} />
      </div>
    )
  }
  return (
    <div data-work-today="" className="flex min-w-0 flex-col gap-6">
      <TodayView data={data} now={now} />
      <section aria-label={TODAY_TASKS_HEADING} className="flex flex-col gap-2">
        <h3 className="text-[15px] font-semibold text-fg">{TODAY_TASKS_HEADING}</h3>
        <TaskSectionPanel sectionKey="today" />
      </section>
    </div>
  )
}
