// Gene's redesign: the task sections (Inbox, Scheduled, Status, ...) as views of the Tasks dashboard,
// so the lists and the dashboard are one page over the same Task objects. Each view shows that
// section's list (`TaskSectionPanel`); Today is not here: it is the dashboard's own Today view (the
// day timeline with today's tasks). WorkPage's `import.meta.glob` finds this file.
import { createElement } from 'react'
import type { TaskSectionKey } from '@/api/types'
import { sectionCount, TaskSectionPanel } from '@/tasks/TasksPage'
import { TASK_SECTIONS, TASK_SECTION_KEYS } from '@/tasks/taskSections'
import { registerWorkView } from '../views/registry'

/** The dashboard view id of a task section. */
export const listViewId = (key: TaskSectionKey): string => `list-${key}`

/** Whether a dashboard view is one of the task lists (left out while the space hides task management). */
export const isTaskListView = (id: string): boolean => id.startsWith('list-')

/** Sections whose button shows a count (the Drive lists; the others stay quiet). */
const COUNTED: readonly TaskSectionKey[] = ['inbox']

for (const key of TASK_SECTION_KEYS) {
  // Today is the dashboard's own Today view (the day timeline with today's tasks under it).
  if (key === 'today') continue
  const section = TASK_SECTIONS[key]
  registerWorkView({
    id: listViewId(key),
    label: section.title,
    icon: section.icon,
    key: null,
    count: (_d, now) => (COUNTED.includes(key) ? sectionCount(key, now) : 0),
    Component: () => createElement(TaskSectionPanel, { sectionKey: key }),
  })
}
