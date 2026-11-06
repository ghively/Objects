// M23 Task 7: Now's scoring, energy, the pool and Up next.
import { describe, expect, test } from 'vitest'
import type { TicketInfo, WorkBoard, WorkBoardItem } from '@/api/types'
import { workBoardItem, workStep } from '@/test/mockApi'
import boardJson from '../__fixtures__/board.json'
import {
  effectivePriority,
  energyMatches,
  isStale,
  isYours,
  NO_PRIORITY_WEIGHT,
  nowPool,
  quietDays,
  score,
  STEP_ENERGY,
  STEP_MINUTES,
  upNext,
} from './scoring'

const board = boardJson as unknown as WorkBoard
const NOW = new Date('2026-11-05T10:00:00.000Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString()
const ticket = (over: Partial<TicketInfo> = {}): TicketInfo => ({
  id: 'INC0012345', system: 'ServiceNow', url: null, deskStatus: null, deskPriority: null, requester: null,
  group: null, location: null, opened: null, updated: null, resolved: null, ...over,
})
const yours = (path: string, over: Partial<WorkBoardItem> = {}) =>
  workBoardItem({ path, steps: [workStep()], turn: 'you', lastTouched: hoursAgo(48), ...over })
const base = { now: NOW, energy: null, notNow: new Set<string>(), focus: null }

describe('scoring', () => {
  test('score adds weight, rank, recency and the not-started penalty', () => {
    const critical = yours('Tasks/A.md', { ticket: ticket({ deskPriority: 'Critical' }), rank: 2, lastTouched: hoursAgo(2), stage: 'doing' })
    expect(score(critical, NOW)).toBe(100 + 21 + 15)
    const none = yours('Tasks/B.md', { rank: 20, lastTouched: hoursAgo(72), stage: 'notStarted' })
    expect(score(none, NOW)).toBe(NO_PRIORITY_WEIGHT + 0 + 0 - 25)
    expect(score(none, NOW)).toBe(-5)
    const both = yours('Tasks/C.md', { ticket: ticket({ deskPriority: 'Low' }), priority: 'Critical' })
    expect(effectivePriority(both)).toBe('Low')
    expect(effectivePriority(yours('Tasks/D.md', { priority: 'high' }))).toBe('High')
    expect(effectivePriority(yours('Tasks/E.md', { priority: 'Someday' }))).toBeNull()
    // the fixture: Printer jams on line 3 is Desk Medium (30) + rank 1 (23), touched 19 h ago (15)
    expect(score(board.items[0], NOW)).toBe(68)
  })

  test('parked and other turns are never picked', () => {
    const items = [
      yours('Tasks/Parked.md', { stage: 'parked', turn: 'parked' }),
      yours('Tasks/Agent.md', { turn: 'agent' }),
      yours('Tasks/None.md', { turn: 'none', steps: [], current: null }),
      yours('Tasks/Done.md', { done: true, stage: 'done' }),
      yours('Tasks/Close.md', { turn: 'close' }),
      yours('Tasks/Approve.md', { turn: 'approve', steps: [workStep({ kind: 'approve' })] }),
    ]
    expect(nowPool(items, base).map((i) => i.title).sort()).toEqual(['Approve', 'Close'])
    expect(isYours(items[0])).toBe(false)
    const fromBoard = nowPool(board.items, base).map((i) => i.title)
    expect(fromBoard).not.toContain('Parked thing')
    expect(fromBoard).not.toContain('Order toner')
    expect(fromBoard[0]).toBe('Printer jams on line 3')
  })

  test('energy low offers only low steps and falls back when none match', () => {
    expect(STEP_ENERGY).toEqual({ question: 'low', approve: 'low', do: 'high', agent: null })
    expect(STEP_MINUTES).toEqual({ question: 5, approve: 2, do: 30, agent: 0 })
    const doIt = yours('Tasks/Do.md', { rank: 1 })
    const ask = yours('Tasks/Ask.md', { steps: [workStep({ kind: 'question' })] })
    expect(nowPool([doIt, ask], { ...base, energy: 'low' }).map((i) => i.title)).toEqual(['Ask'])
    expect(nowPool([doIt, ask], { ...base, energy: 'medium' }).map((i) => i.title)).toEqual(['Ask'])
    expect(nowPool([doIt, ask], { ...base, energy: 'high' }).map((i) => i.title)).toEqual(['Do', 'Ask'])
    expect(nowPool([doIt], { ...base, energy: 'low' }).map((i) => i.title)).toEqual(['Do'])
    const close = yours('Tasks/Close.md', { turn: 'close', steps: [], current: null })
    expect(energyMatches(close, 'medium')).toBe(true)
    expect(energyMatches(close, 'low')).toBe(false)
  })

  test('not now goes to the back', () => {
    const top = yours('Tasks/Top.md', { rank: 1 })
    const other = yours('Tasks/Other.md')
    expect(nowPool([top, other], base)[0].title).toBe('Top')
    const pool = nowPool([top, other], { ...base, notNow: new Set(['Tasks/Top.md']) })
    expect(pool.map((i) => i.title)).toEqual(['Other', 'Top'])
  })

  test('up next shows three and counts the rest', () => {
    const pool = [1, 2, 3, 4, 5, 6].map((n) => yours(`Tasks/T${n}.md`))
    const { shown, hidden } = upNext(pool)
    expect(shown.map((i) => i.title)).toEqual(['T2', 'T3', 'T4'])
    expect(hidden).toBe(2)
    expect(upNext(pool.slice(0, 2))).toEqual({ shown: [pool[1]], hidden: 0 })
  })

  test('a focus line never falls back to unrelated work', () => {
    const parked = board.items.find((i) => i.title === 'Parked thing')!
    const agentTurn = yours('Tasks/Agent run.md', { turn: 'agent', steps: [workStep({ kind: 'agent' })] })
    const items = [...board.items, agentTurn]
    expect(nowPool(items, base).length).toBeGreaterThan(0)
    const focus = { n: 1, paths: new Set([parked.path, agentTurn.path]) }
    expect(nowPool(items, { ...base, focus })).toEqual([])
    expect(nowPool(items, { ...base, focus, energy: 'low' })).toEqual([])
    const printer = board.items[0]
    const withPrinter = { n: 1, paths: new Set([parked.path, printer.path]) }
    expect(nowPool(items, { ...base, focus: withPrinter }).map((i) => i.title)).toEqual(['Printer jams on line 3'])
  })

  test('stale after more than 7 days', () => {
    const seven = yours('Tasks/Seven.md', { lastTouched: hoursAgo(7 * 24) })
    const eight = yours('Tasks/Eight.md', { lastTouched: hoursAgo(8 * 24) })
    expect(quietDays(seven, NOW)).toBe(7)
    expect(isStale(seven, NOW)).toBe(false)
    expect(isStale(eight, NOW)).toBe(true)
    expect(isStale({ ...eight, done: true }, NOW)).toBe(false)
  })
})
