import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ApiError, RevisionConflictError } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { automationRule, typeDef } from '@/test/mockApi'
import { RuleEditorDialog } from './RuleEditor'

const mocked = vi.mocked(api)
const TASK = typeDef({ id: 'task', name: 'Task' })
const RULE = automationRule({ id: 'r1', name: 'Stamp done', revision: 'a1', actions: [{ kind: 'notify', title: '', body: 'Hi' }] })

beforeEach(() => {
  vi.clearAllMocks()
  resetLinkIndex()
  useLinkIndex.setState({ types: [TASK] })
})

function setup(props: Partial<Parameters<typeof RuleEditorDialog>[0]> = {}) {
  const onOpenChange = vi.fn()
  const onSaved = vi.fn()
  render(<RuleEditorDialog open rule={RULE} onOpenChange={onOpenChange} onSaved={onSaved} {...props} />)
  return { onOpenChange, onSaved, user: userEvent.setup() }
}

describe('RuleEditorDialog', () => {
  test('saves an edited rule with its base revision', async () => {
    const { user, onSaved, onOpenChange } = setup()
    const dialog = screen.getByRole('dialog', { name: 'Edit automation' })
    const name = within(dialog).getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Notify me')
    await user.click(within(dialog).getByRole('switch', { name: 'Turned on' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocked.saveAutomation).toHaveBeenCalledTimes(1))
    const [sent, opts] = mocked.saveAutomation.mock.calls[0]
    expect(opts).toEqual({ baseRevision: 'a1' })
    expect(sent).toMatchObject({ id: 'r1', name: 'Notify me', enabled: false, actions: RULE.actions })
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1', revision: 'a1+1' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('asks for what is missing before sending', async () => {
    const { user } = setup({ rule: null })
    const dialog = screen.getByRole('dialog', { name: 'New automation' })
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Give the automation a name.')
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Empty')
    expect(within(dialog).queryByRole('alert')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Add at least one action.')
    expect(mocked.createAutomation).not.toHaveBeenCalled()
  })

  test('creates a new rule from its starting fields', async () => {
    const { user, onSaved } = setup({
      rule: null,
      initial: {
        name: 'Remind',
        trigger: { kind: 'button', scope: { kind: 'type', id: 'task' } },
        actions: [{ kind: 'notify', title: '', body: 'Look at {title}' }],
      },
    })
    const dialog = screen.getByRole('dialog', { name: 'New automation' })
    expect(within(dialog).getByRole('button', { name: 'Trigger' })).toHaveTextContent('A button is pressed')
    expect(within(dialog).getByRole('button', { name: 'Objects' })).toHaveTextContent('Task')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mocked.createAutomation).toHaveBeenCalledWith({
        name: 'Remind',
        description: '',
        enabled: true,
        trigger: { kind: 'button', scope: { kind: 'type', id: 'task' } },
        conditions: { type: 'filterGroup', operator: 'and', elements: [] },
        actions: [{ kind: 'notify', title: '', body: 'Look at {title}' }],
        templateRepeat: null,
      }),
    )
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: '01JNEWRULE000000000000000' }))
  })

  test("shows the server's 422 message and stays open", async () => {
    mocked.saveAutomation.mockRejectedValue(new ApiError(422, 'Unknown property "due"'))
    const { user, onOpenChange } = setup()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown property "due"')
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  test('a 409 reloads the rule; saving again sends the new revision', async () => {
    mocked.saveAutomation.mockRejectedValueOnce(new RevisionConflictError('a2'))
    mocked.automation.mockResolvedValue({ ...RULE, revision: 'a2' })
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This automation was changed elsewhere.')
    expect(mocked.automation).toHaveBeenCalledWith('r1')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocked.saveAutomation).toHaveBeenCalledTimes(2))
    expect(mocked.saveAutomation.mock.calls[1][1]).toEqual({ baseRevision: 'a2' })
  })

  test('a schedule drops conditions and object actions', async () => {
    const { user } = setup({
      rule: null,
      initial: {
        name: 'Weekly',
        actions: [
          { kind: 'setProperty', key: 'done', value: true },
          { kind: 'appendToDailyNote', text: 'Review' },
        ],
      },
    })
    await user.click(screen.getByRole('button', { name: 'Trigger' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'On a schedule' }))
    expect(screen.getByText('Scheduled automations run without an object, so they have no conditions.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocked.createAutomation).toHaveBeenCalledTimes(1))
    const sent = mocked.createAutomation.mock.calls[0][0]
    expect(sent.trigger).toMatchObject({ kind: 'schedule', repeat: 'every week on mon', time: '09:00' })
    expect(sent.actions).toEqual([{ kind: 'appendToDailyNote', text: 'Review' }])
  })
})
