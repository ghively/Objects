import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { QuickAddTask } from './QuickAddTask'
import { TASK_TYPE } from './taskFixtures'

const mocked = vi.mocked(api)

/** Wednesday 11 November 2026, 10:00 local. */
const NOW = new Date(2026, 10, 11, 10, 0, 0)

beforeEach(() => {
  resetLinkIndex()
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
    const input = screen.getByPlaceholderText('Add a task')
    expect(input).toBe(screen.getByRole('textbox', { name: 'Add a task' }))
    await user.click(input)
    await user.type(input, 'Call Ana{Enter}')
    // M32, item 13: the body is sent empty, so the file's text does not repeat the title.
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('task-type', { title: 'Call Ana', body: '' }))
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
    await user.type(screen.getByPlaceholderText('Add a task'), '   {Enter}')
    expect(mocked.createObject).not.toHaveBeenCalled()
    await user.clear(screen.getByPlaceholderText('Add a task'))
    await user.type(screen.getByPlaceholderText('Add a task'), 'Pay rent')
    await user.click(screen.getByRole('button', { name: 'Add task' }))
    await waitFor(() =>
      expect(mocked.createObject).toHaveBeenCalledWith('task', { title: 'Pay rent', body: '', values: { priority: ['High'] } }),
    )
  })

  test('test a type with a default template keeps the template’s body', async () => {
    const user = userEvent.setup()
    useLinkIndex.setState({
      types: [{ ...TASK_TYPE, templates: { ids: ['t1'], defaultTemplateId: 't1' } }],
      objects: [],
      loaded: true,
    })
    render(<QuickAddTask taskTypeId="task" />)
    await user.type(screen.getByPlaceholderText('Add a task'), 'Call Ana{Enter}')
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('task', { title: 'Call Ana' }))
  })
})

// M32, item 9: date words anywhere in the text set the task's date and show as a chip.
describe('QuickAddTask date words (M32)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('test date words set the date, show as a chip while typing and leave the title', async () => {
    const user = userEvent.setup()
    render(<QuickAddTask taskTypeId="task" />)
    const input = screen.getByPlaceholderText('Add a task')
    await user.type(input, 'Call Pat')
    expect(screen.queryByTestId('quick-add-date')).toBeNull()
    await user.type(input, ' friday')
    expect(screen.getByTestId('quick-add-date')).toHaveTextContent('Nov 13, 2026')
    await user.type(input, '{Enter}')
    await waitFor(() =>
      expect(mocked.createObject).toHaveBeenCalledWith('task', {
        title: 'Call Pat',
        body: '',
        values: { date: { start: '2026-11-13', resolution: 'day' } },
      }),
    )
    await waitFor(() => expect(input).toHaveValue(''))
    expect(screen.queryByTestId('quick-add-date')).toBeNull()
    expect(input).toHaveFocus()
  })

  test('test Backspace at the start of the field removes the chip and the words stay in the title', async () => {
    const user = userEvent.setup()
    render(<QuickAddTask taskTypeId="task" values={() => ({ priority: ['High'] })} />)
    const input = screen.getByPlaceholderText<HTMLInputElement>('Add a task')
    await user.type(input, 'Plan the trip next week')
    expect(screen.getByTestId('quick-add-date')).toHaveTextContent('Nov 18, 2026')
    // Backspace inside the text edits the text.
    await user.keyboard('{Backspace}')
    expect(input).toHaveValue('Plan the trip next wee')
    await user.type(input, 'k')
    expect(screen.getByTestId('quick-add-date')).toBeInTheDocument()
    input.setSelectionRange(0, 0)
    await user.keyboard('{Backspace}')
    expect(screen.queryByTestId('quick-add-date')).toBeNull()
    expect(input).toHaveValue('Plan the trip next week')
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(mocked.createObject).toHaveBeenCalledWith('task', { title: 'Plan the trip next week', body: '', values: { priority: ['High'] } }),
    )
  })

  test('the chip’s × removes it too, and other date words typed after bring a chip back', async () => {
    const user = userEvent.setup()
    render(<QuickAddTask taskTypeId="task" />)
    const input = screen.getByPlaceholderText('Add a task')
    await user.type(input, 'Read the friday report')
    await user.click(screen.getByRole('button', { name: 'Remove date' }))
    expect(screen.queryByTestId('quick-add-date')).toBeNull()
    expect(input).toHaveValue('Read the friday report')
    expect(input).toHaveFocus()
    await user.type(input, ' tomorrow')
    expect(screen.getByTestId('quick-add-date')).toHaveTextContent('Nov 12, 2026')
  })
})
