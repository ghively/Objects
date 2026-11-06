// M23 Task 7: the Projects map's lines and stations.
import { describe, expect, test } from 'vitest'
import type { WorkBoard, WorkBoardItem } from '@/api/types'
import boardJson from '../__fixtures__/board.json'
import { WORK_TEXT } from '../workText'
import { projectLines } from './stations'

const board = boardJson as unknown as WorkBoard
const ROLLOUT = 'Projects/Scanner rollout.md'

const stepDone = (items: WorkBoardItem[]): WorkBoardItem[] =>
  items.map((i) =>
    i.path === ROLLOUT
      ? {
          ...i,
          turn: 'none' as const,
          current: null,
          stepsFinished: 1,
          steps: i.steps.map((s) => ({ ...s, state: 'done' as const, current: false, actions: [] })),
        }
      : i,
  )

describe('projects map', () => {
  test("Scanner rollout's line is its Approve step, then Scanner firmware", () => {
    const line = projectLines(board.items).find((l) => l.projectPath === ROLLOUT)!
    expect(line.title).toBe('Scanner rollout')
    expect(line.stations.map((s) => [s.label, s.state, s.path, s.stepId])).toEqual([
      ['Install the new scanner on line 2', 'waiting', ROLLOUT, board.items.find((i) => i.path === ROLLOUT)!.steps[0].id],
      ['Scanner firmware', 'doing', 'Tasks/Scanner firmware.md', null],
    ])
    expect(line.percentDone).toBe(0)
    const after = projectLines(stepDone(board.items)).find((l) => l.projectPath === ROLLOUT)!
    expect(after.stations[0].state).toBe('done')
    expect(after.percentDone).toBe(50)
  })

  test('an Area line for Printers, and No area for the rest', () => {
    const lines = projectLines(board.items)
    const printers = lines.find((l) => l.title === 'Printers')!
    expect(printers.projectPath).toBeNull()
    expect(printers.stations.map((s) => [s.label, s.state])).toEqual([['Printer jams on line 3', 'doing']])
    const none = lines.find((l) => l.title === WORK_TEXT.noArea)!
    expect(none.stations.map((s) => s.label)).toContain('Order toner')
    expect(none.stations.find((s) => s.label === 'Parked thing')!.state).toBe('waiting')
    expect(none.stations.find((s) => s.label === 'Last week fix')!.state).toBe('done')
    // Scanner firmware is on its project's line, not on the Scanners area line
    expect(lines.find((l) => l.title === 'Scanners')).toBeUndefined()
    // ordered by active stations: No area (7 active) first
    expect(lines[0].title).toBe(WORK_TEXT.noArea)
  })

  test('nextForYou is the first station that is your turn', () => {
    const lines = projectLines(board.items)
    const rollout = lines.find((l) => l.projectPath === ROLLOUT)!
    expect(rollout.nextForYou).toEqual({ path: ROLLOUT, text: 'Install the new scanner on line 2' })
    const after = projectLines(stepDone(board.items)).find((l) => l.projectPath === ROLLOUT)!
    expect(after.nextForYou).toEqual({ path: 'Tasks/Scanner firmware.md', text: 'Which firmware build is on the floor units?' })
    const printers = lines.find((l) => l.title === 'Printers')!
    expect(printers.nextForYou?.text).toBe('Restart the print spooler on PRN-TEST-01')
  })
})
