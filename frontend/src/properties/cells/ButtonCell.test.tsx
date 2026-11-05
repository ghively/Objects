import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/editor/media/upload', async (orig) => ({ ...(await orig()), showToast: vi.fn() }))

import { api } from '@/api/client'
import { resetAutomations } from '@/automations/useAutomations'
import { showToast } from '@/editor/media/upload'
import { automationRule, automationRun, propertyDef } from '@/test/mockApi'
import { ButtonCell } from './ButtonCell'

const mocked = vi.mocked(api)
const def = (ruleId: string | null) => propertyDef({ id: 'p', key: 'review', name: 'Start review', type: 'button', options: { ruleId } })

beforeEach(() => {
  vi.clearAllMocks()
  resetAutomations()
  mocked.automations.mockResolvedValue([
    automationRule({ id: 'on' }),
    automationRule({ id: 'off', enabled: false }),
    automationRule({ id: 'ro', readOnlyReason: 'Written by a newer version.' }),
  ])
})

const cell = (ruleId: string | null, extra: { path?: string; readOnly?: boolean } = { path: 'Tasks/A.md' }) =>
  render(<ButtonCell def={def(ruleId)} value={null} onChange={vi.fn()} {...extra} />)

describe('ButtonCell', () => {
  test("runs the rule on the cell's object and shows the result", async () => {
    const user = userEvent.setup()
    const outer = vi.fn()
    render(
      <div onClick={outer}>
        <ButtonCell def={def('on')} value={null} onChange={vi.fn()} path="Tasks/A.md" />
      </div>,
    )
    const button = screen.getByRole('button', { name: 'Start review' })
    await waitFor(() => expect(mocked.automations).toHaveBeenCalled())
    await user.click(button)
    await waitFor(() => expect(mocked.runAutomation).toHaveBeenCalledWith('on', 'Tasks/A.md'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Done'))
    expect(outer).not.toHaveBeenCalled()
  })

  test("a failed run shows the run's error", async () => {
    mocked.runAutomation.mockResolvedValue(automationRun({ ruleId: 'on', status: 'failed', error: 'Tag not found' }))
    const user = userEvent.setup()
    cell('on')
    await user.click(screen.getByRole('button', { name: 'Start review' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Tag not found'))
  })

  test.each([
    [null, "Choose an automation in the property's settings"],
    ['off', 'This automation is turned off.'],
    ['ro', 'Written by a newer version.'],
    ['gone', 'Automation not found'],
  ])('rule %j: disabled with the reason', async (ruleId, reason) => {
    cell(ruleId)
    const button = screen.getByRole('button', { name: 'Start review' })
    await waitFor(() => expect(button).toHaveAttribute('title', reason))
    expect(button).toBeDisabled()
  })

  test('no object or a read-only object: disabled', async () => {
    cell('on', {})
    expect(screen.getByRole('button', { name: 'Start review' })).toBeDisabled()
  })

  test('never writes a value', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ButtonCell def={def('on')} value={null} onChange={onChange} path="Tasks/A.md" />)
    await waitFor(() => expect(mocked.automations).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Start review' }))
    await waitFor(() => expect(mocked.runAutomation).toHaveBeenCalled())
    expect(onChange).not.toHaveBeenCalled()
  })
})
