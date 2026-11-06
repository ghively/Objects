// M23 Task 7: Everything's sort.
import { describe, expect, test } from 'vitest'
import type { WorkBoard } from '@/api/types'
import { workBoardItem } from '@/test/mockApi'
import boardJson from '../__fixtures__/board.json'
import { everythingRows } from './everything'

const board = boardJson as unknown as WorkBoard
const NOW = new Date('2026-11-05T10:00:00.000Z')
const titles = (list: { title: string }[]) => list.map((i) => i.title)

describe('everything', () => {
  test('sorts by the key, ties by title', () => {
    const rows = everythingRows(board.items, NOW, { key: 'title', dir: 1 })
    expect(titles(rows)[0]).toBe('Badge reader audit')
    expect(titles(everythingRows(board.items, NOW, { key: 'title', dir: -1 }))[0]).toBe('Waiting on Pat')
    const byType = everythingRows(board.items, NOW, { key: 'type', dir: 1 })
    expect(byType[0].typeName).toBe('Project')
    expect(titles(byType.slice(1, 3))).toEqual(['Badge reader audit', 'Desk closed it'])
    const byScore = everythingRows(board.items, NOW, { key: 'score', dir: -1 })
    expect(byScore[0].title).toBe('Printer jams on line 3')
    const quiet = everythingRows(board.items, NOW, { key: 'quietDays', dir: -1 })
    expect(quiet[0].title).toBe('Waiting on Pat')
  })

  test('stage and turn sort by their label order', () => {
    const stages = everythingRows(board.items, NOW, { key: 'stage', dir: 1 }).map((i) => i.stage)
    expect(stages[0]).toBe('notStarted')
    expect(stages.at(-1)).toBe('done')
    expect(stages.indexOf('ready')).toBeLessThan(stages.indexOf('doing'))
    const turns = everythingRows(board.items, NOW, { key: 'turn', dir: 1 }).map((i) => i.turn)
    expect(turns).toEqual([...turns].sort((a, b) =>
      ['you', 'approve', 'agent', 'parked', 'close', 'none'].indexOf(a) - ['you', 'approve', 'agent', 'parked', 'close', 'none'].indexOf(b)))
  })

  test('priority by weight, ticket id with blanks first', () => {
    const items = [
      workBoardItem({ path: 'Tasks/Low.md', priority: 'Low' }),
      workBoardItem({ path: 'Tasks/None.md' }),
      workBoardItem({ path: 'Tasks/Crit.md', priority: 'Critical' }),
    ]
    expect(titles(everythingRows(items, NOW, { key: 'priority', dir: -1 }))).toEqual(['Crit', 'Low', 'None'])
    const ids = everythingRows(board.items, NOW, { key: 'ticketId', dir: 1 }).map((i) => i.ticket?.id ?? '')
    expect(ids.filter(Boolean)).toEqual(['INC0012345', 'INC0012346', 'OPS-123'])
    expect(ids[0]).toBe('')
  })
})
