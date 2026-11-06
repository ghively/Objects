import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ApiError, RevisionConflictError } from '@/api/client'
import type { AutomationRule } from '@/api/types'
import { resetAutomations } from '@/automations/useAutomations'
import { agent, agentSchedule } from '@/test/mockApi'
import { ScheduleDialog } from './ScheduleDialog'

const mocked = vi.mocked(api)
const RESEARCHER = '01JC7ZK3T9Q4M2X8B5N6R1V0WE'
const AGENT = agent({ id: RESEARCHER, model: 'sonnet' })

beforeEach(() => {
  vi.clearAllMocks()
  resetAutomations()
  mocked.aiModels.mockResolvedValue({
    models: [
      { id: 'sonnet', label: 'Sonnet', kind: 'alias' },
      { id: 'haiku', label: 'Haiku', kind: 'alias' },
    ],
    pattern: '[a-z0-9.-]+',
  } as never)
})

function open(rule: AutomationRule | null = null) {
  const onOpenChange = vi.fn()
  render(<ScheduleDialog open agent={AGENT} rule={rule} onOpenChange={onOpenChange} />)
  return { dialog: screen.getByRole('dialog'), onOpenChange }
}

describe('ScheduleDialog', () => {
  test('test New schedule creates one runAgent rule for this agent', async () => {
    const user = userEvent.setup()
    const { dialog, onOpenChange } = open()
    expect(within(dialog).getByText('New schedule')).toBeInTheDocument()
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Weekly review')
    const prompt = within(dialog).getByRole('textbox', { name: 'Prompt' })
    expect(prompt).toHaveAttribute('placeholder', "What should Researcher do each time? {date:YYYY-MM-DD} becomes the run's date.")
    await user.click(prompt)
    await user.paste('Review {date:YYYY-MM-DD}')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocked.createAutomation).toHaveBeenCalledTimes(1))
    const sent = mocked.createAutomation.mock.calls[0][0]
    expect(sent.trigger.kind).toBe('schedule')
    expect(sent).toMatchObject({
      name: 'Weekly review',
      enabled: true,
      conditions: { type: 'filterGroup', operator: 'and', elements: [] },
      actions: [{ kind: 'runAgent', agentId: RESEARCHER, prompt: 'Review {date:YYYY-MM-DD}', model: null }],
      templateRepeat: null,
    })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  test('test Edit keeps unknown keys and the description', async () => {
    const user = userEvent.setup()
    const rule = {
      ...agentSchedule({
        description: 'Kept',
        revision: 'r7',
        actions: [{ kind: 'runAgent', agentId: RESEARCHER, prompt: 'Old prompt', model: null }],
      }),
      futureKey: { a: 1 },
    } as AutomationRule
    const { dialog } = open(rule)
    expect(within(dialog).getByText('Edit schedule')).toBeInTheDocument()
    const prompt = within(dialog).getByRole('textbox', { name: 'Prompt' })
    expect(prompt).toHaveValue('Old prompt')
    await user.clear(prompt)
    await user.type(prompt, 'New prompt')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocked.saveAutomation).toHaveBeenCalledTimes(1))
    const [sent, opts] = mocked.saveAutomation.mock.calls[0]
    expect(opts).toEqual({ baseRevision: 'r7' })
    expect(sent).toMatchObject({ id: rule.id, description: 'Kept', futureKey: { a: 1 }, name: 'Weekly review' })
    expect(sent.actions).toEqual([{ kind: 'runAgent', agentId: RESEARCHER, prompt: 'New prompt', model: null }])
  })

  test('test the model picker sends the chosen model and null for the default', async () => {
    const user = userEvent.setup()
    const rule = agentSchedule({ actions: [{ kind: 'runAgent', agentId: RESEARCHER, prompt: 'Go', model: null }] })
    const { dialog } = open(rule)
    const picker = within(dialog).getByRole('button', { name: 'Model' })
    await user.click(picker)
    expect(await screen.findByRole('option', { name: "Agent's default (Sonnet)" })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Haiku' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocked.saveAutomation).toHaveBeenCalledTimes(1))
    expect(mocked.saveAutomation.mock.calls[0][0].actions[0]).toMatchObject({ model: 'haiku' })

    await user.click(within(dialog).getByRole('button', { name: 'Model' }))
    await user.click(await screen.findByRole('option', { name: "Agent's default (Sonnet)" }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocked.saveAutomation).toHaveBeenCalledTimes(2))
    expect(mocked.saveAutomation.mock.calls[1][0].actions[0]).toMatchObject({ model: null })
  })

  test('test a 422 message shows above the footer', async () => {
    const user = userEvent.setup()
    mocked.createAutomation.mockRejectedValueOnce(new ApiError(422, "That agent isn't listed any more."))
    const { dialog, onOpenChange } = open()
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Weekly review')
    await user.type(within(dialog).getByRole('textbox', { name: 'Prompt' }), 'Go')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("That agent isn't listed any more.")
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  test('test a 409 reloads and asks to save again', async () => {
    const user = userEvent.setup()
    const rule = agentSchedule({ revision: 'r1', actions: [{ kind: 'runAgent', agentId: RESEARCHER, prompt: 'Go', model: null }] })
    mocked.saveAutomation.mockRejectedValueOnce(new RevisionConflictError('r2'))
    mocked.automation.mockResolvedValueOnce({ ...rule, revision: 'r2' })
    const { dialog } = open(rule)
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This schedule was changed elsewhere. Save again to keep your version.')
    expect(mocked.automation).toHaveBeenCalledWith(rule.id)
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocked.saveAutomation).toHaveBeenCalledTimes(2))
    expect(mocked.saveAutomation.mock.calls[1][1]).toEqual({ baseRevision: 'r2' })
  })
})
