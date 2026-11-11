// M32, item 11: the note page is for writing. The body is at least 60% of the window's height,
// a click in the empty space below the text puts the caret at the end of the text, and what
// follows the text (the references) is outside that area.
import type { Editor as TiptapEditor } from '@tiptap/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpaceInfo, TypeDef } from '@/api/types'
import { objectDetail, objectSummary, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/find/FindBar', () => ({ FindBar: () => null }))
vi.mock('@/references/ReferencesSection', () => ({ ReferencesSection: () => <section data-testid="references" /> }))

import { api } from '@/api/client'
import { serializeBody } from '@/editor/document'
import { resetLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { ObjectView } from './ObjectView'

const mocked = vi.mocked(api)
const PAGE: TypeDef = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', revision: 'r1', basic: true })
const PATH = 'Pages/Notes.md'

function load(body: string) {
  const detail = objectDetail({
    summary: objectSummary({ path: PATH, type: 'page', title: 'Notes' }),
    frontmatter: { type: 'Page', title: 'Notes' },
    body,
    version: 'v1',
  })
  mocked.objects.mockResolvedValue([detail.summary])
  mocked.object.mockResolvedValue(detail)
}

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE] } satisfies SpaceInfo)
  mocked.resolve.mockResolvedValue(null)
  mocked.onChange.mockReturnValue(() => undefined)
})

async function open(body: string, mode: 'page' | 'peek' = 'page') {
  load(body)
  const utils = render(<ObjectView path={PATH} mode={mode} />)
  const editor = await waitFor(() => {
    const dom = utils.container.querySelector('.object-body-text .ProseMirror') as (HTMLElement & { editor?: TiptapEditor }) | null
    if (!dom?.editor) throw new Error('editor not mounted')
    return dom.editor
  })
  await waitFor(() => expect(serializeBody(editor)).toBe(body))
  return { ...utils, editor, area: utils.container.querySelector('.object-body-text') as HTMLElement }
}

describe.each(['page', 'peek'] as const)('the body area, in the %s', (mode) => {
  test('is at least 60% of the window tall, with the text cursor', async () => {
    const { area } = await open('Hello.\n', mode)
    expect(area).toHaveClass('min-h-[60vh]', 'cursor-text')
  })

  test('a click in the empty space below the text puts the caret at the end of the text', async () => {
    const { area, editor } = await open('First.\n\nLast line.\n', mode)
    expect(document.activeElement).not.toBe(editor.view.dom)
    // The area itself is what is under the pointer below the last line.
    expect(fireEvent.mouseDown(area, { button: 0 })).toBe(false)
    expect(document.activeElement).toBe(editor.view.dom)
    expect(editor.state.selection.empty).toBe(true)
    expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1)
    expect(editor.state.selection.$from.parent.textContent).toBe('Last line.')
    // Nothing was written by the click.
    expect(serializeBody(editor)).toBe('First.\n\nLast line.\n')
  })
})

describe('the body area', () => {
  test('a click on anything inside the area (the editor, its text) is not the area\'s', async () => {
    const { area, editor } = await open('First.\n\nLast line.\n')
    const before = editor.state.selection.from
    // The editor's own root: the pointer is over the editor, which places the caret itself.
    const inside = area.querySelector('.object-editor-root') as HTMLElement
    expect(inside.contains(editor.view.dom)).toBe(true)
    expect(fireEvent.mouseDown(inside, { button: 0 })).toBe(true)
    expect(editor.state.selection.from).toBe(before)
    expect(document.activeElement).not.toBe(editor.view.dom)
  })

  test('another mouse button is left alone', async () => {
    const { area, editor } = await open('Hello.\n')
    expect(fireEvent.mouseDown(area, { button: 2 })).toBe(true)
    expect(document.activeElement).not.toBe(editor.view.dom)
  })

  test('under a last block that holds no text (a divider), the click starts a new line for the caret', async () => {
    const { area, editor } = await open('Above.\n\n---\n')
    fireEvent.mouseDown(area, { button: 0 })
    expect(document.activeElement).toBe(editor.view.dom)
    const last = editor.state.doc.lastChild!
    expect(last.type.name).toBe('paragraph')
    expect(last.content.size).toBe(0)
    expect(editor.state.selection.$from.parent).toBe(last)
  })

  test('an empty note takes the caret in its one empty line', async () => {
    const { area, editor } = await open('')
    fireEvent.mouseDown(area, { button: 0 })
    expect(document.activeElement).toBe(editor.view.dom)
    expect(editor.state.doc.childCount).toBe(1)
    expect(serializeBody(editor)).toBe('')
  })

  test('the references follow the body area and are not part of it', async () => {
    const { area } = await open('Hello.\n')
    const refs = screen.getByTestId('references')
    expect(area.contains(refs)).toBe(false)
    expect(area.compareDocumentPosition(refs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
