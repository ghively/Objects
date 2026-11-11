import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { useSettings } from '@/settings/useSettings'
import { LOAD_PAGE } from '@/views/model'
import { TaskList } from './TaskList'
import { TASK_TYPE, taskRow } from './taskFixtures'

const day = (start: string) => ({ start, resolution: 'day' as const })

beforeEach(() => {
  useTabs.getState().reset()
  usePeek.getState().close()
})

describe('TaskList', () => {
  test('test a group header shows its count once and a row has the tick, the title and the date chip', () => {
    const late = taskRow('Tasks/Late.md', { status: ['Next Up'], date: day('2020-01-02'), priority: ['High'] })
    render(
      <TaskList
        groups={[
          { id: 'overdue', label: 'Overdue', rows: [late] },
          { id: 'plain', label: null, rows: [taskRow('Tasks/Loose.md', { status: ['Done'] })] },
        ]}
        type={TASK_TYPE}
        empty="Nothing"
      />,
    )
    const group = document.querySelector('[data-task-group="overdue"]') as HTMLElement
    expect(within(group).getByRole('heading', { level: 2 })).toHaveTextContent(/^Overdue \(1\)$/)
    expect(group.textContent?.match(/1\)/g)).toHaveLength(1)
    const row = within(group).getByRole('listitem')
    expect(within(row).getByRole('checkbox')).toHaveAttribute('aria-checked', 'false')
    expect(within(row).getByRole('button', { name: 'Late' })).toBeInTheDocument()
    expect(within(row).getByTestId('task-date')).toHaveAttribute('data-overdue')
    expect(within(row).getByText('High')).toBeInTheDocument()
    // A group without a label has no header; a done task's title is struck.
    const plain = document.querySelector('[data-task-group="plain"]') as HTMLElement
    expect(within(plain).queryByRole('heading')).toBeNull()
    expect(within(plain).getByText('Loose').className).toContain('line-through')
    expect(within(plain).getByRole('listitem')).toHaveAttribute('data-done')
  })

  test('a click on the title opens the task; Ctrl-click in a new tab', async () => {
    const user = userEvent.setup()
    useSettings.setState((s) => ({ settings: { ...s.settings, alwaysOpenAsFullPage: true } }))
    render(<TaskList groups={[{ id: 'g', label: null, rows: [taskRow('Tasks/A.md'), taskRow('Tasks/B.md')] }]} type={TASK_TYPE} empty="Nothing" />)
    await user.click(screen.getByRole('button', { name: 'A' }))
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Tasks/A.md' })
    await user.keyboard('{Control>}')
    await user.click(screen.getByRole('button', { name: 'B' }))
    await user.keyboard('{/Control}')
    expect(useTabs.getState().tabs).toHaveLength(2)
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Tasks/B.md' })
  })

  // Fifty-five rows, each with its popovers: slow on a busy machine.
  test('an empty list says so, and a long one loads more', { timeout: 30_000 }, async () => {
    const user = userEvent.setup()
    const { rerender } = render(<TaskList groups={[]} type={TASK_TYPE} empty="No tasks today" />)
    expect(screen.getByText('No tasks today')).toBeInTheDocument()
    const many = Array.from({ length: LOAD_PAGE + 5 }, (_, i) => taskRow(`Tasks/T${String(i).padStart(3, '0')}.md`))
    rerender(<TaskList groups={[{ id: 'g', label: 'Later', rows: many }]} type={TASK_TYPE} empty="No tasks today" />)
    expect(screen.getAllByRole('listitem')).toHaveLength(LOAD_PAGE)
    // The header counts the whole group.
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(`Later (${LOAD_PAGE + 5})`)
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(LOAD_PAGE + 5)
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })
})
