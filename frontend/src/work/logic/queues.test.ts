// M23 Task 7: Your queues by the current step.
import { describe, expect, test } from 'vitest'
import type { WorkBoard } from '@/api/types'
import { workBoardItem, workStep } from '@/test/mockApi'
import boardJson from '../__fixtures__/board.json'
import { queues } from './queues'

const board = boardJson as unknown as WorkBoard
const NOW = new Date('2026-11-05T10:00:00.000Z')
const titles = (list: { title: string }[]) => list.map((i) => i.title)

describe('queues', () => {
  test('each item goes to the queue of its current step, by score', () => {
    const q = queues(board.items, NOW)
    expect(titles(q.answer)).toEqual(['Scanner firmware', 'Parked thing'])
    expect(titles(q.approve)).toEqual(['Printer jams on line 3', 'Scanner rollout'])
    expect(titles(q.do)).toEqual(['Hand edited', 'Waiting on Pat', 'Desk closed it', 'Badge reader audit'])
    expect(q.agent).toEqual([])
  })

  test('an Agent step or an approved Approve step is the agent queue', () => {
    const agent = workBoardItem({ path: 'Tasks/Agent.md', steps: [workStep({ kind: 'agent' })], turn: 'agent' })
    const approved = workBoardItem({
      path: 'Tasks/Approved.md',
      steps: [workStep({ kind: 'approve', state: 'approved' })],
      turn: 'agent',
    })
    const done = workBoardItem({ path: 'Tasks/Done.md', steps: [workStep()], done: true, stage: 'done' })
    const none = workBoardItem({ path: 'Tasks/None.md' })
    const q = queues([agent, approved, done, none], NOW)
    expect(titles(q.agent).sort()).toEqual(['Agent', 'Approved'])
    expect(q.do).toEqual([])
    expect(q.approve).toEqual([])
  })
})
