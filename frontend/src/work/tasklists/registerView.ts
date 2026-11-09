// Gene's redesign: the Tasks page's sections (Inbox, Today, Scheduled, Status, ...) as views of the
// Tasks dashboard, so the lists and the dashboard are one page over the same Task objects. Each view
// shows that section's list (`TaskSectionPanel`); WorkPage's `import.meta.glob` finds this file.
import { createElement } from 'react'
import type { TaskSectionKey } from '@/api/types'
import { TaskSectionPanel } from '@/tasks/TasksPage'
import { TASK_SECTIONS, TASK_SECTION_KEYS } from '@/tasks/taskSections'
import { registerWorkView } from '../views/registry'

/** The dashboard view id of a task section. */
export const listViewId = (key: TaskSectionKey): string => `list-${key}`

for (const key of TASK_SECTION_KEYS) {
  const section = TASK_SECTIONS[key]
  registerWorkView({
    id: listViewId(key),
    label: section.title,
    icon: section.icon,
    key: null,
    count: () => 0,
    Component: () => createElement(TaskSectionPanel, { sectionKey: key }),
  })
}
