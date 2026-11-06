// M23 Task 7: deadline countdowns.
import { describe, expect, test } from 'vitest'
import type { WorkBoard } from '@/api/types'
import { workBoardItem } from '@/test/mockApi'
import boardJson from '../__fixtures__/board.json'
import { deadlines } from './deadlines'

const board = boardJson as unknown as WorkBoard

describe('deadlines', () => {
  test("Waiting on Pat's deadline is 7 days away", () => {
    expect(deadlines(board.items, board.today)).toEqual([
      { path: 'Tasks/Waiting on Pat.md', title: 'Waiting on Pat', deadline: '2026-11-12', daysLeft: 7 },
    ])
  })

  test('today to 60 days ahead, active only, soonest first', () => {
    const items = [
      workBoardItem({ path: 'Tasks/Later.md', deadline: '2027-01-04' }), // 60 days
      workBoardItem({ path: 'Tasks/Too late.md', deadline: '2027-01-05' }), // 61 days
      workBoardItem({ path: 'Tasks/Today.md', deadline: '2026-11-05' }),
      workBoardItem({ path: 'Tasks/Past.md', deadline: '2026-11-04' }),
      workBoardItem({ path: 'Tasks/Done.md', deadline: '2026-11-06', done: true, stage: 'done' }),
    ]
    expect(deadlines(items, '2026-11-05').map((d) => [d.title, d.daysLeft])).toEqual([
      ['Today', 0],
      ['Later', 60],
    ])
  })
})
