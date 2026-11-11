import type { Editor as TiptapEditor } from '@tiptap/core'
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpaceInfo } from '@/api/types'
import { objectDetail, objectSummary, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { todayYmd } from '@/calendar/dates'
import { useCalendar } from '@/calendar/useCalendar'
import { setLastTypeSpace, useLastType } from '@/create/lastType'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { takeBodyFocus } from '@/nav/focusRequest'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { resetSpaceInfo, useSpaceInfo } from '@/settings/useSpaceInfo'
import App from './App'

const mocked = vi.mocked(api)

// The page's editor loads lazily: on a busy machine the first render can take longer than a second.
configure({ asyncUtilTimeout: 10_000 })

const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true, revision: 'r1' })
const PROJECT = typeDef({ id: 'project', name: 'Project', pluralName: 'Projects', revision: 'r1' })
const TASK = typeDef({ id: 'task', name: 'Task', pluralName: 'Tasks', basic: true, revision: 'r1' })
const PATH = 'Projects/Notes.md'
const NOTES = objectSummary({ path: PATH, type: 'project', title: 'Notes' })

beforeEach(async () => {
  localStorage.clear()
  await setLastTypeSpace(null)
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  resetSpaceInfo()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE, PROJECT, TASK] } satisfies SpaceInfo)
  mocked.objects.mockResolvedValue([NOTES])
  mocked.object.mockImplementation(async () =>
    objectDetail({ summary: NOTES, frontmatter: { type: 'Project', title: 'Notes' }, body: 'Some text.\n', version: 'v1' }),
  )
})

function ctrl(el: Element | Document, key: string): boolean {
  return fireEvent.keyDown(el, { key, ctrlKey: true })
}

async function openObjectPage() {
  useTabs.getState().open({ kind: 'object', path: PATH })
  const utils = render(<App />)
  await screen.findByRole('textbox', { name: 'Title' })
  await waitFor(() => expect(utils.container.querySelector('.ProseMirror')).not.toBeNull())
  return utils
}

