import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetAutomations } from '@/automations/useAutomations'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { automationRule, propertyDef, typeDef } from '@/test/mockApi'
import { ButtonSettingsSection, withRule } from './ButtonSettings'

const mocked = vi.mocked(api)
const DEF = propertyDef({ id: 'p', key: 'review', name: 'Start review', type: 'button', options: { ruleId: null } })
const TASK = typeDef({ id: 'task', name: 'Task', propertyDefinitions: [DEF] })

beforeEach(() => {
  vi.clearAllMocks()
  resetAutomations()
  resetLinkIndex()
  useLinkIndex.setState({ types: [TASK] })
  mocked.automations.mockResolvedValue([
    automationRule({ id: 'r1', name: 'Stamp done' }),
    automationRule({ id: 'r2', name: 'Weekly', trigger: { kind: 'schedule', repeat: 'every day', time: '09:00', start: '2026-11-05' } }),
  ])
})

describe('ButtonSettingsSection', () => {
  test('withRule keeps the other options', () => {
    expect(withRule({ ...DEF, options: { ruleId: null, extra: 1 } }, 'r1').options).toEqual({ ruleId: 'r1', extra: 1 })
  })

  test('picks one of the button rules', async () => {
    const user = userEvent.setup()
    const save = vi.fn()
    render(<ButtonSettingsSection type={TASK} def={DEF} save={save} />)
    const trigger = screen.getByRole('button', { name: 'Automation' })
    expect(trigger).toHaveTextContent('Choose an automation')
    await waitFor(() => expect(mocked.automations).toHaveBeenCalled())
    await user.click(trigger)
    const items = await screen.findAllByRole('menuitemradio')
    // Only button rules are offered.
    expect(items.map((i) => i.textContent)).toEqual(['Stamp done'])
    await user.click(items[0])
    expect(save).toHaveBeenCalledWith(withRule(DEF, 'r1'))
  })

  test('names the chosen rule, or says it is gone', async () => {
    const { rerender } = render(<ButtonSettingsSection type={TASK} def={withRule(DEF, 'r1')} save={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Automation' })).toHaveTextContent('Stamp done'))
    rerender(<ButtonSettingsSection type={TASK} def={withRule(DEF, 'gone')} save={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Automation' })).toHaveTextContent('Automation not found')
  })

  test('New automation… makes a button rule for this type and chooses it', async () => {
    const user = userEvent.setup()
    const save = vi.fn()
    mocked.createAutomation.mockImplementation(async (input) => automationRule({ ...input, id: 'new1' }))
    render(<ButtonSettingsSection type={TASK} def={DEF} save={save} />)
    await user.click(screen.getByRole('button', { name: 'Automation' }))
    await user.click(await screen.findByRole('menuitem', { name: 'New automation…' }))
    const dialog = await screen.findByRole('dialog', { name: 'New automation' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Start review')
    expect(screen.getByRole('button', { name: 'Notes' })).toHaveTextContent('Task')
    await user.click(screen.getByRole('button', { name: '+ Add action' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Send a notification' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(withRule(DEF, 'new1')))
    expect(mocked.createAutomation.mock.calls[0][0]).toMatchObject({
      name: 'Start review',
      trigger: { kind: 'button', scope: { kind: 'type', id: 'task' } },
      actions: [{ kind: 'notify' }],
    })
  })
})
