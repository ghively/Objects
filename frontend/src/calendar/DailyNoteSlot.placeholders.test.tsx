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

  // Fix pass H2 (M4#3): a DailyNote default template ('## Yesterday / ## Today / ## Blockers').
  const TEMPLATE = '## Yesterday\n\n## Today\n\n## Blockers\n'
  const templated = () =>
    mocked.object.mockImplementation(async (path: string) =>
      objectDetail({ summary: objectSummary({ path, type: 'dailynote' }), body: TEMPLATE, version: 'v1' }),
    )

  test('typing into a templated note puts the text in its own paragraph after the template', async () => {
    templated()
    const user = userEvent.setup()
    const { container } = render(<DailyNoteSlot day={TODAY} note={null} heading />)
    screen.getByRole('textbox', { name: DAILY_NOTE_TEXT.heading }).focus()
    await user.keyboard('templ line')
    const editor = await waitFor(() => pmEditor(container))
    await waitFor(() => expect(serializeBody(editor)).toContain('templ line'))
    await user.keyboard(' more')
    await waitFor(() => expect(serializeBody(editor).trim()).toBe('## Yesterday\n\n## Today\n\n## Blockers\n\ntempl line more'))
  })

  test('clicking a templated note then typing never glues the text to the last heading', async () => {
    templated()
    const user = userEvent.setup()
    const { container } = render(<DailyNoteSlot day={TODAY} note={null} heading />)
    await user.click(screen.getByRole('textbox', { name: DAILY_NOTE_TEXT.heading }))
    await waitFor(() => expect(document.activeElement?.classList.contains('ProseMirror')).toBe(true))
    const editor = pmEditor(container)
    await user.keyboard('templ line')
    await waitFor(() => expect(serializeBody(editor)).toContain('templ line'))
    expect(serializeBody(editor)).not.toContain('## Blockerstempl')
    expect(serializeBody(editor)).not.toMatch(/## \w*templ line/)
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

  test('adding a tag when the day already has a note (409) adds it to that note, keeping its tags', async () => {
    const user = userEvent.setup()
    const path = 'DailyNotes/Older/2026-10-23.md'
    mocked.createDailyNote.mockRejectedValueOnce(new DailyNoteExistsError('exists', path))
    mocked.object.mockResolvedValue(
      objectDetail({ summary: objectSummary({ path, type: 'dailynote', tags: ['home'] }), body: 'Morning.\n', version: 'v7' }),
    )
    const { container } = render(<DailyNoteSlot day={TODAY} note={null} heading />)
    await user.click(screen.getByRole('button', { name: 'Edit Tags' }))
    await user.type(await screen.findByRole('textbox', { name: 'Search for tags' }), 'work{Enter}')
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith(path, { tags: ['home', 'work'] }, 'v7'))
    expect(mocked.updateProperties).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(container.querySelector(`[data-object-path="${path}"]`)).not.toBeNull())
  })

  test('a tag write that fails after the note was created shows an error', async () => {
    const user = userEvent.setup()
    mocked.updateProperties.mockRejectedValueOnce(new Error('disk full'))
    const { container } = render(<DailyNoteSlot day={TODAY} note={null} heading />)
    await user.click(screen.getByRole('button', { name: 'Edit Tags' }))
    await user.type(await screen.findByRole('textbox', { name: 'Search for tags' }), 'work{Enter}')
    await waitFor(() => expect(mocked.createDailyNote).toHaveBeenCalledWith(TODAY))
    expect(await screen.findByRole('alert')).toHaveTextContent('disk full')
    // The note was made: it opens all the same.
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

  test('typed text is inserted literally, never parsed as HTML or Markdown', async () => {
    const user = userEvent.setup()
    // All of it is typed before the note's editor is ready, so the draft hands it over in one go.
    let finishLoad!: () => void
    mocked.object.mockImplementationOnce(
      (path: string) =>
        new Promise((resolve) => {
          finishLoad = () => resolve(objectDetail({ summary: objectSummary({ path, type: 'dailynote' }), body: '', version: 'v1' }))
        }),
    )
    const { container } = render(<DailyNoteSlot day={TODAY} note={null} heading />)
    screen.getByRole('textbox', { name: DAILY_NOTE_TEXT.heading }).focus()
    await user.keyboard('<b>x</b> **y**')
    await waitFor(() => expect(mocked.object).toHaveBeenCalled())
    finishLoad()
    const editor = await waitFor(() => pmEditor(container))
    await waitFor(() => expect(editor.getText()).toBe('<b>x</b> **y**'))
    expect(container.querySelector('.ProseMirror strong, .ProseMirror b')).toBeNull()
  })

  test('text typed while a slow create is in flight all arrives', async () => {
    const user = userEvent.setup()
    let finishCreate!: () => void
    mocked.createDailyNote.mockImplementationOnce(
      (date: string) =>
        new Promise((resolve) => {
          finishCreate = () => resolve({ path: `DailyNotes/${date}.md`, version: 'v1', typeIds: [] })
        }),
    )
    let finishLoad!: () => void
    mocked.object.mockImplementationOnce(
      (path: string) =>
        new Promise((resolve) => {
          finishLoad = () => resolve(objectDetail({ summary: objectSummary({ path, type: 'dailynote' }), body: '', version: 'v1' }))
        }),
    )
    const { container } = render(<DailyNoteSlot day={TODAY} note={null} heading />)
    const draft = screen.getByRole('textbox', { name: DAILY_NOTE_TEXT.heading })
    draft.focus()
    await user.keyboard('Hel')
    await waitFor(() => expect(mocked.createDailyNote).toHaveBeenCalledTimes(1))
    finishCreate()
    // The note exists but its editor is still loading: keep typing.
    await waitFor(() => expect(mocked.object).toHaveBeenCalled())
    await user.keyboard('lo')
    finishLoad()
    const editor = await waitFor(() => pmEditor(container))
    await waitFor(() => expect(editor.getText()).toBe('Hello'))
    await user.keyboard(' world')
    await waitFor(() => expect(editor.getText()).toBe('Hello world'))
    expect(mocked.createDailyNote).toHaveBeenCalledTimes(1)
  })

  test('on a 409 the typed text goes at the end of the existing note', async () => {
    const user = userEvent.setup()
    const path = 'DailyNotes/Older/2026-10-23.md'
    mocked.createDailyNote.mockRejectedValueOnce(new DailyNoteExistsError('exists', path))
    mocked.object.mockResolvedValue(
      objectDetail({ summary: objectSummary({ path, type: 'dailynote' }), body: 'Morning.\n', version: 'v5' }),
    )
    const { container } = render(<DailyNoteSlot day={TODAY} note={null} heading />)
    screen.getByRole('textbox', { name: DAILY_NOTE_TEXT.heading }).focus()
    await user.keyboard('Hi')
    const editor = await waitFor(() => pmEditor(container))
    await waitFor(() => expect(serializeBody(editor).trim()).toBe('Morning.\n\nHi'))
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
