import { describe, expect, test } from 'vitest'
import type { Row } from '@/api/types'
import { TASK_TYPE, taskRow } from './taskFixtures'
import { TASKS_MORE_LISTS, TASKS_PAGE_TABS, TASK_TABS_TEXT, dayLabel, searchTasks, tabGroups } from './taskTabs'

/** Wednesday. */
const TODAY = '2026-11-11'
const day = (start: string) => ({ start, resolution: 'day' as const })
const done = (start: string) => ({ start, resolution: 'time' as const })

const created = (r: Row, createdAt: string): Row => ({ ...r, summary: { ...r.summary, createdAt } })

const ROWS: Row[] = [
  created(taskRow('Tasks/Loose.md', { status: ['Not Started'] }), '2026-11-01T09:00:00Z'),
  created(taskRow('Tasks/Newer loose.md', { status: [] }), '2026-11-10T09:00:00Z'),
  taskRow('Tasks/Late.md', { status: ['Next Up'], date: day('2026-11-08') }),
  taskRow('Tasks/Later still.md', { status: ['Next Up'], date: day('2026-11-02') }),
  taskRow('Tasks/Now.md', { status: ['In Progress'], date: day('2026-11-11') }),
  taskRow('Tasks/Finished today.md', { status: ['Done'], date: day('2026-11-11'), completed: done('2026-11-11T08:00:00Z') }),
  taskRow('Tasks/Due today.md', { status: ['Not Started'], deadline: day('2026-11-11') }),
  taskRow('Tasks/Tomorrow.md', { status: ['Not Started'], date: day('2026-11-12') }),
  taskRow('Tasks/Friday b.md', { status: ['Not Started'], date: day('2026-11-13') }),
  taskRow('Tasks/Friday a.md', { status: ['On Hold'], date: day('2026-11-13') }),
  taskRow('Tasks/Edge.md', { status: ['Not Started'], date: day('2026-11-25') }),
  taskRow('Tasks/Far.md', { status: ['Not Started'], date: day('2026-11-26') }),
  taskRow('Tasks/Old win.md', { status: ['Done'], date: day('2026-10-01'), completed: done('2026-10-02T08:00:00Z') }),
  taskRow('Tasks/Done ahead.md', { status: ['Done'], date: day('2026-11-20'), completed: done('2026-11-09T08:00:00Z') }),
]

const names = (rows: Row[]) => rows.map((r) => r.summary.title)
const shape = (key: Parameters<typeof tabGroups>[0], rows = ROWS) =>
  tabGroups(key, rows, TASK_TYPE, TODAY).map((g) => [g.label, names(g.rows)] as const)

describe('the Tasks page tabs', () => {
  test('test the tabs are Today, Upcoming, Inbox, All, Done, and More holds the other plain lists', () => {
    expect(TASKS_PAGE_TABS.map((t) => t.label)).toEqual(['Today', 'Upcoming', 'Inbox', 'All', 'Done'])
    expect(TASKS_PAGE_TABS.map((t) => t.section)).toEqual(['today', 'scheduled', 'inbox', 'all', 'completed'])
    expect(TASKS_MORE_LISTS).toEqual(['status', 'deadline', 'recurring', 'reminders', 'tags', 'source'])
  })

  test('test Today groups Overdue then Today, done ones kept under the open ones', () => {
    expect(shape('today')).toEqual([
      ['Overdue', ['Later still', 'Late']],
      ['Today', ['Now', 'Due today', 'Finished today']],
    ])
    // No overdue task: only the Today group.
    expect(shape('today', ROWS.filter((r) => !r.summary.title.startsWith('Late')))).toEqual([['Today', ['Now', 'Due today', 'Finished today']]])
    expect(TASK_TABS_TEXT.groupHeader('Overdue', 1)).toBe('Overdue (1)')
  })

  test('test Upcoming lists the next 14 days by day, then Later', () => {
    expect(shape('upcoming')).toEqual([
      ['Tomorrow', ['Tomorrow']],
      ['Friday, Nov 13, 2026', ['Friday a', 'Friday b']],
      ['Wednesday, Nov 25, 2026', ['Edge']],
      ['Later', ['Far']],
    ])
    expect(dayLabel('2026-11-12', TODAY)).toBe('Tomorrow')
  })

  test('test Inbox is the open tasks with no date, the newest first', () => {
    expect(shape('inbox')).toEqual([[null, ['Newer loose', 'Loose', 'Due today']]])
  })

  test('test All lists every task, open ones first; Done the finished ones, latest first', () => {
    const all = shape('all')
    expect(all).toHaveLength(1)
    expect(all[0][1]).toHaveLength(ROWS.length)
    expect(all[0][1].slice(0, 4)).toEqual(['Later still', 'Late', 'Now', 'Tomorrow'])
    expect(all[0][1].slice(-3)).toEqual(['Finished today', 'Done ahead', 'Old win'])
    expect(shape('done')).toEqual([[null, ['Finished today', 'Done ahead', 'Old win']]])
  })

  test('an empty list has no groups', () => {
    expect(tabGroups('today', [], TASK_TYPE, TODAY)).toEqual([])
    expect(tabGroups('upcoming', [ROWS[0]], TASK_TYPE, TODAY)).toEqual([])
  })

  test('test search keeps the tasks whose title holds the text', () => {
    expect(names(searchTasks(ROWS, '  frIDay '))).toEqual(['Friday b', 'Friday a'])
    expect(searchTasks(ROWS, '  ')).toBe(ROWS)
  })
})
