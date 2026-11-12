import { describe, expect, test } from 'vitest'
import type { Row } from '@/api/types'
import { TASK_TYPE, taskRow } from './taskFixtures'
import { TASKS_MORE_LISTS, TASKS_PAGE_TABS, TASK_TABS_TEXT, dayLabel, deadlineDayOf, searchTasks, tabGroups, taskPlace } from './taskTabs'

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

  // M33 (choice 6): was "…the open tasks with no date", which listed "Due today" (a deadline, no
  // date) here as well as under Today. A task with a deadline is placed by it, so it is not here.
  test('test Inbox is the open tasks with no date and no deadline, the newest first', () => {
    expect(shape('inbox')).toEqual([[null, ['Newer loose', 'Loose']]])
    expect(TASK_TABS_TEXT.empty.inbox).toBe('No tasks without a date or a deadline')
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

// M33 (choice 6): a task with only a deadline is listed where its deadline puts it.
describe('a task with a deadline and no date (M33)', () => {
  const DEADLINES: Row[] = [
    taskRow('Tasks/Missed.md', { status: ['Not Started'], deadline: day('2026-11-04') }),
    taskRow('Tasks/Missed long ago.md', { status: ['Next Up'], deadline: day('2026-10-01') }),
    taskRow('Tasks/Missed the same day as Late.md', { status: ['Next Up'], deadline: day('2026-11-08') }),
    taskRow('Tasks/Due Friday.md', { status: ['Not Started'], deadline: day('2026-11-13') }),
    taskRow('Tasks/Also due Friday.md', { status: ['Not Started'], deadline: day('2026-11-13') }),
    taskRow('Tasks/Due Saturday.md', { status: ['Not Started'], deadline: day('2026-11-14') }),
    taskRow('Tasks/Due on the edge.md', { status: ['Not Started'], deadline: day('2026-11-25') }),
    taskRow('Tasks/Due next month.md', { status: ['Not Started'], deadline: day('2026-12-11') }),
    taskRow('Tasks/Due the day Far is.md', { status: ['Not Started'], deadline: day('2026-11-26') }),
    // A date places the task; its deadline does not move it.
    taskRow('Tasks/Planned, due later.md', { status: ['Not Started'], date: day('2026-11-12'), deadline: day('2026-11-20') }),
    taskRow('Tasks/Planned, deadline missed.md', { status: ['Not Started'], date: day('2026-11-12'), deadline: day('2026-11-04') }),
    taskRow('Tasks/Done, was due.md', { status: ['Done'], deadline: day('2026-11-04'), completed: done('2026-11-03T08:00:00Z') }),
    taskRow('Tasks/Done, due Friday.md', { status: ['Done'], deadline: day('2026-11-13'), completed: done('2026-11-05T08:00:00Z') }),
  ]
  const ALL = [...ROWS, ...DEADLINES]

  test("test a passed deadline puts the task under Today's Overdue, after the dated ones of its day", () => {
    expect(shape('today', ALL)).toEqual([
      ['Overdue', ['Missed long ago', 'Later still', 'Missed', 'Late', 'Missed the same day as Late']],
      ['Today', ['Now', 'Due today', 'Finished today']],
    ])
    // A done task's passed deadline lists it nowhere but Done (and All).
    expect(shape('done', ALL)[0][1]).toEqual(expect.arrayContaining(['Done, was due', 'Done, due Friday']))
  })

  test('test a coming deadline puts the task on its day in Upcoming, after the dated ones, and beyond 14 days under Later', () => {
    expect(shape('upcoming', ALL)).toEqual([
      ['Tomorrow', ['Planned, deadline missed', 'Planned, due later', 'Tomorrow']],
      ['Friday, Nov 13, 2026', ['Friday a', 'Friday b', 'Also due Friday', 'Due Friday']],
      ['Saturday, Nov 14, 2026', ['Due Saturday']],
      ['Wednesday, Nov 25, 2026', ['Edge', 'Due on the edge']],
      ['Later', ['Far', 'Due the day Far is', 'Due next month']],
    ])
  })

  test('test a task with a deadline is not in Inbox; All still lists every task', () => {
    expect(shape('inbox', ALL)).toEqual([[null, ['Newer loose', 'Loose']]])
    const all = shape('all', ALL)
    expect(all).toHaveLength(1)
    expect(all[0][1]).toHaveLength(ALL.length)
    expect([...all[0][1]].sort()).toEqual(names(ALL).sort())
  })

  test("test the groups say which rows their deadline placed (their chip is the deadline's)", () => {
    const marked = (key: Parameters<typeof tabGroups>[0]) =>
      tabGroups(key, ALL, TASK_TYPE, TODAY).map((g) => [g.label, g.rows.filter((r) => g.deadlinePaths?.has(r.summary.path)).map((r) => r.summary.title)] as const)
    expect(marked('today')).toEqual([
      ['Overdue', ['Missed long ago', 'Missed', 'Missed the same day as Late']],
      ['Today', ['Due today']],
    ])
    expect(marked('upcoming')).toEqual([
      ['Tomorrow', []],
      ['Friday, Nov 13, 2026', ['Also due Friday', 'Due Friday']],
      ['Saturday, Nov 14, 2026', ['Due Saturday']],
      ['Wednesday, Nov 25, 2026', ['Due on the edge']],
      ['Later', ['Due the day Far is', 'Due next month']],
    ])
    // Elsewhere the rows keep their date chip.
    for (const key of ['inbox', 'all', 'done'] as const) {
      for (const g of tabGroups(key, ALL, TASK_TYPE, TODAY)) expect(g.deadlinePaths?.size ?? 0).toBe(0)
    }
    expect(deadlineDayOf(DEADLINES[0])).toBe('2026-11-04')
    // With a date the deadline does not place the task; without a deadline there is no day.
    expect(deadlineDayOf(DEADLINES[9])).toBeNull()
    expect(deadlineDayOf(ROWS[0])).toBeNull()
  })

  test('test a task planned for later whose deadline is today is on Today only', () => {
    const row = taskRow('Tasks/Planned Friday, due today.md', { status: ['Not Started'], date: day('2026-11-13'), deadline: day('2026-11-11') })
    expect(shape('today', [row])).toEqual([['Today', ['Planned Friday, due today']]])
    expect(shape('upcoming', [row])).toEqual([])
    expect(shape('inbox', [row])).toEqual([])
    // Listed by its deadline, but it has a date: the chip stays the date's.
    expect(tabGroups('today', [row], TASK_TYPE, TODAY)[0].deadlinePaths?.size ?? 0).toBe(0)
  })

  test('test every not-done task is in exactly one of Today, Upcoming and Inbox', () => {
    const dates = { none: undefined, past: '2026-11-03', today: TODAY, future: '2026-11-17' }
    const deadlines = { none: undefined, past: '2026-11-02', today: TODAY, near: '2026-11-16', far: '2026-12-20' }
    // Where each combination is listed: `date/deadline` -> the list.
    const expected: Record<string, 'today' | 'upcoming' | 'inbox'> = {
      'none/none': 'inbox',
      'none/past': 'today',
      'none/today': 'today',
      'none/near': 'upcoming',
      'none/far': 'upcoming',
      'past/none': 'today',
      'past/past': 'today',
      'past/today': 'today',
      'past/near': 'today',
      'past/far': 'today',
      'today/none': 'today',
      'today/past': 'today',
      'today/today': 'today',
      'today/near': 'today',
      'today/far': 'today',
      'future/none': 'upcoming',
      'future/past': 'upcoming',
      // The one a date does not place: its deadline is today, so it is on Today (and only there).
      'future/today': 'today',
      'future/near': 'upcoming',
      'future/far': 'upcoming',
    }
    const rows: Row[] = []
    for (const [d, date] of Object.entries(dates)) {
      for (const [l, deadline] of Object.entries(deadlines)) {
        for (const status of ['Not Started', 'In Progress', 'On Hold']) {
          rows.push(
            taskRow(`Tasks/${d}-${l}-${status}.md`, {
              status: [status],
              ...(date ? { date: day(date) } : {}),
              ...(deadline ? { deadline: day(deadline) } : {}),
            }),
          )
        }
      }
    }
    expect(rows).toHaveLength(4 * 5 * 3)
    const listed = (key: 'today' | 'upcoming' | 'inbox') => new Set(tabGroups(key, rows, TASK_TYPE, TODAY).flatMap((g) => g.rows.map((r) => r.summary.path)))
    const lists = { today: listed('today'), upcoming: listed('upcoming'), inbox: listed('inbox') }
    for (const r of rows) {
      const [d, l] = r.summary.title.split('-')
      const inLists = (Object.keys(lists) as (keyof typeof lists)[]).filter((k) => lists[k].has(r.summary.path))
      expect([r.summary.title, inLists]).toEqual([r.summary.title, [expected[`${d}/${l}`]]])
      expect(taskPlace(r, TASK_TYPE, TODAY)?.list).toBe(expected[`${d}/${l}`])
    }
    // Each row is listed once within its list, too.
    for (const key of ['today', 'upcoming', 'inbox'] as const) {
      const paths = tabGroups(key, rows, TASK_TYPE, TODAY).flatMap((g) => g.rows.map((r) => r.summary.path))
      expect(new Set(paths).size).toBe(paths.length)
    }
    // Which group: a passed date or a passed deadline alone is Overdue; a deadline today is Today.
    const place = (title: string) => taskPlace(rows.find((r) => r.summary.title === title)!, TASK_TYPE, TODAY)
    expect(place('none-past-Not Started')).toMatchObject({ list: 'today', overdue: true, byDeadline: true })
    expect(place('none-today-Not Started')).toMatchObject({ list: 'today', overdue: false, byDeadline: true })
    expect(place('none-near-Not Started')).toMatchObject({ list: 'upcoming', day: '2026-11-16', byDeadline: true })
    expect(place('future-past-Not Started')).toMatchObject({ list: 'upcoming', day: '2026-11-17', byDeadline: false })
    expect(place('past-far-Not Started')).toMatchObject({ list: 'today', overdue: true, byDeadline: false })
  })

  test('test a done task is on none of the three, except Today while its date or deadline is today', () => {
    const doneRow = (name: string, values: Record<string, unknown>) => taskRow(`Tasks/${name}.md`, { status: ['Done'], ...values })
    const rows = [
      doneRow('plain', {}),
      doneRow('was due', { deadline: day('2026-11-02') }),
      doneRow('due soon', { deadline: day('2026-11-16') }),
      doneRow('was planned', { date: day('2026-11-03') }),
      doneRow('planned ahead', { date: day('2026-11-17') }),
      doneRow('due today', { deadline: day(TODAY) }),
      doneRow('planned today', { date: day(TODAY) }),
    ]
    expect(shape('today', rows)).toEqual([['Today', ['planned today', 'due today']]])
    expect(shape('upcoming', rows)).toEqual([])
    expect(shape('inbox', rows)).toEqual([])
    expect(rows.map((r) => taskPlace(r, TASK_TYPE, TODAY)?.list ?? null)).toEqual([null, null, null, null, null, 'today', 'today'])
  })
})