describe('app shortcuts', () => {
  test('test Ctrl+N creates object of current type', async () => {
    useTabs.getState().open({ kind: 'type', typeId: 'project' })
    render(<App />)
    await screen.findByRole('heading', { name: 'Projects' })
    const notPrevented = ctrl(document.body, 'n')
    expect(notPrevented).toBe(false) // preventDefault: the native window must not open a new window
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('project', {}))
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'project/Untitled.md' }))
  })

  test('Ctrl+N with no type open creates a Page', async () => {
    render(<App />)
    await waitFor(() => expect(mocked.space).toHaveBeenCalled())
    ctrl(document.body, 'n')
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('page', {}))
  })

  test('Ctrl+U opens the New menu', async () => {
    render(<App />)
    await waitFor(() => expect(mocked.space).toHaveBeenCalled())
    ctrl(document.body, 'u')
    expect(await screen.findByRole('textbox', { name: 'Search types' })).toBeInTheDocument()
  })

  // M32, "New means a note".
  test('test the New button makes a Note at once and opens it; the arrow opens the type list', async () => {
    const user = userEvent.setup()
    // The last thing made was a task: New still makes a Note.
    useLastType.getState().set('task')
    useTabs.getState().open({ kind: 'trash' })
    render(<App />)
    await waitFor(() => expect(mocked.space).toHaveBeenCalled())
    await user.click(await screen.findByRole('button', { name: 'New' }))
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('page', {}))
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'page/Untitled.md' }))
    expect(screen.queryByRole('textbox', { name: 'Search types' })).toBeNull()
    // The arrow: the type list, as before.
    await user.click(screen.getByRole('button', { name: 'Choose a type' }))
    expect(await screen.findByRole('textbox', { name: 'Search types' })).toBeInTheDocument()
    expect(mocked.createObject).toHaveBeenCalledTimes(1)
  })

  test('test Ctrl+N with a daily note open makes a Note, not a daily note', async () => {
    const DAILY = typeDef({ id: 'dailynote', name: 'DailyNote', pluralName: 'DailyNotes', basic: true, revision: 'r1' })
    const day = objectSummary({ path: 'DailyNotes/2026-11-11.md', type: 'dailynote', title: '2026-11-11' })
    mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE, PROJECT, TASK, DAILY] } satisfies SpaceInfo)
    mocked.objects.mockResolvedValue([NOTES, day])
    mocked.object.mockImplementation(async () =>
      objectDetail({ summary: day, frontmatter: { type: 'DailyNote', title: '2026-11-11' }, body: '', version: 'v1' }),
    )
    useTabs.getState().open({ kind: 'object', path: day.path })
    render(<App />)
    await screen.findByRole('textbox', { name: 'Title' })
    await waitFor(() => expect(useLinkIndex.getState().objects.length).toBe(2))
    ctrl(document.body, 'n')
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('page', {}))
  })

  test('test Ctrl+Backspace in the title input and in the editor does not open the delete dialog', async () => {
    const { container } = await openObjectPage()
    const title = screen.getByRole('textbox', { name: 'Title' })
    expect(ctrl(title, 'Backspace')).toBe(true) // not prevented: it stays "delete previous word"
    const editor = container.querySelector('.ProseMirror')!
    ctrl(editor, 'Backspace')
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  test('test Ctrl+Backspace outside editable elements opens the delete dialog, and cancel deletes nothing', async () => {
    const user = userEvent.setup()
    await openObjectPage()
    expect(ctrl(document.body, 'Backspace')).toBe(false)
    const dialog = await screen.findByRole('alertdialog')
    // M32: the dialog names the note (its title is "Notes").
    expect(dialog).toHaveTextContent('Delete “Notes”?')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mocked.deleteObject).not.toHaveBeenCalled()
  })

  // The 2026-11-08 sweep: Ctrl+Shift+T is "Create new task" outside the editor (catalog, General).
  test('Ctrl+Shift+T outside the editor creates a new task, as the New menu does for the Task type', async () => {
    await openObjectPage()
    const notPrevented = fireEvent.keyDown(document.body, { key: 'T', ctrlKey: true, shiftKey: true })
    expect(notPrevented).toBe(false)
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('task', {}))
    // M32: "Open objects as a full page" starts on, so the task opens as a page, not in the peek
    // (the New menu's rule for the Task type while the setting is off).
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'task/Untitled.md' }))
    expect(usePeek.getState().path).toBeNull()
  })

  test('a failed Ctrl+Shift+T create shows the error as a toast, as the New menu shows it', async () => {
    await openObjectPage()
    mocked.createObject.mockRejectedValueOnce(new Error('The space is read-only.'))
    fireEvent.keyDown(document.body, { key: 'T', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('task', {}))
    const toast = await screen.findByText('The space is read-only.')
    expect(toast).toHaveAttribute('role', 'status')
    expect(usePeek.getState().path).toBeNull()
  })

  // The 2026-11-08 sweep: Ctrl+Alt+H is "Go to Calendar (press twice to jump to today)" (catalog, General).
  test('Ctrl+Alt+H opens the Calendar; pressed again while it is open, it jumps to today', async () => {
    await openObjectPage()
    useCalendar.getState().setAnchor('2001-02-03')
    const notPrevented = fireEvent.keyDown(document.body, { key: 'h', ctrlKey: true, altKey: true })
    expect(notPrevented).toBe(false)
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'calendar' }))
    // The first press only opens the calendar, where it was.
    expect(useCalendar.getState().anchor).toBe('2001-02-03')
    fireEvent.keyDown(document.body, { key: 'h', ctrlKey: true, altKey: true })
    await waitFor(() => expect(useCalendar.getState().anchor).toBe(todayYmd()))
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'calendar' })
  })

  test('Ctrl+Shift+T inside the editor keeps meaning "Make this line a task": no new task is created', async () => {
    const { container } = await openObjectPage()
    const editor = container.querySelector('.ProseMirror')!
    fireEvent.keyDown(editor, { key: 'T', ctrlKey: true, shiftKey: true })
    await new Promise((r) => setTimeout(r, 50))
    expect(mocked.createObject).not.toHaveBeenCalled()
  })

  // M32, "Hide Tasks in this space": the task keys do nothing, in a note and outside one.
  test('test while the space hides Tasks, Ctrl+Shift+T makes no task outside the editor and changes nothing inside it', async () => {
    mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE, PROJECT, TASK], hideTaskManagement: true } satisfies SpaceInfo)
    const { container } = await openObjectPage()
    await waitFor(() => expect(useSpaceInfo.getState().space?.hideTaskManagement).toBe(true))
    fireEvent.keyDown(document.body, { key: 'T', ctrlKey: true, shiftKey: true })
    const pm = container.querySelector('.ProseMirror') as HTMLElement & { editor?: TiptapEditor }
    const before = pm.editor!.getJSON()
    fireEvent.keyDown(pm, { key: 'T', ctrlKey: true, shiftKey: true })
    await new Promise((r) => setTimeout(r, 50))
    expect(mocked.createObject).not.toHaveBeenCalled()
    expect(pm.editor!.getJSON()).toEqual(before)
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: PATH })
    expect(usePeek.getState().path).toBeNull()
  })

  // M32, "keys work while you type": with the caret in a note's text or title.
  // The walk's W5 (decision): on a single note's page the key makes a Note, as the "New" button
  // there does (it made one more of the open note's type: a Task on a task's page).
  test('test Ctrl+N with the caret in the note text makes a new Note, whatever the open note is', async () => {
    const { container } = await openObjectPage()
    const editor = container.querySelector('.ProseMirror')!
    expect(ctrl(editor, 'n')).toBe(false)
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('page', {}))
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'page/Untitled.md' }))
  })

  test.each([
    ['a task', objectSummary({ path: 'Tasks/Call Pat.md', type: 'task', title: 'Call Pat' }), 'Task'],
    ['a note of another type', NOTES, 'Project'],
  ])("test the new-note key on %s's page makes a Note", async (_name, open, typeName) => {
    mocked.objects.mockResolvedValue([NOTES, open])
    mocked.object.mockImplementation(async () =>
      objectDetail({ summary: open, frontmatter: { type: typeName, title: open.title }, body: '', version: 'v1' }),
    )
    useTabs.getState().open({ kind: 'object', path: open.path })
    render(<App />)
    await screen.findByRole('textbox', { name: 'Title' })
    await waitFor(() => expect(useLinkIndex.getState().objects.length).toBe(2))
    expect(fireEvent.keyDown(document.body, { key: 'n', code: 'KeyN', altKey: true })).toBe(false)
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledTimes(1))
    expect(mocked.createObject).toHaveBeenCalledWith('page', {})
  })

  test.each([
    ['the Tasks page', { kind: 'tasks' } as const],
    ["a type's settings", { kind: 'typeSettings', typeId: 'project' } as const],
    ['the Trash', { kind: 'trash' } as const],
  ])('test the new-note key on %s makes a Note', async (_name, target) => {
    useTabs.getState().open(target)
    render(<App />)
    await waitFor(() => expect(mocked.space).toHaveBeenCalled())
    await screen.findByRole('button', { name: 'New' })
    ctrl(document.body, 'n')
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledTimes(1))
    expect(mocked.createObject).toHaveBeenCalledWith('page', {})
  })

  test("test the new-note key on a type's own page makes one more of that type, as the page's New button does", async () => {
    useTabs.getState().open({ kind: 'type', typeId: 'task' })
    render(<App />)
    await waitFor(() => expect(mocked.space).toHaveBeenCalled())
    await screen.findByRole('button', { name: 'New' })
    await waitFor(() => expect(useLinkIndex.getState().types.length).toBe(3))
    ctrl(document.body, 'n')
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('task', {}))
  })

  // The M32 review, F4: Alt+N held wrote six notes; a double click on "New" wrote two.
  test('test a held key makes one note: the repeats of the new-note key do nothing', async () => {
    render(<App />)
    await waitFor(() => expect(mocked.space).toHaveBeenCalled())
    await screen.findByRole('button', { name: 'New' })
    expect(fireEvent.keyDown(document.body, { key: 'n', code: 'KeyN', altKey: true })).toBe(false)
    for (let i = 0; i < 5; i++) {
      // Still prevented (the browser's own Ctrl+N or Ctrl+U must not fire), and nothing is made.
      expect(fireEvent.keyDown(document.body, { key: 'n', code: 'KeyN', altKey: true, repeat: true })).toBe(false)
      expect(fireEvent.keyDown(document.body, { key: 'n', ctrlKey: true, repeat: true })).toBe(false)
    }
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 30))
    expect(mocked.createObject).toHaveBeenCalledTimes(1)
  })

  test("test a held today's-note key asks for the note once", async () => {
    mocked.createDailyNote.mockResolvedValue({ path: 'DailyNotes/2026-11-11.md', version: 'v1', typeIds: [] })
    render(<App />)
    await waitFor(() => expect(mocked.space).toHaveBeenCalled())
    await screen.findByRole('button', { name: 'New' })
    fireEvent.keyDown(document.body, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true })
    for (let i = 0; i < 5; i++) fireEvent.keyDown(document.body, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true, repeat: true })
    await waitFor(() => expect(usePeek.getState().path).toBe('DailyNotes/2026-11-11.md'))
    expect(mocked.createDailyNote).toHaveBeenCalledTimes(1)
  })

  test('test a double click on "New" makes one note', async () => {
    let made!: (r: { path: string; version: string }) => void
    mocked.createObject.mockImplementationOnce(() => new Promise((r) => (made = r)))
    render(<App />)
    await waitFor(() => expect(mocked.space).toHaveBeenCalled())
    const button = await screen.findByRole('button', { name: 'New' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(mocked.createObject).toHaveBeenCalledTimes(1)
    made({ path: 'page/Untitled.md', version: 'v1' })
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'page/Untitled.md' }))
    expect(mocked.createObject).toHaveBeenCalledTimes(1)
  })

  test('test Ctrl+N and Alt+N in the title make a new note', async () => {
    await openObjectPage()
    const title = screen.getByRole('textbox', { name: 'Title' })
    expect(ctrl(title, 'n')).toBe(false)
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledTimes(1))
    // The key a browser tab lets through.
    expect(fireEvent.keyDown(document.body, { key: 'n', code: 'KeyN', altKey: true })).toBe(false)
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledTimes(2))
  })

  test('test Ctrl+U and Alt+Shift+N open the New menu from the note text', async () => {
    const user = userEvent.setup()
    const { container } = await openObjectPage()
    const editor = container.querySelector('.ProseMirror')!
    expect(ctrl(editor, 'u')).toBe(false)
    expect(await screen.findByRole('textbox', { name: 'Search types' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Search types' })).toBeNull())
    expect(fireEvent.keyDown(editor, { key: 'N', code: 'KeyN', altKey: true, shiftKey: true })).toBe(false)
    expect(await screen.findByRole('textbox', { name: 'Search types' })).toBeInTheDocument()
    expect(mocked.createObject).not.toHaveBeenCalled()
  })

  test('test the new keys stay off in a field outside a note', async () => {
    render(<App />)
    await waitFor(() => expect(mocked.space).toHaveBeenCalled())
    ctrl(document.body, 'u')
    const search = await screen.findByRole('textbox', { name: 'Search types' })
    expect(ctrl(search, 'n')).toBe(true) // not prevented, nothing made
    await new Promise((r) => setTimeout(r, 30))
    expect(mocked.createObject).not.toHaveBeenCalled()
  })

  test("test Ctrl+Shift+D with the caret in the note text opens today's note with the caret at the end of its text", async () => {
    mocked.createDailyNote.mockResolvedValue({ path: 'DailyNotes/2026-11-11.md', version: 'v1', typeIds: [] })
    const { container } = await openObjectPage()
    const editor = container.querySelector('.ProseMirror')!
    expect(fireEvent.keyDown(editor, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true })).toBe(false)
    await waitFor(() => expect(usePeek.getState().path).toBe('DailyNotes/2026-11-11.md'))
    // The shortcut asks for the caret at the end (`nav/focusRequest`) and the peek's editor takes
    // the request when it is ready: the next key typed lands at the end of today's note.
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => {
      const pm = dialog.querySelector('.ProseMirror') as (HTMLElement & { editor?: TiptapEditor }) | null
      if (!pm?.editor) throw new Error('editor not mounted')
      expect(document.activeElement).toBe(pm)
      expect(pm.editor.state.selection.empty).toBe(true)
      expect(pm.editor.state.selection.from).toBe(pm.editor.state.doc.content.size - 1)
    })
    // Taken once: nothing is left to move the caret again.
    expect(takeBodyFocus('DailyNotes/2026-11-11.md')).toBeNull()
  })

  test('test a new note made by key steps out from under a popped-out note', async () => {
    await openObjectPage()
    usePeek.getState().show('Projects/Other.md')
    ctrl(document.body, 'n')
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledTimes(1))
    expect(usePeek.getState().path).toBeNull()
  })
})
