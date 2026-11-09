import type { Editor as TiptapEditor } from '@tiptap/core'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent, ObjectDetail, ObjectSummary, SpaceInfo, TypeDef } from '@/api/types'
import { objectDetail, objectSummary, propertyDef, typeDef as makeType } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { useCalendar } from '@/calendar/useCalendar'
import { resetLinkIndex } from '@/links/linkIndex'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { ObjectPeek } from './ObjectPeek'

const mocked = vi.mocked(api)

function typeDef(id: string, name: string, pluralName: string, color: string): TypeDef {
  return makeType({
    id,
    name,
    pluralName,
    folder: pluralName,
    icon: { type: 'iconify', val: 'ph-file-text' },
    color,
    propertyDefinitions: [propertyDef({ id: 'p1', key: 'email', name: 'Email', type: 'text' })],
  })
}

const TYPES = [
  typeDef('person', 'Person', 'People', 'orange'),
  typeDef('page', 'Page', 'Pages', 'pink'),
  typeDef('dailynote', 'DailyNote', 'Daily Notes', 'blue'),
]
const DAILY_PATH = 'Daily Notes/2026-11-08.md'

function summary(path: string, title: string, type = 'page'): ObjectSummary {
  return objectSummary({ path, type, title })
}

const OBJECTS = [
  summary('Pages/One.md', 'One'),
  summary('Pages/Two.md', 'Two'),
  summary('Pages/Three.md', 'Three'),
  summary('Pages/Four.md', 'Four'),
  summary('Pages/Five.md', 'Five'),
  summary('People/Ada Lovelace.md', 'Ada Lovelace', 'person'),
  summary(DAILY_PATH, '2026-11-08', 'dailynote'),
]
const LIST = OBJECTS.slice(0, 5).map((o) => o.path)

function detail(path: string): ObjectDetail {
  const s = OBJECTS.find((o) => o.path === path)!
  if (s.type === 'dailynote') {
    return objectDetail({
      summary: s,
      frontmatter: { type: 'DailyNote', title: s.title, date: '2026-11-08', reviewed: false },
      body: '\nA day.\n',
      version: 'v-daily',
    })
  }
  return objectDetail({
    summary: { ...s, tags: ['infra'] },
    frontmatter: { type: s.type, title: s.title, tags: ['infra'] },
    body: `\nSee [[Ada Lovelace]] and [[Nobody Here]].\n`,
    version: `v-${path}`,
  })
}

/** The daily note as it is on disk: the Reviewed write changes it, and a change event follows. */
let dailyOnDisk: ObjectDetail
let listeners: ((e: ChangeEvent) => void)[] = []

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  useCalendar.setState({ view: 'month', anchor: '2020-01-01' })
  resetLinkIndex()
  listeners = []
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  dailyOnDisk = detail(DAILY_PATH)
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: TYPES } satisfies SpaceInfo)
  mocked.objects.mockResolvedValue(OBJECTS)
  mocked.object.mockImplementation(async (path: string) => (path === DAILY_PATH ? dailyOnDisk : detail(path)))
  mocked.updateProperties.mockImplementation(async (path: string, updates: Record<string, unknown>, baseVersion: string) => {
    const version = `${baseVersion}+1`
    if (path === DAILY_PATH) dailyOnDisk = { ...dailyOnDisk, frontmatter: { ...dailyOnDisk.frontmatter, ...updates }, version }
    return { version, frontmatter: { ...updates }, links: {}, synced: [], skipped: [] }
  })
  mocked.onChange.mockImplementation((cb: (e: ChangeEvent) => void) => {
    listeners.push(cb)
    return () => {
      listeners = listeners.filter((l) => l !== cb)
    }
  })
  mocked.resolve.mockImplementation(async (link: string) =>
    link === 'Ada Lovelace' ? 'People/Ada Lovelace.md' : null,
  )
})

async function openPeekAt(index: number) {
  usePeek.getState().peek(LIST[index], LIST)
  render(<ObjectPeek />)
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByRole('heading', { level: 1, name: OBJECTS[index].title })
  return dialog
}

async function chip(dialog: HTMLElement, target: string): Promise<HTMLElement> {
  return waitFor(() => {
    const el = dialog.querySelector(`[data-wikilink][data-target="${target}"]`) as HTMLElement | null
    if (!el) throw new Error(`no chip for ${target}`)
    return el
  })
}

