import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { usePeek, useTabs } from '@/nav/tabs'
import { QuickAddTask } from './QuickAddTask'

const mocked = vi.mocked(api)

beforeEach(() => {
  useTabs.getState().reset()
  usePeek.getState().close()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.createObject.mockResolvedValue({ path: 'Tasks/Call Ana.md', version: 'v1' })
})

describe('QuickAddTask', () => {
  test('test quick add creates a task and keeps focus', async () => {
    const user = userEvent.setup()
    render(<QuickAddTask taskTypeId="task-type" />)
    const input = screen.getByPlaceholderText('Task title')
    await user.click(input)
    await user.type(input, 'Call Ana{Enter}')
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('task-type', { title: 'Call Ana' }))
    expect(await screen.findByText('Created task "Call Ana"')).toBeInTheDocument()
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
    // Nothing opens: the quick add stays where it is.
    expect(usePeek.getState().path).toBeNull()
    expect(useTabs.getState().tabs.length).toBeLessThanOrEqual(1)
  })

  test('the Add task button creates with the view values; a blank title does nothing', async () => {
    const user = userEvent.setup()
    render(<QuickAddTask taskTypeId="task" values={() => ({ priority: ['High'] })} />)
    expect(screen.getByRole('button', { name: 'Add task' })).toBeDisabled()
    await user.type(screen.getByPlaceholderText('Task title'), '   {Enter}')
    expect(mocked.createObject).not.toHaveBeenCalled()
    await user.clear(screen.getByPlaceholderText('Task title'))
    await user.type(screen.getByPlaceholderText('Task title'), 'Pay rent')
    await user.click(screen.getByRole('button', { name: 'Add task' }))
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('task', { title: 'Pay rent', values: { priority: ['High'] } }))
  })
})
