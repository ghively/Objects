import { Editor as TiptapEditor } from '@tiptap/core'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ObjectSummary } from '@/api/types'
import { objectSummary, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { editorExtensions, loadBody, serializeBody } from '@/editor/document'
import { useRecent } from '@/nav/recent'
import { fuzzyMatch, installLinkPicker, LinkPicker, useLinkPicker } from './LinkPicker'
import { resetLinkIndex } from './linkIndex'

const mocked = vi.mocked(api)

function s(title: string, path = `Pages/${title}.md`): ObjectSummary {
  return objectSummary({ path, type: 'page', title })
}

const OBJECTS = [s('Ada Lovelace', 'People/Ada Lovelace.md'), s('Alpha'), s('Fix printer'), s('Database backups')]

describe('fuzzyMatch', () => {
  test('prefers prefix and word-start matches, drops non-matches', () => {
    expect(fuzzyMatch('al', OBJECTS).map((o) => o.title)).toEqual(['Alpha', 'Ada Lovelace'])
    expect(fuzzyMatch('fp', OBJECTS).map((o) => o.title)).toEqual(['Fix printer'])
    expect(fuzzyMatch('zzz', OBJECTS)).toEqual([])
    expect(fuzzyMatch('', OBJECTS)).toHaveLength(4)
  })
})

describe('[[ trigger', () => {
  let editor: TiptapEditor

  beforeEach(() => {
    resetLinkIndex()
    mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [] })
    mocked.objects.mockResolvedValue(OBJECTS)
    mocked.resolve.mockResolvedValue(null)
    installLinkPicker()
    editor = new TiptapEditor({ extensions: editorExtensions() })
    loadBody(editor, 'Hello \n')
  })

  afterEach(() => {
    editor.destroy()
    useLinkPicker.getState().hide()
  })

  test('typing [[ opens the picker and choosing inserts [[Title]]', async () => {
    const view = editor.view
    const end = editor.state.doc.firstChild!.nodeSize - 1
    editor.commands.insertContentAt(end, '[')
    const at = end + 1
    const handled = view.someProp('handleTextInput', (f) => f(view, at, at, '[', () => view.state.tr))
    expect(handled).toBeFalsy()
    editor.commands.insertContentAt(at, '[')

    await waitFor(() => expect(useLinkPicker.getState().range).toEqual({ from: end, to: end + 2 }))

    render(<LinkPicker />)
    const input = await screen.findByRole('textbox', { name: 'Search objects' })
    await screen.findByText('Ada Lovelace')
    fireEvent.change(input, { target: { value: 'ada' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(useLinkPicker.getState().range).toBeNull()
    expect(serializeBody(editor)).toBe('Hello [[Ada Lovelace]]\n')
  })

  /** Type `[[` at the end of the first paragraph, as the input rule sees it; resolves once the picker has the range. */
  async function typeBrackets(): Promise<number> {
    const view = editor.view
    const end = editor.state.doc.firstChild!.nodeSize - 1
    editor.commands.insertContentAt(end, '[')
    const at = end + 1
    view.someProp('handleTextInput', (f) => f(view, at, at, '[', () => view.state.tr))
    editor.commands.insertContentAt(at, '[')
    await waitFor(() => expect(useLinkPicker.getState().range).toEqual({ from: end, to: end + 2 }))
    return end
  }

  // Audit 2026-11-01 (unconfirmed): a cancelled picker leaves the `[[`. Kept on purpose: the
  // link dropdown searches the text typed inline after `[[`, and dismissing it leaves that text
  // (the slash menu here does the same with `/`). The query typed in the picker is put back too.
  test('cancelling the picker leaves the [[ and the query typed in it', async () => {
    await typeBrackets()
    render(<LinkPicker />)
    const input = await screen.findByRole('textbox', { name: 'Search objects' })
    fireEvent.change(input, { target: { value: 'ada' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(useLinkPicker.getState().range).toBeNull())
    expect(editor.state.doc.textContent).toBe('Hello [[ada')
    expect(editor.state.doc.firstChild!.content.childCount).toBe(1) // plain text, no link
    const saved = serializeBody(editor)
    loadBody(editor, saved)
    expect(editor.state.doc.textContent).toBe('Hello [[ada') // saved as literal text
  })

  test('cancelling with an empty query leaves just the [[', async () => {
    await typeBrackets()
    render(<LinkPicker />)
    const input = await screen.findByRole('textbox', { name: 'Search objects' })
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(useLinkPicker.getState().range).toBeNull())
    expect(editor.state.doc.textContent).toBe('Hello [[')
  })

  /** Type `@` at the end of the first paragraph; the text before it decides whether the picker opens. */
  async function typeAt(before: string): Promise<number | null> {
    loadBody(editor, before + '\n')
    const view = editor.view
    const end = editor.state.doc.firstChild!.nodeSize - 1
    editor.commands.insertContentAt(end, '@')
    view.someProp('handleTextInput', (f) => f(view, end, end, '@', () => view.state.tr))
    await new Promise((r) => setTimeout(r, 20))
    return useLinkPicker.getState().range ? end : null
  }

  // Seen in the live app: `@` opens the object picker (recents, then a row per type).
  test('typing @ after a space opens the picker and choosing replaces the @ with a link', async () => {
    const end = await typeAt('Hello ')
    expect(end).not.toBeNull()
    expect(useLinkPicker.getState().range).toEqual({ from: end, to: end! + 1 })
    render(<LinkPicker />)
    const input = await screen.findByRole('textbox', { name: 'Search objects' })
    await screen.findByText('Ada Lovelace')
    fireEvent.change(input, { target: { value: 'ada' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(serializeBody(editor)).toBe('Hello [[Ada Lovelace]]\n')
  })

  test('typing @ at the start of a block opens the picker', async () => {
    expect(await typeAt('')).not.toBeNull()
  })

  test('an @ inside a word (an email address) does not open the picker', async () => {
    expect(await typeAt('mail ada')).toBeNull()
  })

  test('cancelling the picker leaves the @ and the query typed in it', async () => {
    await typeAt('Hello ')
    render(<LinkPicker />)
    const input = await screen.findByRole('textbox', { name: 'Search objects' })
    fireEvent.change(input, { target: { value: 'ada' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(useLinkPicker.getState().range).toBeNull())
    expect(editor.state.doc.textContent).toBe('Hello @ada')
  })

  test('test link picker embed mode inserts an object embed', async () => {
    // The editor's pickObjectEmbed() opens the picker in embed mode at the cursor.
    loadBody(editor, 'First\n\nSecond\n')
    editor.commands.setTextSelection(3)
    expect(editor.commands.pickObjectEmbed()).toBe(true)
    expect(useLinkPicker.getState().mode).toBe('embed')

    render(<LinkPicker />)
    const input = await screen.findByRole('textbox', { name: 'Search objects' })
    expect(input).toHaveAttribute('placeholder', 'Embed…')
    await screen.findByText('Ada Lovelace')
    fireEvent.change(input, { target: { value: 'ada' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(useLinkPicker.getState().range).toBeNull()
    expect(useLinkPicker.getState().mode).toBe('link')
    expect(serializeBody(editor)).toBe('First\n\n![[Ada Lovelace]]\n\nSecond\n')
    expect(editor.state.doc.child(1).type.name).toBe('objectEmbed')
  })
})

// Audit 2026-11-01: a title with a breaking character links by its path form, as the back end does.
import { wikilinkTargetFor } from '@/editor/extensions/wikilink'

test('test picker targets a title with a pipe by its path', () => {
  expect(wikilinkTargetFor({ title: 'A|B', path: 'Pages/A|B.md' })).toBe('Pages/A|B')
  expect(wikilinkTargetFor({ title: 'Plain', path: 'Pages/Plain.md' })).toBe('Plain')
})

// Seen in the live app: the `@` picker opens under the caret with the recently opened objects first,
// then a row per type that lists that type's objects.
describe('picker rows', () => {
  const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true })
  const PERSON = typeDef({ id: 'person', name: 'Person', pluralName: 'People' })
  const ADA = objectSummary({ path: 'People/Ada Lovelace.md', type: 'person', title: 'Ada Lovelace' })
  const NOTES = objectSummary({ path: 'Pages/Notes.md', type: 'page', title: 'Notes' })
  const PLAN = objectSummary({ path: 'Pages/Plan.md', type: 'page', title: 'Plan' })
  let editor: TiptapEditor

  beforeEach(() => {
    resetLinkIndex()
    useRecent.setState({ paths: ['Pages/Plan.md', 'gone/Missing.md'] })
    mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE, PERSON] })
    mocked.objects.mockResolvedValue([ADA, NOTES, PLAN])
    mocked.resolve.mockResolvedValue(null)
    installLinkPicker()
    editor = new TiptapEditor({ extensions: editorExtensions() })
    loadBody(editor, 'Hello \n')
    const end = editor.state.doc.firstChild!.nodeSize - 1
    act(() => useLinkPicker.getState().show(editor, { from: end, to: end }))
  })

  afterEach(() => {
    editor.destroy()
    useLinkPicker.getState().hide()
    useRecent.setState({ paths: [] })
  })

  const names = () => screen.getAllByRole('option').map((o) => o.textContent)

  test('an empty query lists the recent objects, then a row per type', async () => {
    render(<LinkPicker />)
    await screen.findByRole('option', { name: /People/ })
    const rows = names()
    expect(rows[0]).toContain('Plan') // recent; a path that no longer exists is skipped
    expect(rows.filter((r) => r?.includes('Missing'))).toHaveLength(0)
    expect(rows.slice(1).map((r) => r?.replace(/\d+$/, ''))).toEqual(['Pages', 'People'])
  })

  test('picking a type row lists its objects; Backspace in the empty box goes back', async () => {
    render(<LinkPicker />)
    const input = await screen.findByRole('textbox', { name: 'Search objects' })
    fireEvent.click(within(await screen.findByRole('option', { name: /Pages/ })).getByRole('button'))
    await waitFor(() => expect(names().map((n) => n?.replace(/Page$/, ''))).toEqual(['Notes', 'Plan']))
    fireEvent.keyDown(input, { key: 'Backspace' })
    await waitFor(() => expect(names()[0]).toContain('Plan'))
    expect(names().some((n) => n?.includes('People'))).toBe(true)
  })

  test('sweep 2026-11-08 #2: arrowing down scrolls the active row into view', async () => {
    const scroll = vi.fn()
    const had = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scroll, configurable: true, writable: true })
    try {
      render(<LinkPicker />)
      const input = await screen.findByRole('textbox', { name: 'Search objects' })
      await screen.findByRole('option', { name: /People/ })
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      await waitFor(() => expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true'))
      expect(scroll).toHaveBeenCalled()
      const last = scroll.mock.contexts[scroll.mock.contexts.length - 1] as HTMLElement
      expect(last).toBe(screen.getAllByRole('option')[2])
      expect(scroll.mock.lastCall).toEqual([{ block: 'nearest' }])
    } finally {
      if (had) Object.defineProperty(Element.prototype, 'scrollIntoView', had)
      else delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  test('the picker opens as a popover at the caret, not a centred dialog', async () => {
    render(<LinkPicker />)
    const pop = await screen.findByRole('dialog', { name: 'Link to an object' })
    expect(pop).toHaveAttribute('data-slot', 'popover-content')
  })
})
