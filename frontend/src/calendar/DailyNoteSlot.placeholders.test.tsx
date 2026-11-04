// A day with no daily note yet: the inline note shows its placeholder rows (Tags, the body
// placeholder). Viewing writes nothing; typing in the body or adding a tag creates the note then.
import type { Editor as TiptapEditor } from '@tiptap/core'
import { render, screen, waitFor, within } from '@testing-library/react'
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
import { DAILY_NOTE_TEXT, DailyNoteSlot } from './DailyNoteSlot'

beforeEach(() => {
  resetDayMocks()
})

function pmEditor(container: HTMLElement): TiptapEditor {
  const dom = container.querySelector('.ProseMirror') as (HTMLElement & { editor?: TiptapEditor }) | null
  if (!dom?.editor) throw new Error('editor not mounted')
  return dom.editor
}

const WRITES = ['createDailyNote', 'createObject', 'updateProperties', 'saveBody', 'ensureTag', 'deleteObject'] as const

function expectNoWrites() {
  for (const name of WRITES) {
    const fn = (mocked as Record<string, ReturnType<typeof vi.fn> | undefined>)[name]
    if (fn) expect(fn, name).not.toHaveBeenCalled()
  }
}

describe('DailyNoteSlot: an empty day', () => {
  test('shows the Tags row and the body placeholder, not a create button', () => {
    render(<DailyNoteSlot day={TODAY} note={null} heading />)
    const slot = screen.getByTestId('daily-note-slot')
    expect(within(slot).getByRole('button', { name: 'Edit Tags' })).toHaveTextContent('Tags')
    const body = within(slot).getByRole('textbox', { name: DAILY_NOTE_TEXT.heading })
    expect(within(slot).getByTestId('daily-note-placeholder')).toHaveTextContent(DAILY_NOTE_TEXT.placeholder)
    expect(body).toBeInTheDocument()
    expect(within(slot).queryByRole('button', { name: 'Daily Note' })).toBeNull()
  })

  test('rendering it writes nothing', async () => {
    const { rerender } = render(<DailyNoteSlot day={TODAY} note={null} heading />)
    rerender(<DailyNoteSlot day="2026-10-24" note={null} heading />)
    await new Promise((r) => setTimeout(r, 50))
    expectNoWrites()
    expect(mocked.object).not.toHaveBeenCalled()
  })

  test('typing creates the note and places the text in it', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    const { container } = render(<DailyNoteSlot day={TODAY} note={null} heading onChanged={onChanged} />)
    expectNoWrites()
    screen.getByRole('textbox', { name: DAILY_NOTE_TEXT.heading }).focus()
    await user.keyboard('Hello')
    await waitFor(() => expect(mocked.createDailyNote).toHaveBeenCalledWith(TODAY))
    expect(mocked.createDailyNote).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(container.querySelector('[data-object-path="DailyNotes/2026-10-23.md"]')).not.toBeNull())
    const editor = await waitFor(() => pmEditor(container))
    await waitFor(() => expect(serializeBody(editor).trim()).toBe('Hello'))
    await waitFor(() => expect(document.activeElement?.classList.contains('ProseMirror')).toBe(true))
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledWith('DailyNotes/2026-10-23.md', expect.stringMatching(/^Hello\n?$/), 'v1'), {
      timeout: 3000,
    })
    expect(onChanged).toHaveBeenCalled()
  })

  test('clicking the body creates the note and focuses its editor', async () => {
    const user = userEvent.setup()
    const { container } = render(<DailyNoteSlot day={TODAY} note={null} heading />)
    await user.click(screen.getByRole('textbox', { name: DAILY_NOTE_TEXT.heading }))
    await waitFor(() => expect(mocked.createDailyNote).toHaveBeenCalledWith(TODAY))
    await waitFor(() => expect(container.querySelector('[data-object-view="inline"]')).not.toBeNull())
    await waitFor(() => expect(document.activeElement?.classList.contains('ProseMirror')).toBe(true))
  })

  test('adding a tag creates the note with that tag', async () => {
    const user = userEvent.setup()
    const { container } = render(<DailyNoteSlot day={TODAY} note={null} heading />)
    await user.click(screen.getByRole('button', { name: 'Edit Tags' }))
    await user.type(await screen.findByRole('textbox', { name: 'Search for tags' }), 'work{Enter}')
    await waitFor(() => expect(mocked.createDailyNote).toHaveBeenCalledWith(TODAY))
    await waitFor(() =>
      expect(mocked.updateProperties).toHaveBeenCalledWith('DailyNotes/2026-10-23.md', { tags: ['work'] }, 'v1'),
    )
    await waitFor(() => expect(container.querySelector('[data-object-path="DailyNotes/2026-10-23.md"]')).not.toBeNull())
  })

  test('typing when the day already has a note (409) opens that note with the text', async () => {
    const user = userEvent.setup()
    mocked.createDailyNote.mockRejectedValueOnce(new DailyNoteExistsError('exists', 'DailyNotes/Older/2026-10-23.md'))
    const { container } = render(<DailyNoteSlot day={TODAY} note={null} heading />)
    screen.getByRole('textbox', { name: DAILY_NOTE_TEXT.heading }).focus()
    await user.keyboard('Hi')
    await waitFor(() => expect(container.querySelector('[data-object-path="DailyNotes/Older/2026-10-23.md"]')).not.toBeNull())
    const editor = await waitFor(() => pmEditor(container))
    await waitFor(() => expect(serializeBody(editor).trim()).toBe('Hi'))
  })

  test('the multi-day views keep the "+ Daily Note" button', () => {
    render(<DailyNoteSlot day={TODAY} note={null} />)
    expect(screen.getByRole('button', { name: 'Daily Note' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: DAILY_NOTE_TEXT.heading })).toBeNull()
  })
})

describe('DailyNoteSlot: an existing note', () => {
  test('shows its own Tags row from the note', async () => {
    const path = 'DailyNotes/2026-10-23.md'
    mocked.object.mockResolvedValue(
      objectDetail({ summary: objectSummary({ path, type: 'dailynote', tags: ['work'] }), body: 'Morning.\n', version: 'v5' }),
    )
    render(<DailyNoteSlot day={TODAY} note={{ path }} heading />)
    const tags = await waitFor(() => {
      const el = document.querySelector('[data-object-view="inline"] [data-header-tags]')
      if (!el) throw new Error('no tags row')
      return el as HTMLElement
    })
    expect(within(tags).getByRole('button', { name: 'work' })).toBeInTheDocument()
    expect(screen.queryByTestId('daily-note-placeholder')).toBeNull()
    expectNoWrites()
  })

  test('adding a tag to it writes only the tags', async () => {
    const user = userEvent.setup()
    const path = 'DailyNotes/2026-10-23.md'
    mocked.object.mockResolvedValue(
      objectDetail({ summary: objectSummary({ path, type: 'dailynote' }), body: 'Morning.\n', version: 'v5' }),
    )
    render(<DailyNoteSlot day={TODAY} note={{ path }} heading />)
    await user.click(await screen.findByRole('button', { name: 'Edit Tags' }))
    await user.type(await screen.findByRole('textbox', { name: 'Search for tags' }), 'work{Enter}')
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith(path, { tags: ['work'] }, 'v5', undefined))
    expect(mocked.createDailyNote).not.toHaveBeenCalled()
  })
})
