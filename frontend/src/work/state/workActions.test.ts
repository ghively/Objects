// M23 Task 8: the inline step action wrapper: the row hides at once, comes back with the server's
// text on failure, and Done/Decline/Approve offer a 5-second Undo that reopens at the new rev.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, StepChangedError } from '@/api/client'
import { useTabs } from '@/nav/tabs'
import { workBoard, workItem, workStep, workWriteResult } from '@/test/mockApi'
import { resetWorkData, useWorkData } from './useWorkData'
import { APPROVE_ARM_MS, directRunner, openItemPanel, stepAction, UNDO_MS } from './workActions'
import { resetWorkToasts, runUndo, useWorkToasts } from './workToasts'

const mocked = vi.mocked(api)
const PATH = 'Tasks/Printer jams on line 3.md'
const item = { path: PATH }

function resultWithRev(stepId: string, rev: string) {
  return workWriteResult({ item: workItem({ path: PATH, steps: [workStep({ id: stepId, rev, state: 'done', current: false })] }) })
}

const toasts = () => useWorkToasts.getState().toasts

describe('stepAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkData()
    resetWorkToasts()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('test the row hides at once and returns on failure with the server\'s text', async () => {
    let fail: (e: unknown) => void = () => undefined
    mocked.workStep.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
    const step = workStep({ id: 'd1', rev: 'aaaaaaaaaaaa', kind: 'do', actions: ['done'] })
    const p = stepAction({ item, step, action: 'done' })
    expect(useWorkData.getState().hidden.has(`${PATH}#d1`)).toBe(true)
    fail(new StepChangedError('This step changed. Look again.', 'v9'))
    expect(await p).toBe(false)
    expect(useWorkData.getState().hidden.size).toBe(0)
    expect(toasts().map((t) => t.text)).toEqual(['This step changed. Look again.'])
    expect(toasts()[0].undo).toBeNull()
    expect(mocked.workBoard).toHaveBeenCalledTimes(1)
  })

  test('test undo reopens with the new rev', async () => {
    mocked.workStep.mockResolvedValueOnce(resultWithRev('d1', 'bbbbbbbbbbbb'))
    const step = workStep({ id: 'd1', rev: 'aaaaaaaaaaaa', kind: 'do', actions: ['done'] })
    expect(await stepAction({ item, step, action: 'done', text: 'Cable was loose' })).toBe(true)
    expect(mocked.workStep).toHaveBeenLastCalledWith({ path: PATH, stepId: 'd1', stepRev: 'aaaaaaaaaaaa', action: 'done', text: 'Cable was loose' })
    expect(toasts().map((t) => t.text)).toEqual(['Marked done'])
    await runUndo(toasts()[0].id)
    expect(mocked.workStep).toHaveBeenLastCalledWith({ path: PATH, stepId: 'd1', stepRev: 'bbbbbbbbbbbb', action: 'reopen' })
    expect(toasts()).toEqual([])
    expect(useWorkData.getState().hidden.size).toBe(0)
  })

  test('test undo lasts five seconds', async () => {
    vi.useFakeTimers()
    mocked.workStep.mockResolvedValueOnce(resultWithRev('d1', 'bbbbbbbbbbbb'))
    await stepAction({ item, step: workStep({ id: 'd1', actions: ['done'] }), action: 'done' })
    expect(toasts()).toHaveLength(1)
    vi.advanceTimersByTime(UNDO_MS - 1)
    expect(toasts()).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(UNDO_MS).toBe(5000)
    expect(toasts()).toHaveLength(0)
  })

  test('test approve\'s undo withdraws', async () => {
    mocked.workStep.mockResolvedValueOnce(resultWithRev('a2', 'cccccccccccc'))
    const step = workStep({ id: 'a2', rev: 'aaaaaaaaaaaa', kind: 'approve', actions: ['approve', 'decline'] })
    await stepAction({ item, step, action: 'approve', notBefore: '2026-11-06T15:00:00.000Z' })
    expect(mocked.workStep).toHaveBeenLastCalledWith({
      path: PATH, stepId: 'a2', stepRev: 'aaaaaaaaaaaa', action: 'approve', notBefore: '2026-11-06T15:00:00.000Z',
    })
    expect(toasts().map((t) => t.text)).toEqual(['Approved'])
    await runUndo(toasts()[0].id)
    expect(mocked.workStep).toHaveBeenLastCalledWith({ path: PATH, stepId: 'a2', stepRev: 'cccccccccccc', action: 'reopen' })
  })

  test('test decline offers undo too', async () => {
    mocked.workStep.mockResolvedValueOnce(resultWithRev('a2', 'cccccccccccc'))
    await stepAction({ item, step: workStep({ id: 'a2', kind: 'approve' }), action: 'decline', text: 'Not today' })
    expect(toasts().map((t) => t.text)).toEqual(['Declined'])
  })

  test('test success shows no toast besides Undo', async () => {
    mocked.workStep.mockResolvedValueOnce(resultWithRev('g4', 'dddddddddddd'))
    expect(await stepAction({ item, step: workStep({ id: 'g4', kind: 'agent', actions: ['done', 'run'] }), action: 'run' })).toBe(true)
    expect(toasts()).toEqual([])
    mocked.workStep.mockResolvedValueOnce(resultWithRev('a2', 'dddddddddddd'))
    expect(await stepAction({ item, step: workStep({ id: 'a2', kind: 'approve', state: 'approved' }), action: 'reopen' })).toBe(true)
    expect(toasts()).toEqual([])
  })

  test('test a hidden row shows again once a later board load arrives', async () => {
    mocked.workStep.mockResolvedValueOnce(resultWithRev('d1', 'bbbbbbbbbbbb'))
    await stepAction({ item, step: workStep({ id: 'd1' }), action: 'run' })
    expect(useWorkData.getState().hidden.has(`${PATH}#d1`)).toBe(true)
    mocked.workBoard.mockResolvedValueOnce(workBoard())
    await useWorkData.getState().load(['board'])
    expect(useWorkData.getState().hidden.size).toBe(0)
  })

  test('test a runner goes through the given wrapper; null writes nothing and unhides', async () => {
    const run = vi.fn(async () => null)
    expect(await stepAction({ item, step: workStep({ id: 'd1' }), action: 'done', run })).toBe(false)
    expect(run).toHaveBeenCalledTimes(1)
    expect(mocked.workStep).not.toHaveBeenCalled()
    expect(useWorkData.getState().hidden.size).toBe(0)
    const direct = directRunner(PATH)
    mocked.workStep.mockResolvedValueOnce(resultWithRev('d1', 'b'))
    await direct((p) => api.workStep({ path: p, stepId: 'd1', stepRev: 'a', action: 'done' }))
    expect(mocked.workStep).toHaveBeenLastCalledWith({ path: PATH, stepId: 'd1', stepRev: 'a', action: 'done' })
  })

  test('test the arm time and the item panel', () => {
    expect(APPROVE_ARM_MS).toBe(4000)
    const spy = vi.spyOn(useTabs.getState(), 'openInSidepanel').mockImplementation(() => undefined)
    openItemPanel(PATH)
    expect(spy).toHaveBeenCalledWith({ kind: 'object', path: PATH, work: true })
    spy.mockRestore()
  })
})
