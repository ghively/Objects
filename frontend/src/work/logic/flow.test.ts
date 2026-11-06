// M23 Task 7: Flow's lanes and columns.
import { describe, expect, test } from 'vitest'
import type { WorkBoard } from '@/api/types'
import { workBoardItem, workStep } from '@/test/mockApi'
import boardJson from '../__fixtures__/board.json'
import { DOING_LIMIT, FLOW_COLUMNS, flowBoard, laneOf } from './flow'

const board = boardJson as unknown as WorkBoard
const NOW = new Date('2026-11-05T10:00:00.000Z')
const byTitle = (t: string) => board.items.find((i) => i.title === t)!
const titles = (list: { title: string }[]) => list.map((i) => i.title)

describe('flow', () => {
  test('lanes for agent, parked and blocked items', () => {
    expect(FLOW_COLUMNS).toEqual(['notStarted', 'ready', 'doing', 'parked', 'done'])
    expect(laneOf(workBoardItem({ steps: [workStep({ kind: 'agent' })], turn: 'agent' }))).toBe('agent')
    expect(laneOf(byTitle('Parked thing'))).toBe('others')
    expect(laneOf(byTitle('Order toner'))).toBe('others') // no steps: turn none
    expect(laneOf(byTitle('Waiting on Pat'))).toBe('others') // Blocked on set
    expect(laneOf(byTitle('Scanner firmware'))).toBe('you')
    expect(laneOf(byTitle('Printer jams on line 3'))).toBe('you') // an approval is Gene's
    const { cells } = flowBoard(board.items, null, NOW)
    expect(titles(cells.others.parked)).toEqual(['Parked thing'])
    expect(titles(cells.others.ready)).toEqual(['Order toner'])
    expect(titles(cells.you.notStarted)).toEqual(['Badge reader audit'])
    // by score: Printer (68) before Scanner firmware (41)
    expect(titles(cells.you.doing).slice(0, 2)).toEqual(['Printer jams on line 3', 'Scanner firmware'])
  })

  test('four You items in Doing are overloaded', () => {
    const four = [1, 2, 3, 4].map((n) => workBoardItem({ path: `Tasks/D${n}.md`, steps: [workStep()], stage: 'doing' }))
    expect(DOING_LIMIT).toBe(3)
    expect(flowBoard(four.slice(0, 3), null, NOW)).toMatchObject({ youDoing: 3, overloaded: false })
    expect(flowBoard(four, null, NOW)).toMatchObject({ youDoing: 4, overloaded: true })
  })

  test('the area filter', () => {
    const all = flowBoard(board.items, null, NOW)
    expect(all.areas).toEqual(['Printers', 'Scanners'])
    const printers = flowBoard(board.items, 'Printers', NOW)
    const shown = Object.values(printers.cells).flatMap((row) => Object.values(row).flat())
    expect(titles(shown)).toEqual(['Printer jams on line 3'])
    expect(printers.areas).toEqual(['Printers', 'Scanners'])
  })

  test('the done column holds only items done within 14 days', () => {
    const old = workBoardItem({ path: 'Tasks/Long ago.md', stage: 'done', done: true, recentlyDone: false })
    const { cells } = flowBoard([...board.items, old], null, NOW)
    expect(titles(cells.others.done)).toEqual(['Last week fix'])
  })
})
