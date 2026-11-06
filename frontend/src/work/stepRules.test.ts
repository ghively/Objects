// M22 Task 10: the step rules in the front end, row for row against the shared parity fixture
// (`__fixtures__/step-cases.json`, also read by the server's `test_m22_rules.py`).
import { describe, expect, it, test } from 'vitest'
import type { LabelOption, StepAction, StepKind, StepState, WorkRole } from '@/api/types'
import cases from './__fixtures__/step-cases.json'
import {
  allowedActions,
  applyAction,
  currentIndex,
  deskSays,
  DONE_VISIBLE_DAYS,
  IllegalMoveError,
  inferSystem,
  normalizeDeskPriority,
  recentlyDone,
  stageOf,
  ticketUrl,
  whoseTurn,
  type RuleStep,
} from './stepRules'

interface Case {
  name: string
  steps: { id: string; kind: StepKind; state: StepState; text: string; answer?: string; result?: string }[]
  status: string | null
  statusOptions: LabelOption[]
  deskStatus: string | null
  role: WorkRole
  index: number
  action: StepAction
  text?: string
  notBefore?: string
  ask?: string
  expect: { current: number | null; stage: string; turn: string; actions: StepAction[]; result?: StepState[]; error?: string }
}

const NOW = new Date('2026-11-05T10:00:00.000Z')
let counter = 0
const newId = () => `n${String(++counter).padStart(5, '0')}`

describe('test M22 step rules (TS port)', () => {
  it.each((cases as Case[]).map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const steps: RuleStep[] = c.steps.map((s) => ({ ...s }))
    const statusDef = { options: { set: c.statusOptions } }
    expect(currentIndex(steps)).toBe(c.expect.current)
    const stage = stageOf(c.status, statusDef)
    expect(stage).toBe(c.expect.stage)
    expect(whoseTurn(stage, steps, c.deskStatus)).toBe(c.expect.turn)
    expect(allowedActions(steps, c.index, c.role)).toEqual(c.expect.actions)
    const run = () =>
      applyAction(steps, c.index, c.action, c.role, { now: NOW, text: c.text, notBefore: c.notBefore, ask: c.ask, newId })
    if (c.expect.error !== undefined) {
      expect(run).toThrow(IllegalMoveError)
      expect(run).toThrow(c.expect.error)
    } else {
      const after = run()
      expect(after.map((s) => s.state)).toEqual(c.expect.result)
      // The input list is never changed in place.
      expect(steps.map((s) => s.state)).toEqual(c.steps.map((s) => s.state))
    }
  })

  test('the fixture covers at least 40 rows', () => {
    expect((cases as Case[]).length).toBeGreaterThanOrEqual(40)
  })

  test('what an action sets on the step', () => {
    const steps: RuleStep[] = [
      { id: 'a1', kind: 'question', state: 'done', text: 'Which tray?', answer: 'Tray 2' },
      { id: 'a2', kind: 'approve', state: 'approved', text: 'Restart', approvedAt: 'x', notBefore: 'y' },
    ]
    const failed = applyAction(steps, 1, 'fail', 'agent', { now: NOW, text: 'Two hosts match', ask: 'Which host?', newId: () => 'q00001' })
    expect(failed).toHaveLength(3)
    expect(failed[1]).toMatchObject({ id: 'q00001', kind: 'question', state: 'open', text: 'Which host?', addedAt: '2026-11-05T10:00:00.000Z' })
    expect(failed[2]).toMatchObject({ id: 'a2', state: 'open', result: 'Two hosts match', approvedAt: null, notBefore: null })
    expect(whoseTurn('doing', failed, null)).toBe('you')

    const reopened = applyAction(steps, 0, 'reopen', 'user', { now: NOW })
    expect(reopened[0]).toMatchObject({ state: 'open', answer: 'Tray 2', doneAt: null })

    const answered = applyAction([{ id: 'b1', kind: 'question', state: 'open', text: 'Q' }], 0, 'answer', 'user', { now: NOW, text: ' Tray 2 ' })
    expect(answered[0]).toMatchObject({ state: 'done', answer: 'Tray 2', doneAt: '2026-11-05T10:00:00.000Z' })

    const approved = applyAction([{ id: 'c1', kind: 'approve', state: 'open', text: 'A' }], 0, 'approve', 'user', {
      now: NOW,
      notBefore: '2026-11-06T07:00:00.000Z',
    })
    expect(approved[0]).toMatchObject({ state: 'approved', approvedAt: '2026-11-05T10:00:00.000Z', notBefore: '2026-11-06T07:00:00.000Z' })
  })

  test('system, priority, link, desk and the 14 days', () => {
    expect(inferSystem('OPS-123')).toBe('Jira')
    expect(inferSystem('ops-7')).toBe('Jira')
    expect(inferSystem('INC0012345')).toBe('ServiceNow')
    expect(inferSystem('  ')).toBeNull()
    expect(inferSystem(null)).toBeNull()
    expect(normalizeDeskPriority('Moderate')).toBe('Medium')
    expect(normalizeDeskPriority('moderate')).toBe('Medium')
    expect(normalizeDeskPriority('high')).toBe('High')
    expect(normalizeDeskPriority('P1')).toBe('P1')
    expect(ticketUrl('Jira', 'OPS-123', null, 'https://example.atlassian.net/')).toBe('https://example.atlassian.net/browse/OPS-123')
    expect(ticketUrl('Jira', 'OPS-123', 'https://x.test/1', 'https://example.atlassian.net')).toBe('https://x.test/1')
    expect(ticketUrl('ServiceNow', 'INC0012345', null, 'https://example.atlassian.net')).toBeNull()
    expect(deskSays('doing', 'Resolved')).toBe('Resolved')
    expect(deskSays('done', 'Resolved')).toBeNull()
    expect(deskSays('doing', 'In progress')).toBeNull()

    expect(DONE_VISIBLE_DAYS).toBe(14)
    const day = 24 * 3600 * 1000
    const now = new Date('2026-11-20T10:00:00.000Z')
    expect(recentlyDone(new Date(now.getTime() - 14 * day + 3600 * 1000), null, now)).toBe(true)
    expect(recentlyDone(new Date(now.getTime() - 14 * day), null, now)).toBe(false)
    expect(recentlyDone(null, new Date(now.getTime() - day), now)).toBe(true)
    expect(recentlyDone('2026-11-05T10:00:00.000Z', null, now)).toBe(false)
    expect(recentlyDone(null, null, now)).toBe(false)
  })
})