describe('ObjectPeek', () => {
  test('peek pager steps through list and shows "2 / 5"', async () => {
    const dialog = await openPeekAt(1)
    expect(within(dialog).getByText('2 / 5')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }))
    await within(dialog).findByRole('heading', { level: 1, name: 'Three' })
    expect(within(dialog).getByText('3 / 5')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Previous' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Previous' }))
    await within(dialog).findByRole('heading', { level: 1, name: 'One' })
    expect(within(dialog).getByText('1 / 5')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Previous' })).toBeDisabled()
  })

  test('shows the property panel with muted Empty values', async () => {
    const dialog = await openPeekAt(0)
    const panel = within(dialog).getByRole('complementary', { name: 'Properties' })
    expect(within(panel).getByText('Email')).toBeInTheDocument()
    expect(within(panel).getByPlaceholderText('Empty')).toBeInTheDocument()
  })

  test('unresolved wikilink renders dimmed', async () => {
    const dialog = await openPeekAt(0)
    const missing = await chip(dialog, 'Nobody Here')
    await waitFor(() => expect(missing).toHaveAttribute('data-unresolved'))
    expect(missing).toHaveClass('wikilink-unresolved')

    const ada = await chip(dialog, 'Ada Lovelace')
    await waitFor(() => expect(ada).toHaveAttribute('data-resolved-path', 'People/Ada Lovelace.md'))
    expect(ada).not.toHaveAttribute('data-unresolved')
    expect(ada.dataset.color).toBe('orange')
    expect(ada.title).toBe('Ada Lovelace')
  })

  test('link click opens peek; ctrl+click opens new tab', async () => {
    const dialog = await openPeekAt(0)
    const ada = await chip(dialog, 'Ada Lovelace')
    await waitFor(() => expect(ada).toHaveAttribute('data-resolved-path'))

    fireEvent.click(ada, { ctrlKey: true })
    expect(useTabs.getState().tabs).toHaveLength(1)
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'People/Ada Lovelace.md' })
    expect(usePeek.getState().path).toBe('Pages/One.md')

    fireEvent.click(ada)
    expect(usePeek.getState().path).toBe('People/Ada Lovelace.md')
    expect(usePeek.getState().list).toEqual(['People/Ada Lovelace.md'])

    // Clicking an unresolved link does nothing.
    const before = usePeek.getState().path
    const missing = await chip(screen.getByRole('dialog'), 'Nobody Here').catch(() => null)
    if (missing) fireEvent.click(missing)
    expect(usePeek.getState().path).toBe(before)
  })

  // Catalog section 5: a daily note's peek adds a Reviewed checkbox and a "Calendar" button (jump to that day).
  test('a daily note peek shows Reviewed and Calendar; Calendar opens the calendar on that day', async () => {
    usePeek.getState().peek(DAILY_PATH, [DAILY_PATH])
    render(<ObjectPeek />)
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('heading', { level: 1, name: '2026-11-08' })

    const reviewed = await within(dialog).findByRole('checkbox', { name: 'Reviewed' })
    expect(reviewed).toHaveAttribute('aria-checked', 'false')
    await waitFor(() => expect(reviewed).toBeEnabled())
    // The header reads `reviewed` and the day from the view's own load: no read of its own.
    expect(mocked.object).toHaveBeenCalledTimes(1)
    fireEvent.click(reviewed)
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith(DAILY_PATH, { reviewed: true }, 'v-daily'))
    expect(reviewed).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Calendar' }))
    expect(useCalendar.getState().anchor).toBe('2026-11-08')
    expect(useCalendar.getState().view).toBe('day')
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'calendar' })
    expect(usePeek.getState().path).toBeNull()
  })

  // The Reviewed write is the peek's own (not the view's write path): the change event it causes
  // carries a version the view does not know. Only the frontmatter changed, so the view adopts the
  // version and keeps the editor's document (no reload: selection, scroll and undo stay).
  test('after the Reviewed write, the change event does not reload the peek editor (only the frontmatter changed)', async () => {
    usePeek.getState().peek(DAILY_PATH, [DAILY_PATH])
    render(<ObjectPeek />)
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('heading', { level: 1, name: '2026-11-08' })
    const reviewed = await within(dialog).findByRole('checkbox', { name: 'Reviewed' })
    await waitFor(() => expect(reviewed).toBeEnabled())
    const pm = dialog.querySelector('.ProseMirror') as (HTMLElement & { editor?: TiptapEditor }) | null
    const editor = pm?.editor
    if (!editor) throw new Error('editor not mounted')
    const docBefore = editor.state.doc

    fireEvent.click(reviewed)
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith(DAILY_PATH, { reviewed: true }, 'v-daily'))
    const reads = mocked.object.mock.calls.length
    act(() => {
      for (const l of listeners) l({ path: DAILY_PATH, kind: 'changed', version: 'v-daily+1' })
    })
    await waitFor(() => expect(mocked.object.mock.calls.length).toBeGreaterThan(reads))
    // One read: the view's re-check of the disk. The header follows the view's detail.
    await new Promise((r) => setTimeout(r, 50))
    expect(mocked.object).toHaveBeenCalledTimes(reads + 1)
    // Let the view settle, then the document is the very instance from before.
    await new Promise((r) => setTimeout(r, 50))
    expect(editor.state.doc).toBe(docBefore)
    expect(within(dialog).getByRole('checkbox', { name: 'Reviewed' })).toHaveAttribute('aria-checked', 'true')
  })

  test('a page peek shows neither Reviewed nor Calendar', async () => {
    const dialog = await openPeekAt(0)
    expect(within(dialog).queryByRole('checkbox', { name: 'Reviewed' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Calendar' })).toBeNull()
  })
})
