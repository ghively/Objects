import { describe, expect, test } from 'vitest'
import type { Row } from '@/api/types'
import { FULL_VIEW_LAYOUTS } from '@/views/model'
import { TASK_SECTIONS, TASK_SECTION_KEYS, sectionRows } from './taskSections'
import { TASK_TYPE, taskRow } from './taskFixtures'

// Monday 2026-10-26, noon local.
const NOW = new Date(2026, 9, 26, 12, 0, 0)

const day = (start: string) => ({ start, resolution: 'day' as const })

const ROWS: Row[] = [
  taskRow('Tasks/Overdue.md', { status: ['Not Started'], date: day('2026-10-20') }),
  taskRow('Tasks/Today.md', { status: ['In Progress'], date: day('2026-10-26') }),
  taskRow('Tasks/Tomorrow.md', { status: ['Next Up'], date: day('2026-10-27') }),
  taskRow('Tasks/DoneToday.md', { status: ['Done'], date: day('2026-10-26'), completed: { start: '2026-10-26T09:00:00Z', resolution: 'time' } }),
  taskRow('Tasks/DoneOld.md', { status: ['Done'], date: day('2026-10-01'), completed: { start: '2026-10-02T09:00:00Z', resolution: 'time' } }),
  taskRow('Tasks/NoStatus.md', { date: day('2026-10-28') }),
  taskRow('Tasks/NoDate.md', { status: ['On Hold'] }),
  taskRow('Tasks/Deadline.md', { status: ['Not Started'], deadline: day('2026-11-05') }),
  taskRow('Tasks/DeadlineSoon.md', { status: ['Not Started'], deadline: day('2026-10-29') }),
  taskRow('Tasks/DeadlineDone.md', { status: ['Done'], deadline: day('2026-10-29') }),
  taskRow('Tasks/Recurring.md', { status: ['Not Started'], date: day('2026-10-30'), repeat: 'every week', remind: 'on the day at 09:00' }),
  taskRow('Tasks/BadRepeat.md', { status: ['Not Started'], date: day('2026-10-30'), repeat: 'weekly', remind: '15 minutes before' }),
]

const paths = (key: keyof typeof TASK_SECTIONS) => sectionRows(key, ROWS, TASK_TYPE, NOW).map((r) => r.summary.path.slice(6, -3))

describe('taskSections', () => {
  test('test sections titles and descriptions match reference', () => {
    const want: Record<string, [string, string]> = {
      status: ['Status', 'All tasks grouped by their status'],
      today: ['Today', 'All tasks relevant today'],
      inbox: ['Inbox', 'All tasks that have no status or have not been scheduled'],
      open: ['Open', 'All tasks not done yet'],
      deadline: ['Deadline', 'All open tasks with a deadline, sorted by the nearest deadline first'],
      scheduled: ['Scheduled', 'All upcoming tasks based on their date'],
      recurring: ['Recurring', 'All open tasks that repeat on a schedule, grouped by date'],
      reminders: ['Reminders', 'All open tasks with an active reminder, grouped by date'],
      tags: ['Tags', 'All tasks grouped by their tags'],
      completed: ['Completed', 'All tasks marked as done'],
    }
    expect(TASK_SECTION_KEYS).toEqual(Object.keys(want))
    for (const [key, [title, description]] of Object.entries(want)) {
      const s = TASK_SECTIONS[key as keyof typeof TASK_SECTIONS]
      expect(s.title).toBe(title)
      expect(s.description).toBe(description)
      expect(s.icon).toMatch(/^ph-/)
    }
  })

  test('test no Context section', () => {
    expect(Object.keys(TASK_SECTIONS)).not.toContain('source')
    expect(Object.values(TASK_SECTIONS).map((s) => s.title)).not.toContain('Context')
  })

  test('test status preset groups by category and defaults to kanban; the rest default to list', () => {
    const s = TASK_SECTIONS.status.preset(NOW)
    expect(s.viewDefinition.dataViewLayout).toBe('kanban')
    expect(s.groupBy).toEqual({ groups: [{ propertyId: 'status', option: 'statusCategory' }] })
    for (const key of TASK_SECTION_KEYS.filter((k) => k !== 'status')) {
      const p = TASK_SECTIONS[key].preset(NOW)
      expect(p.viewDefinition.dataViewLayout).toBe('list')
      expect((FULL_VIEW_LAYOUTS as readonly string[]).includes(p.viewDefinition.dataViewLayout)).toBe(true)
    }
    expect(paths('status')).toHaveLength(ROWS.length)
  })

  test('test today section includes overdue and today, not done', () => {
    expect(paths('today')).toEqual(['Overdue', 'Today'])
    expect(TASK_SECTIONS.today.preset(NOW).sorts).toEqual([{ propertyId: 'date', option: 'ascending' }])
  })

  test('test inbox preset: no status or no date', () => {
    expect(paths('inbox')).toEqual(['NoStatus', 'NoDate', 'Deadline', 'DeadlineSoon', 'DeadlineDone'])
  })

  test('test open preset: not done', () => {
    expect(paths('open')).not.toContain('DoneToday')
    expect(paths('open')).not.toContain('DoneOld')
    expect(paths('open')).not.toContain('DeadlineDone')
    expect(paths('open')).toContain('NoStatus')
  })

  test('test deadline preset: open with a deadline, nearest first', () => {
    expect(paths('deadline')).toEqual(['Deadline', 'DeadlineSoon'])
    expect(TASK_SECTIONS.deadline.preset(NOW).sorts).toEqual([{ propertyId: 'deadline', option: 'ascending' }])
  })

  test('test scheduled preset: open with a date, grouped by Scheduled', () => {
    expect(paths('scheduled')).toEqual(['Overdue', 'Today', 'Tomorrow', 'NoStatus', 'Recurring', 'BadRepeat'])
    expect(TASK_SECTIONS.scheduled.preset(NOW).groupBy).toEqual({ groups: [{ propertyId: 'date', option: 'scheduled' }] })
  })

  test('test recurring preset: open with a valid repeat, grouped by Scheduled', () => {
    expect(paths('recurring')).toEqual(['Recurring'])
    expect(TASK_SECTIONS.recurring.preset(NOW).groupBy).toEqual({ groups: [{ propertyId: 'date', option: 'scheduled' }] })
  })

  test('test reminders preset: open with a reminder that fits the date, grouped by Scheduled', () => {
    expect(paths('reminders')).toEqual(['Recurring'])
    expect(TASK_SECTIONS.reminders.preset(NOW).groupBy).toEqual({ groups: [{ propertyId: 'date', option: 'scheduled' }] })
  })

  test('test tags preset groups by tags', () => {
    expect(TASK_SECTIONS.tags.preset(NOW).groupBy).toEqual({ groups: [{ propertyId: 'tags', option: 'default' }] })
    expect(paths('tags')).toHaveLength(ROWS.length)
  })

  test('test completed preset: done, newest completion first', () => {
    expect(paths('completed')).toEqual(['DoneToday', 'DoneOld', 'DeadlineDone'])
    expect(TASK_SECTIONS.completed.preset(NOW).sorts).toEqual([{ propertyId: 'completed', option: 'descending' }])
  })
})
