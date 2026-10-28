import { describe, expect, test } from 'vitest'
import { row, typeDef } from '@/test/mockApi'
import { TASK_TYPE } from './taskFixtures'
import { categoryOf, firstOptionOf, isOpen, STATUS_CATEGORIES, statusOptionsByCategory } from './statusCategory'

const r = (status: unknown) => row({ path: 'Tasks/A.md', values: { status } })

describe('statusCategory', () => {
  test('categories in order with Object labels', () => {
    expect(STATUS_CATEGORIES.map((c) => c.label)).toEqual(['Not started', 'In progress', 'Blocked', 'Done'])
  })

  test('test categoryOf unknown status counts as not-started; no status is open', () => {
    expect(categoryOf(r(['Whatever']), TASK_TYPE)).toBe('not-started')
    expect(categoryOf(r(null), TASK_TYPE)).toBe('not-started')
    expect(categoryOf(r([]), TASK_TYPE)).toBe('not-started')
    expect(isOpen(r(null), TASK_TYPE)).toBe(true)
    expect(categoryOf(r(['On Hold']), TASK_TYPE)).toBe('blocked')
    expect(isOpen(r(['Done']), TASK_TYPE)).toBe(false)
    expect(isOpen(r(['In Progress']), TASK_TYPE)).toBe(true)
  })

  test('options by category and first option of a category', () => {
    const groups = statusOptionsByCategory(TASK_TYPE)
    expect(groups.map((g) => g.options.map((o) => o.text))).toEqual([['Not Started', 'Next Up'], ['In Progress'], ['On Hold'], ['Done']])
    expect(firstOptionOf(TASK_TYPE, 'not-started')?.text).toBe('Not Started')
    expect(firstOptionOf(TASK_TYPE, 'done')?.text).toBe('Done')
    expect(firstOptionOf(typeDef({ id: 'x' }), 'done')).toBeUndefined()
  })
})
