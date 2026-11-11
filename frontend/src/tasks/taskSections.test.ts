import { describe, expect, test } from 'vitest'
import type { Row } from '@/api/types'
import { FULL_VIEW_LAYOUTS } from '@/views/model'
import { DEFAULT_TASK_SECTION, TASK_SECTIONS, TASK_SECTION_KEYS, sectionRows, todayOpenCount } from './taskSections'
import { groupRows } from '@/views/group'
import { useSettings } from '@/settings/useSettings'
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
  test('test sections titles and descriptions match the catalog', () => {
    // In tab order: Inbox, Today, Scheduled, Status, Context, Tags, Open, Deadline,
    // Recurring, Reminders, Completed, then All.
    const want: Record<string, [string, string]> = {
      inbox: ['Inbox', 'Tasks with no status or no date yet'],
      today: ['Today', 'Tasks that matter today'],
      scheduled: ['Scheduled', 'Tasks coming up, ordered by date'],
      status: ['Status', 'Every task, grouped by status'],
      source: ['Context', 'Tasks grouped by the note that mentions them.'],
      tags: ['Tags', 'Every task, grouped by tag'],
      open: ['Open', 'All tasks not done yet'],
      deadline: ['Deadline', 'Open tasks that have a deadline, soonest first'],
      recurring: ['Recurring', 'Open repeating tasks, grouped by date'],
      reminders: ['Reminders', 'Open tasks with a reminder set, grouped by date'],
      completed: ['Completed', 'Tasks that are finished'],
      all: ['All', 'Every task, ready to filter and sort.'],
    }
    expect(TASK_SECTION_KEYS).toEqual(Object.keys(want))
    expect(DEFAULT_TASK_SECTION).toBe('inbox')
    for (const [key, [title, description]] of Object.entries(want)) {
      const s = TASK_SECTIONS[key as keyof typeof TASK_SECTIONS]
      expect(s.title).toBe(title)
      expect(s.description).toBe(description)
      expect(s.icon).toMatch(/^ph-/)
    }
  })

  test('test Context section groups open tasks by linking objects', () => {
    // Open tasks only, in a list grouped by the backlinks property.
    expect(paths('source')).toEqual(paths('open'))
    const preset = TASK_SECTIONS.source.preset(NOW)
    expect(preset.viewDefinition.dataViewLayout).toBe('list')
    expect(preset.groupBy).toEqual({ groups: [{ propertyId: 'backlinks', option: 'default' }] })
    // The grouping: one group per linking object, "Other" for tasks nothing links to.
    const withLinks = [
      taskRow('Tasks/A.md', { status: ['Not Started'], backlinks: [{ target: 'Plan', path: 'Pages/Plan.md' }] }),
      taskRow('Tasks/B.md', {
        status: ['In Progress'],
        backlinks: [
          { target: 'Plan', path: 'Pages/Plan.md' },
          { target: 'Ada', path: 'People/Ada.md' },
        ],
      }),
      taskRow('Tasks/C.md', { status: ['Not Started'], backlinks: [] }),
      taskRow('Tasks/D.md', { status: ['Done'], backlinks: [{ target: 'Plan', path: 'Pages/Plan.md' }] }),
    ]
    const shown = sectionRows('source', withLinks, TASK_TYPE, NOW)
    expect(shown.map((r) => r.summary.path)).toEqual(['Tasks/A.md', 'Tasks/B.md', 'Tasks/C.md'])
    const ctx = { types: [TASK_TYPE], collections: [], tagIdsToTitles: {}, now: NOW, entityTitles: { 'Pages/Plan.md': 'Plan' } }
    const { groups } = groupRows(shown, preset.groupBy, undefined, ctx)
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.summary.path.slice(6, -3))])).toEqual([
      ['Ada', ['B']],
      ['Plan', ['A', 'B']],
      ['Other', ['C']],
    ])
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

  test('T1: today follows the Calendar Day view: date covers today, deadline today, open overdue; done ones stay', () => {
    const rows = [
      ...ROWS,
      taskRow('Tasks/DeadlineToday.md', { status: ['Not Started'], deadline: day('2026-10-26') }),
      taskRow('Tasks/DoneDeadlineToday.md', { status: ['Done'], deadline: day('2026-10-26') }),
      taskRow('Tasks/Range.md', { status: ['Next Up'], date: { start: '2026-10-25', end: '2026-10-27', resolution: 'day' } }),
      // A timed range ending at 00:00 local leaves that day out (the Calendar's rule); done, so not overdue.
      taskRow('Tasks/EndsAtMidnight.md', {
        status: ['Done'],
        date: { start: new Date(2026, 9, 25, 20, 0).toISOString(), end: new Date(2026, 9, 26, 0, 0).toISOString(), resolution: 'time' },
      }),
      taskRow('Tasks/TimedToday.md', { status: ['Not Started'], date: { start: new Date(2026, 9, 26, 15, 30).toISOString(), resolution: 'time' } }),
    ]
    const shown = sectionRows('today', rows, TASK_TYPE, NOW).map((r) => r.summary.path.slice(6, -3))
    expect(shown).toEqual(['Overdue', 'Today', 'DoneToday', 'DeadlineToday', 'DoneDeadlineToday', 'Range', 'TimedToday'])
    // The count badge is the list's open ones ("N open, M done").
    expect(todayOpenCount(rows, TASK_TYPE, NOW)).toBe(5)
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

  test('test all section: every task', () => {
    expect(paths('all')).toHaveLength(ROWS.length)
  })

  test('test completed preset: done, newest completion first', () => {
    expect(paths('completed')).toEqual(['DoneToday', 'DoneOld', 'DeadlineDone'])
    expect(TASK_SECTIONS.completed.preset(NOW).sorts).toEqual([{ propertyId: 'completed', option: 'descending' }])
  })
})

describe('taskSections in the Time zone setting', () => {
  test('Today holds the tasks of today in the Time zone setting', () => {
    const settings = useSettings.getState().settings
    useSettings.setState({ settings: { ...settings, timeZone: 'Pacific/Auckland' } })
    try {
      // 2026-10-29T01:00Z is 29 Oct 14:00 in Auckland (still the 28th west of UTC).
      const now = new Date('2026-10-29T01:00:00Z')
      const rows = [taskRow('Tasks/Due.md', { status: ['Not Started'], date: day('2026-10-29') })]
      expect(sectionRows('today', rows, TASK_TYPE, now).map((r) => r.summary.path)).toEqual(['Tasks/Due.md'])
    } finally {
      useSettings.setState({ settings })
    }
  })
})
