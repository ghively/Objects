import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { formatDate } from '@/properties/format'
import { CompletionLog, parseLogEntries, withoutLine } from './CompletionLog'

const LOG = [
  '2026-10-21 completed 2026-10-21T07:55:10Z',
  'not a log line',
  '2026-10-22 skipped 2026-10-23T06:30:00Z',
  '2026-10-23 excused 2026-10-23T08:10:00Z',
].join('\n')

const day = (d: string) => formatDate({ start: d, resolution: 'day' })

describe('CompletionLog', () => {
  test('test completion log lists entries newest first', () => {
    render(<CompletionLog log={LOG} onChange={() => {}} />)
    const section = screen.getByRole('region', { name: 'Completion Log' })
    expect(within(section).getByRole('heading', { name: 'Completion Log' })).toBeInTheDocument()
    const items = within(section).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([
      `${day('2026-10-23')}Excused`,
      `${day('2026-10-22')}Skipped`,
      `${day('2026-10-21')}Completed`,
    ])
  })

  test('test delete completion log entry asks and writes the remaining lines', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CompletionLog log={LOG} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: `Delete ${day('2026-10-22')}` }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Delete completion log entry')).toBeInTheDocument()
    expect(within(dialog).getByText('This log entry will be permanently removed from the completion history.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: `Delete ${day('2026-10-22')}` }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
    // Only that entry's line goes; the unparseable line is kept as is.
    expect(onChange).toHaveBeenCalledWith(
      ['2026-10-21 completed 2026-10-21T07:55:10Z', 'not a log line', '2026-10-23 excused 2026-10-23T08:10:00Z'].join('\n'),
    )
  })

  test('deleting the last line removes the key; read-only and empty logs', () => {
    expect(withoutLine('2026-10-21 completed 2026-10-21T07:55:10Z', 0)).toBeNull()
    expect(parseLogEntries('2026-10-21T09:00:00Z completed 2026-10-21T09:05:00Z')[0].scheduled).toBe('2026-10-21T09:00:00Z')
    const { container, unmount } = render(<CompletionLog log={null} onChange={() => {}} />)
    expect(container).toBeEmptyDOMElement()
    unmount()
    render(<CompletionLog log={LOG} readOnly onChange={() => {}} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
