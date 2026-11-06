import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ApiError, RevisionConflictError } from '@/api/client'
import { agent, learningState } from '@/test/mockApi'
import { LearningTab } from './LearningTab'
import { LEARNING_TEXT as T } from './learningText'
import { PROFILE_TEXT } from './ProfileTab'

const mocked = vi.mocked(api)
const RESEARCHER = '01JC7ZK3T9Q4M2X8B5N6R1V0WE'

const field = (before: string, after: string) => screen.getByRole('spinbutton', { name: `${before} (${after})` })

describe('LearningTab', () => {
  beforeEach(() => vi.clearAllMocks())

  test('test Learning saves a number and shows the 422 message', async () => {
    const user = userEvent.setup()
    render(<LearningTab agent={agent({ id: RESEARCHER })} />)
    await screen.findByRole('heading', { name: T.reviews })
    expect(mocked.agentLearning).toHaveBeenCalledWith(RESEARCHER)
    expect(field(T.memoryCapBefore, T.charactersAfter)).toHaveValue(2200)
    expect(field(T.userCapBefore, T.charactersAfter)).toHaveValue(1375)
    expect(field(T.idleBefore, T.idleAfter)).toHaveValue(2)
    expect(field(T.everyBefore, T.everyAfter)).toHaveValue(7)
    expect(screen.getByText(T.notRun)).toBeInTheDocument()

    const cap = field(T.memoryCapBefore, T.charactersAfter)
    await user.clear(cap)
    await user.type(cap, '3000')
    await user.tab()
    await waitFor(() => expect(mocked.saveAgentLearning).toHaveBeenCalledTimes(1))
    expect(mocked.saveAgentLearning.mock.calls[0][0]).toBe(RESEARCHER)
    expect(mocked.saveAgentLearning.mock.calls[0][1]).toMatchObject({ memoryChars: 3000 })
    expect(mocked.saveAgentLearning.mock.calls[0][2]).toBe('r1')

    mocked.saveAgentLearning.mockRejectedValueOnce(new ApiError(422, 'The memory cap must be between 200 and 20,000 characters.'))
    const cap2 = field(T.memoryCapBefore, T.charactersAfter)
    await user.clear(cap2)
    await user.type(cap2, '50')
    await user.keyboard('{Enter}')
    const box = (await screen.findByRole('alert')).closest('[data-field]') as HTMLElement
    expect(box).toHaveAttribute('data-field', 'memoryChars')
    expect(within(box).getByRole('alert')).toHaveTextContent('The memory cap must be between 200 and 20,000 characters.')
    // The second save used the revision the first one returned.
    expect(mocked.saveAgentLearning.mock.calls[1][2]).toBe('r1+1')
  })

  test('test 0 turns a review off', async () => {
    const user = userEvent.setup()
    render(<LearningTab agent={agent({ id: RESEARCHER })} />)
    await screen.findByText(T.reviewOff)
    const every = field(T.reviewMemoryBefore, T.reviewMemoryAfter)
    expect(every).toHaveValue(10)
    expect(field(T.reviewSkillsBefore, T.reviewSkillsAfter)).toHaveValue(10)
    await user.clear(every)
    await user.type(every, '0')
    await user.tab()
    await waitFor(() => expect(mocked.saveAgentLearning).toHaveBeenCalledTimes(1))
    expect(mocked.saveAgentLearning.mock.calls[0][1]).toMatchObject({ memoryReviewEvery: 0, skillReviewEvery: 10 })
  })

  test("test the review model picker's default says Same as the chat", async () => {
    const user = userEvent.setup()
    render(<LearningTab agent={agent({ id: RESEARCHER })} />)
    const trigger = await screen.findByRole('button', { name: T.reviewModel })
    await user.click(trigger)
    const list = await screen.findByRole('listbox')
    expect(within(list).getAllByRole('option')[0]).toHaveTextContent(T.reviewModelDefault)
    await user.click(await within(list).findByRole('option', { name: 'Opus 5.5' }))
    await waitFor(() => expect(mocked.saveAgentLearning).toHaveBeenCalledTimes(1))
    expect(mocked.saveAgentLearning.mock.calls[0][1]).toMatchObject({ reviewModel: 'claude-opus-5-5' })
  })

  test('test Reset to defaults sends the defaults', async () => {
    const changed = learningState()
    changed.settings = { ...changed.settings, memoryChars: 5000, consolidate: true, curatorEveryDays: 30 }
    changed.curator = { lastRunAt: '2026-11-01T10:00:00.000Z', nextDueAt: '2026-11-08T10:00:00.000Z', running: false, report: null }
    mocked.agentLearning.mockResolvedValueOnce(changed)
    const user = userEvent.setup()
    render(<LearningTab agent={agent({ id: RESEARCHER })} />)
    const reset = await screen.findByRole('button', { name: T.reset })
    expect(screen.getByText(/^Last run: /)).toBeInTheDocument()
    expect(screen.getByText(/^Next: when idle after /)).toBeInTheDocument()
    expect(field(T.memoryCapBefore, T.charactersAfter)).toHaveValue(5000)
    await user.click(reset)
    await waitFor(() => expect(mocked.saveAgentLearning).toHaveBeenCalledTimes(1))
    expect(mocked.saveAgentLearning.mock.calls[0][1]).toEqual(learningState().defaults)
    await waitFor(() => expect(field(T.memoryCapBefore, T.charactersAfter)).toHaveValue(2200))
  })

  test('test a switch saves and a 409 reloads with the Profile text', async () => {
    mocked.saveAgentLearning.mockRejectedValueOnce(new RevisionConflictError('r9'))
    const user = userEvent.setup()
    render(<LearningTab agent={agent({ id: RESEARCHER })} />)
    await user.click(await screen.findByRole('switch', { name: T.consolidate }))
    await waitFor(() => expect(mocked.saveAgentLearning).toHaveBeenCalledTimes(1))
    expect(mocked.saveAgentLearning.mock.calls[0][1]).toMatchObject({ consolidate: true })
    expect(await screen.findByRole('status')).toHaveTextContent(PROFILE_TEXT.conflict)
    expect(mocked.agentLearning).toHaveBeenCalledTimes(2)
  })
})
