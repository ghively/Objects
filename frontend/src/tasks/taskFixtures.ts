// Test fixtures for the task modules: the basic Task type with the fields the server adds to it
// (M4 Task 3), as the API returns it. Imported by tests only.
import type { DateConstraints, Row } from '@/api/types'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'

/** A day-resolution date with no end, as Date and Deadline are defined. */
const dayDate = (extra: Partial<DateConstraints> = {}): { constraints: DateConstraints } => ({
  constraints: { endTimeSettings: 'notAllowed', resolutionPreference: 'day', ...extra },
})

export const TASK_TYPE = typeDef({
  id: 'task',
  name: 'Task',
  pluralName: 'Tasks',
  basic: true,
  propertyDefinitions: [
    propertyDef({ id: 'title', type: 'entity_title', name: 'Title' }),
    propertyDef({
      id: 'status',
      type: 'label',
      name: 'Status',
      options: {
        isStatus: true,
        isArray: false,
        set: [
          { id: 's1', text: 'Not Started', color: 'red', icon: null, statusCategory: 'not-started' },
          { id: 's2', text: 'Next Up', color: 'yellow', icon: null, statusCategory: 'not-started' },
          { id: 's3', text: 'In Progress', color: 'blue', icon: null, statusCategory: 'in-progress' },
          { id: 's4', text: 'On Hold', color: 'pink', icon: null, statusCategory: 'blocked' },
          { id: 's5', text: 'Done', color: 'green', icon: null, statusCategory: 'done' },
        ],
      },
    }),
    propertyDef({
      id: 'priority',
      type: 'label',
      name: 'Priority',
      icon: { type: 'iconify', val: 'ph-flag' },
      options: {
        isArray: false,
        set: [
          { id: 'p1', text: 'Low', color: 'amber', icon: null },
          { id: 'p2', text: 'Medium', color: 'orange', icon: null },
          { id: 'p3', text: 'High', color: 'red', icon: null },
        ],
      },
    }),
    propertyDef({
      id: 'date',
      type: 'datetimeSimple',
      name: 'Date',
      options: dayDate({ supportsReminders: true }),
    }),
    propertyDef({ id: 'deadline', type: 'datetimeSimple', name: 'Deadline', options: dayDate() }),
    propertyDef({ id: 'completed', type: 'datetimeSimple', name: 'Completed', visibility: 'hidden', options: { constraints: { resolutionPreference: 'time' } } }),
    propertyDef({ id: 'repeat', type: 'text', name: 'Repeat', visibility: 'hidden' }),
    propertyDef({ id: 'remind', type: 'text', name: 'Remind', visibility: 'hidden' }),
  ],
})

/** A Task row; `values` are merged over empty Task values. */
export function taskRow(path: string, values: Record<string, unknown> = {}, version = 'v1'): Row {
  return row({
    summary: objectSummary({ path, type: 'task' }),
    version,
    values: { status: [], priority: [], date: null, deadline: null, completed: null, repeat: null, remind: null, ...values },
  })
}
