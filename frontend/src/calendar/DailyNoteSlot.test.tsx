import type { Editor as TiptapEditor } from '@tiptap/core'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { DailyNoteExistsError } from '@/api/client'
import { serializeBody } from '@/editor/document'
import { objectDetail, objectSummary } from '@/test/mockApi'
import { mocked, resetDayMocks, TODAY } from './dayFixtures'
import { DailyNoteSlot } from './DailyNoteSlot'

beforeEach(() => {
  resetDayMocks()
})

function pmEditor(container: HTMLElement): TiptapEditor {
  const dom = container.querySelector('.ProseMirror') as (HTMLElement & { editor?: TiptapEditor }) | null
  if (!dom?.editor) throw new Error('editor not mounted')
  return dom.editor
}

describe('DailyNoteSlot', () => {
  test('test + Daily Note creates for the day and shows the editor; 409 opens the existing note', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    const { container, rerender } = render(<DailyNoteSlot day={TODAY} note={null} heading emptyPlaceholders={false} onChanged={onChanged} />)
    expect(screen.getByText('Daily note')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Daily Note' }))
    expect(mocked.createDailyNote).toHaveBeenCalledWith(TODAY)
    await waitFor(() => expect(container.querySelector('[data-object-view="inline"]')).not.toBeNull())
    expect(container.querySelector('[data-object-path="DailyNotes/2026-10-23.md"]')).not.toBeNull()
    await waitFor(() => expect(document.activeElement?.classList.contains('ProseMirror')).toBe(true))
    expect(screen.getByTestId('inline-placeholder')).toHaveTextContent('Start your daily note')
    expect(onChanged).toHaveBeenCalled()
    // The inline view has no property panel or header; the note's own `…` menu (the object page's) sits
    // in the Daily note header's pill.
    expect(screen.queryByRole('button', { name: 'Hide properties' })).toBeNull()
    expect(await within(screen.getByTestId('daily-note-pill')).findByRole('button', { name: 'More' })).toBeInTheDocument()

    // Another day: a 409 shows the note that already exists.
    mocked.createDailyNote.mockRejectedValueOnce(new DailyNoteExistsError('exists', 'DailyNotes/Older/2026-10-24.md'))
    rerender(<DailyNoteSlot day="2026-10-24" note={null} heading emptyPlaceholders={false} onChanged={onChanged} />)
    await user.click(screen.getByRole('button', { name: 'Daily Note' }))
    await waitFor(() => expect(container.querySelector('[data-object-path="DailyNotes/Older/2026-10-24.md"]')).not.toBeNull())
    expect(mocked.object).toHaveBeenCalledWith('DailyNotes/Older/2026-10-24.md')
  })

  test('test 409 name taken by another file shows the error and keeps the button', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    mocked.createDailyNote.mockRejectedValueOnce(
      new DailyNoteExistsError('A file with that name already exists.', 'DailyNotes/2026-11-01.md', 'nameTaken'),
    )
    const { container } = render(<DailyNoteSlot day="2026-11-01" note={null} heading emptyPlaceholders={false} onChanged={onChanged} />)
    await user.click(screen.getByRole('button', { name: 'Daily Note' }))
    expect(await screen.findByText('A file with that name already exists.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Daily Note' })).toBeInTheDocument()
    expect(container.querySelector('[data-object-view="inline"]')).toBeNull()
    expect(container.querySelector('[data-object-path="DailyNotes/2026-11-01.md"]')).toBeNull()
    // No note yet: no header pill, so no menu.
    expect(screen.queryByTestId('daily-note-pill')).toBeNull()
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
    expect(mocked.object).not.toHaveBeenCalledWith('DailyNotes/2026-11-01.md')
  })

  test('test inline editor autosaves the body with the note\'s version', async () => {
    const path = 'DailyNotes/2026-10-23.md'
    mocked.object.mockResolvedValue(
      objectDetail({ summary: objectSummary({ path, type: 'dailynote' }), body: 'Morning.\n', version: 'v5' }),
    )
    const { container } = render(<DailyNoteSlot day={TODAY} note={{ path }} heading />)
    const editor = await waitFor(() => pmEditor(container))
    await waitFor(() => expect(serializeBody(editor)).toBe('Morning.\n'))
    expect(screen.queryByTestId('inline-placeholder')).toBeNull()
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' Coffee.')
    })
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledWith(path, 'Morning. Coffee.\n', 'v5'), { timeout: 3000 })
  })

  test("the header pill holds the extra control left of the note's full object menu", async () => {
    const path = 'DailyNotes/2026-10-23.md'
    render(<DailyNoteSlot day={TODAY} note={{ path }} heading headerExtra={<button type="button">Extra</button>} />)
    const pill = screen.getByTestId('daily-note-pill')
    const menu = await within(pill).findByRole('button', { name: 'More' })
    const extra = within(pill).getByRole('button', { name: 'Extra' })
    // Extra first, then the menu's slot.
    expect(extra.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(pill.contains(screen.getByTestId('daily-note-menu-slot'))).toBe(true)
  })

  test('the multi-day views (no heading) draw no menu of their own', async () => {
    const path = 'DailyNotes/2026-10-23.md'
    render(<DailyNoteSlot day={TODAY} note={{ path }} />)
    await waitFor(() => expect(mocked.object).toHaveBeenCalled())
    expect(screen.queryByTestId('daily-note-pill')).toBeNull()
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
  })

  test("the note's menu is the object page's: its actions, and delete goes to the trash", async () => {
    const user = userEvent.setup()
    const path = 'DailyNotes/2026-10-23.md'
    const onChanged = vi.fn()
    render(<DailyNoteSlot day={TODAY} note={{ path }} heading onChanged={onChanged} />)
    await user.click(await within(screen.getByTestId('daily-note-pill')).findByRole('button', { name: 'More' }))
    for (const name of ['Open in new tab', 'Present', 'Export', 'Version History', 'Object Type Settings']) {
      expect(await screen.findByRole('menuitem', { name: new RegExp(name) })).toBeInTheDocument()
    }
    await user.click(screen.getByRole('menuitem', { name: /^Delete/ }))
    await user.click(await screen.findByRole('button', { name: 'Delete Object' }))
    await waitFor(() => expect(mocked.deleteObject).toHaveBeenCalledWith(path, { baseVersion: 'v1' }))
    // The calendar is told, so it can show "+ Daily Note" for the day again.
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })
})
