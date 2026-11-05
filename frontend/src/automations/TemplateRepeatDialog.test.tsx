import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { automationRule, objectSummary } from '@/test/mockApi'
import { TemplateRepeatDialog } from './TemplateRepeatDialog'
import { resetAutomations } from './useAutomations'

const mocked = vi.mocked(api)
const TEMPLATE = objectSummary({ path: 'Templates/Weekly review.md', id: 'tpl1', title: 'Weekly review', template: 'Weekly review' })
const REPEAT = automationRule({
  id: 'rep',
  name: 'Repeat “Weekly review”',
  revision: 'q1',
  trigger: { kind: 'schedule', repeat: 'every day', time: '07:30', start: '2026-11-05' },
  actions: [{ kind: 'createFromTemplate', typeId: 'task', templateId: 'tpl1', title: '', relateVia: null }],
  templateRepeat: { typeId: 'task', templateId: 'tpl1' },
})

beforeEach(() => {
  vi.clearAllMocks()
  resetAutomations()
  mocked.automations.mockResolvedValue([])
})

function setup(template = TEMPLATE) {
  const onOpenChange = vi.fn()
  render(<TemplateRepeatDialog open typeId="task" template={template} onOpenChange={onOpenChange} />)
  return { onOpenChange, user: userEvent.setup() }
}

describe('TemplateRepeatDialog', () => {
  test('creates a weekly repeat of the template', async () => {
    const { user, onOpenChange } = setup()
    expect(screen.getByRole('dialog', { name: 'Repeat template' })).toHaveTextContent('Repeats template “Weekly review”')
    expect(screen.queryByRole('button', { name: 'Remove repeat' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocked.createAutomation).toHaveBeenCalledTimes(1))
    expect(mocked.createAutomation.mock.calls[0][0]).toMatchObject({
      name: 'Repeat “Weekly review”',
      enabled: true,
      trigger: { kind: 'schedule', repeat: 'every week on mon', time: '09:00' },
      conditions: { type: 'filterGroup', operator: 'and', elements: [] },
      actions: [{ kind: 'createFromTemplate', typeId: 'task', templateId: 'tpl1', title: '', relateVia: null }],
      templateRepeat: { typeId: 'task', templateId: 'tpl1' },
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('gives a template without an id one first', async () => {
    const { user } = setup({ ...TEMPLATE, id: null })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocked.createAutomation).toHaveBeenCalled())
    expect(mocked.ensureId).toHaveBeenCalledWith('Templates/Weekly review.md')
    expect(mocked.createAutomation.mock.calls[0][0].templateRepeat).toEqual({ typeId: 'task', templateId: '01MOCKID0000000000000000' })
  })

  test("edits the template's existing repeat, or removes it", async () => {
    mocked.automations.mockResolvedValue([REPEAT])
    const { user } = setup()
    await screen.findByRole('button', { name: 'Remove repeat' })
    await user.click(screen.getByRole('switch', { name: 'Turned on' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocked.saveAutomation).toHaveBeenCalledTimes(1))
    const [sent, opts] = mocked.saveAutomation.mock.calls[0]
    expect(opts).toEqual({ baseRevision: 'q1' })
    expect(sent).toMatchObject({ id: 'rep', enabled: false, trigger: REPEAT.trigger })
    expect(mocked.createAutomation).not.toHaveBeenCalled()
  })

  test('Remove repeat deletes the rule', async () => {
    mocked.automations.mockResolvedValue([REPEAT])
    const { user, onOpenChange } = setup()
    await user.click(await screen.findByRole('button', { name: 'Remove repeat' }))
    await waitFor(() => expect(mocked.deleteAutomation).toHaveBeenCalledWith('rep'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
