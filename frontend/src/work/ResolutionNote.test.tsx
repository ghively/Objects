import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/editor/media/upload', async (orig) => ({ ...(await orig()), showToast: vi.fn() }))
vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { ResolutionNote as Note } from '@/api/types'
import { showToast } from '@/editor/media/upload'
import { workItem } from '@/test/mockApi'
import { ResolutionNote, ResolutionNoteSection, RESOLUTION_TEXT } from './ResolutionNote'

const mocked = vi.mocked(api)

const NOTE: Note = {
  workNotes: 'Work notes: INC0012345 Printer jams on line 3\nReported: The printer jams.\nChecked:\n- [fill in: what was checked]',
  closeNotes: 'Close notes: INC0012345 Printer jams on line 3\nCause: [fill in: the cause]\nVerification: Spooler restarted, 20 test prints clean',
  gaps: 2,
}

beforeEach(() => {
  vi.mocked(showToast).mockReset()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
})

describe('ResolutionNote', () => {
  test('two blocks, each copied exactly by its own Copy button', async () => {
    const user = userEvent.setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText')
    render(<ResolutionNote note={NOTE} />)
    const work = screen.getByRole('region', { name: 'Work notes' })
    const close = screen.getByRole('region', { name: 'Close notes' })
    expect(within(work).getByRole('heading', { name: 'Work notes' })).toBeInTheDocument()
    expect(within(close).getByRole('heading', { name: 'Close notes' })).toBeInTheDocument()
    // The text is shown as text, in a monospace block, never as JSON.
    expect(within(work).getByText(/Reported: The printer jams\./).tagName).toBe('PRE')
    expect(document.body.textContent).not.toContain('"workNotes"')
    expect(document.body.textContent).not.toContain('{')

    await user.click(within(work).getByRole('button', { name: 'Copy' }))
    expect(write).toHaveBeenLastCalledWith(NOTE.workNotes)
    expect(await navigator.clipboard.readText()).toBe(NOTE.workNotes)
    await user.click(within(close).getByRole('button', { name: 'Copy' }))
    expect(write).toHaveBeenLastCalledWith(NOTE.closeNotes)
    // Success shows nothing.
    expect(showToast).not.toHaveBeenCalled()
  })

  test('a failed copy shows a toast', async () => {
    const user = userEvent.setup()
    render(<ResolutionNote note={NOTE} />)
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('Clipboard blocked'))
    await user.click(within(screen.getByRole('region', { name: 'Work notes' })).getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(RESOLUTION_TEXT.copyFailed))
  })

  test('the count of gaps to fill in', () => {
    const { rerender } = render(<ResolutionNote note={NOTE} />)
    expect(screen.getByText('2 to fill in')).toBeInTheDocument()
    rerender(<ResolutionNote note={{ ...NOTE, gaps: 0 }} />)
    expect(screen.queryByText(/to fill in/)).not.toBeInTheDocument()
  })
})

describe('ResolutionNoteSection', () => {
  test('collapsed by default; opening it reads the item and shows its note', async () => {
    const user = userEvent.setup()
    mocked.workItem.mockResolvedValue(workItem({ resolution: NOTE }))
    render(<ResolutionNoteSection path="Tasks/Printer jams on line 3.md" version="v1" />)
    const toggle = screen.getByRole('button', { name: 'Resolution note' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(mocked.workItem).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Work notes' })).not.toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('region', { name: 'Work notes' })).toBeInTheDocument()
    expect(mocked.workItem).toHaveBeenCalledWith('Tasks/Printer jams on line 3.md')
  })

  test('a note handed in (a work write result) is shown without a read', async () => {
    const user = userEvent.setup()
    render(<ResolutionNoteSection path="Tasks/Printer jams on line 3.md" version="v2" note={NOTE} />)
    await user.click(screen.getByRole('button', { name: 'Resolution note' }))
    expect(screen.getByRole('region', { name: 'Close notes' })).toBeInTheDocument()
    expect(mocked.workItem).not.toHaveBeenCalled()
  })
})
