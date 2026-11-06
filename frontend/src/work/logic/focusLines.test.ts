// M23 Task 7: focus lines against the board.
import { describe, expect, test } from 'vitest'
import type { FocusLine, WorkBoard } from '@/api/types'
import boardJson from '../__fixtures__/board.json'
import { currentLine, focusProgress, isCleared, linkedPaths } from './focusLines'

const board = boardJson as unknown as WorkBoard
const line = (n: number, links: (string | null)[], text = `Line ${n}`): FocusLine => ({
  n,
  text,
  label: text,
  links: links.map((path) => ({ target: path ?? 'Nowhere', path })),
})

const printerLine = line(1, ['Tasks/Printer jams on line 3.md'], 'Clear the jams on [[Printer jams on line 3]]')
const rolloutLine = line(2, ['Projects/Scanner rollout.md'], 'Finish [[Scanner rollout]]')
const planLine = line(3, [], 'Plan next week')

describe('focus lines', () => {
  test('a line linked to Scanner rollout includes Scanner firmware', () => {
    const paths = linkedPaths(rolloutLine, board.items)
    expect([...paths].sort()).toEqual(['Projects/Scanner rollout.md', 'Tasks/Scanner firmware.md'])
    expect(linkedPaths(line(4, [null]), board.items).size).toBe(0)
    // rollout: its Approve step (0 of 1) and Scanner firmware (1 of 2)
    expect(focusProgress(rolloutLine, board.items)).toEqual({ done: 1, total: 3 })
  })

  test('cleared when its linked items are all done', () => {
    expect(isCleared(rolloutLine, board.items)).toBe(false)
    expect(isCleared(planLine, board.items)).toBe(false)
    const done = board.items.map((i) =>
      i.path === 'Projects/Scanner rollout.md' || i.path === 'Tasks/Scanner firmware.md'
        ? { ...i, done: true, stage: 'done' as const }
        : i,
    )
    expect(isCleared(rolloutLine, done)).toBe(true)
    expect(isCleared(line(5, ['Tasks/Last week fix.md']), board.items)).toBe(true)
  })

  test("currentLine finds Printer's line", () => {
    const lines = [planLine, rolloutLine, printerLine]
    expect(currentLine(lines, board.items, board.items[0])).toBe(1)
    const firmware = board.items.find((i) => i.title === 'Scanner firmware')!
    expect(currentLine(lines, board.items, firmware)).toBe(2)
    expect(currentLine(lines, board.items, null)).toBeNull()
    const badge = board.items.find((i) => i.title === 'Badge reader audit')!
    expect(currentLine(lines, board.items, badge)).toBeNull()
  })
})
