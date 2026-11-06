// M23 Task 7: Stuck.
import { describe, expect, test } from 'vitest'
import type { TicketInfo, WorkBoard } from '@/api/types'
import { workBoardItem, workStep } from '@/test/mockApi'
import boardJson from '../__fixtures__/board.json'
import { quietDays } from './scoring'
import { stuck } from './stuck'

const board = boardJson as unknown as WorkBoard
const NOW = new Date('2026-11-05T10:00:00.000Z')
const titles = (list: { title: string }[]) => list.map((i) => i.title)
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()
const ticket = (deskStatus: string): TicketInfo => ({
  id: 'INC0012347', system: 'ServiceNow', url: null, deskStatus, deskPriority: null, requester: null,
  group: null, location: null, opened: null, updated: null, resolved: null,
})
const pat = [{ path: 'People/Pat Example.md', title: 'Pat Example' }]

describe('stuck', () => {
  test('Waiting on Pat is blocked: quiet 11 days', () => {
    const pat = board.items.find((i) => i.title === 'Waiting on Pat')!
    expect(quietDays(pat, NOW)).toBe(11)
    const s = stuck(board.items, NOW)
    expect(titles(s.blocked)).toEqual(['Waiting on Pat'])
    expect(s.waitingOn).toEqual([]) // already in blocked
  })

  test('a fresh item that names a person is waiting on someone', () => {
    const fresh = workBoardItem({
      path: 'Tasks/Fresh.md', steps: [workStep()], blockedOn: '[[Pat Example]] to call back',
      blockedOnPeople: pat, lastTouched: daysAgo(1),
    })
    const s = stuck([...board.items, fresh], NOW)
    expect(titles(s.waitingOn)).toEqual(['Fresh'])
    expect(titles(s.blocked)).toEqual(['Waiting on Pat'])
  })

  test('Desk status Blocked or parked counts, quiet for 7 days or more; done never', () => {
    const desk = workBoardItem({ path: 'Tasks/Desk.md', ticket: ticket('Blocked'), lastTouched: daysAgo(7) })
    const parked = workBoardItem({ path: 'Tasks/Parked.md', stage: 'parked', lastTouched: daysAgo(9) })
    const recent = workBoardItem({ path: 'Tasks/Recent.md', stage: 'parked', lastTouched: daysAgo(6) })
    const done = workBoardItem({ path: 'Tasks/Done.md', blockedOn: 'x', done: true, stage: 'done', lastTouched: daysAgo(30) })
    const s = stuck([desk, parked, recent, done], NOW)
    expect(titles(s.blocked).sort()).toEqual(['Desk', 'Parked'])
  })
})
