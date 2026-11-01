import { Editor as TiptapEditor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { collection, objectSummary, query, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { useTabs } from '@/nav/tabs'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { DATA_VIEW_EMBED_TEXT } from './DataViewEmbedView'

const mocked = vi.mocked(api)
const editors: TiptapEditor[] = []

const BOOK_A = objectSummary({ path: 'Books/Alpha.md', type: 'book', title: 'Alpha book', collections: ['Reading'] })
const BOOK_B = objectSummary({ path: 'Books/Beta.md', type: 'book', title: 'Beta book' })
const PAGE = objectSummary({ path: 'Pages/Gamma.md', type: 'page', title: 'Gamma page' })

const SORTED = [{ propertyId: 'title', option: 'ascending' as const }]
const READING = collection({ id: 'c1', name: 'Reading', typeIds: ['book'] })
READING.views.all = { ...READING.views.all, sorts: SORTED }
const BOOKS = query({
  id: 'q1',
  name: 'All books',
  definition: { structures: [{ id: 'book' }], filterGroup: { type: 'filterGroup', operator: 'and', elements: [] }, sorts: SORTED, groupBy: null },
})

beforeEach(() => {
  resetLinkIndex()
  mocked.space.mockResolvedValue({
    name: 's',
    root: '/s',
    types: [typeDef({ id: 'book', name: 'Book' }), typeDef({ id: 'page', name: 'Page' })],
    icon: null,
    description: null,
    hideTaskManagement: false,
    revision: '',
  })
  mocked.objects.mockResolvedValue([BOOK_A, BOOK_B, PAGE])
  mocked.collections.mockResolvedValue([READING])
  mocked.queries.mockResolvedValue([BOOKS])
  mocked.rows.mockReset()
  mocked.rows.mockImplementation(async (scope) => {
    const all = [BOOK_A, BOOK_B, PAGE]
    if (scope?.collectionIds?.includes('c1')) return [row({ summary: BOOK_A })]
    if (scope?.typeIds) return all.filter((s) => scope.typeIds!.includes(s.type)).map((s) => row({ summary: s }))
    return all.map((s) => row({ summary: s }))
  })
})

afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

async function mount(body: string): Promise<TiptapEditor> {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  editors.push(editor)
  render(
    <div data-object-path="Pages/Host.md">
      <EditorContent editor={editor} />
    </div>,
  )
  await act(async () => {
    loadBody(editor, body)
  })
  return editor
}

describe('DataViewEmbedView', () => {
  test('test collection embed renders its view', async () => {
    const body = 'Intro\n\n![[collection:c1]]\n\nOutro\n'
    const editor = await mount(body)
    const embed = await screen.findByTestId('data-view-embed')
    expect(await within(embed).findByText('Alpha book')).toBeInTheDocument()
    expect(within(embed).queryByText('Beta book')).toBeNull()
    expect(within(embed).getByTestId('data-view-embed-title')).toHaveTextContent('Reading')
    expect(mocked.rows).toHaveBeenCalledWith({ collectionIds: ['c1'], preview: false })
    // Rendering writes nothing.
    expect(serializeBody(editor)).toBe(body)

    const open = vi.spyOn(useTabs.getState(), 'open')
    fireEvent.click(within(embed).getByTestId('data-view-embed-title'))
    expect(open).toHaveBeenCalledWith({ kind: 'collection', id: 'c1' }, { newTab: false })
    open.mockRestore()
  })

  test('test query embed runs the query', async () => {
    const body = '![[query:q1]]\n'
    const editor = await mount(body)
    const embed = await screen.findByTestId('data-view-embed')
    expect(await within(embed).findByText('Alpha book')).toBeInTheDocument()
    expect(within(embed).getByText('Beta book')).toBeInTheDocument()
    expect(within(embed).queryByText('Gamma page')).toBeNull()
    expect(within(embed).getByTestId('data-view-embed-title')).toHaveTextContent('All books')
    expect(mocked.rows).toHaveBeenCalledWith(expect.objectContaining({ typeIds: ['book'] }))
    expect(serializeBody(editor)).toBe(body)

    const open = vi.spyOn(useTabs.getState(), 'open')
    fireEvent.click(within(embed).getByTestId('data-view-embed-title'), { ctrlKey: true })
    expect(open).toHaveBeenCalledWith({ kind: 'query', id: 'q1' }, { newTab: true })
    open.mockRestore()
  })

  test('test show details toggles annotation', async () => {
    const body = 'Intro\r\n\r\n![[collection:c1]]\r\n\r\nOutro\r\n'
    const editor = await mount(body)
    const embed = await screen.findByTestId('data-view-embed')
    await within(embed).findByText('Alpha book')
    expect(within(embed).queryByTestId('view-summary')).toBeNull()

    fireEvent.click(within(embed).getByRole('button', { name: 'Block menu' }))
    fireEvent.click(await screen.findByText(DATA_VIEW_EMBED_TEXT.showDetails))
    await waitFor(() => expect(within(embed).getByTestId('view-summary')).toBeInTheDocument())
    expect(serializeBody(editor)).toBe('Intro\r\n\r\n<!-- block: details -->\r\n![[collection:c1]]\r\n\r\nOutro\r\n')

    fireEvent.click(within(embed).getByRole('button', { name: 'Block menu' }))
    fireEvent.click(await screen.findByText(DATA_VIEW_EMBED_TEXT.hideDetails))
    await waitFor(() => expect(within(embed).queryByTestId('view-summary')).toBeNull())
    expect(serializeBody(editor)).toBe(body)
  })

  test('test details annotation loads as shown and is kept', async () => {
    const body = '<!-- block: details -->\n![[query:q1]]\n'
    const editor = await mount(body)
    const embed = await screen.findByTestId('data-view-embed')
    expect(await within(embed).findByTestId('view-summary')).toBeInTheDocument()
    expect(serializeBody(editor)).toBe(body)
  })

  test('test unknown id message', async () => {
    const body = '![[collection:nope]]\n\n![[query:gone]]\n'
    const editor = await mount(body)
    const missing = await screen.findAllByTestId('data-view-embed-missing')
    expect(missing.map((m) => m.textContent)).toEqual(['Collection not found.', 'Query not found.'])
    expect(serializeBody(editor)).toBe(body)
  })
})
