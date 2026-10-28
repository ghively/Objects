import { Editor as TiptapEditor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { collection, objectSummary, query, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { formatOption, parseAnnotation } from '../annotations'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { DATA_VIEW_EMBED_TEXT } from './DataViewEmbedView'

const mocked = vi.mocked(api)
const editors: TiptapEditor[] = []

const BOOK_A = objectSummary({ path: 'Books/Alpha.md', type: 'book', title: 'Alpha book', collections: ['Reading'] })
const BOOK_B = objectSummary({ path: 'Books/Beta.md', type: 'book', title: 'Beta book' })

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
    types: [typeDef({ id: 'book', name: 'Book' })],
    icon: null,
    description: null,
    hideTaskManagement: false,
    revision: '',
  })
  mocked.objects.mockResolvedValue([BOOK_A, BOOK_B])
  mocked.collections.mockResolvedValue([READING])
  mocked.queries.mockResolvedValue([BOOKS])
  mocked.rows.mockReset()
  mocked.rows.mockImplementation(async (scope) => {
    if (scope?.collectionIds?.includes('c1')) return [row({ summary: BOOK_A })]
    return [BOOK_A, BOOK_B].map((s) => row({ summary: s }))
  })
})

afterEach(() => {
  cleanup()
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

async function pickLayout(embed: HTMLElement, name: string) {
  const user = userEvent.setup()
  await user.click(within(embed).getByRole('button', { name: 'Layout' }))
  await user.click(await screen.findByRole('menuitemcheckbox', { name }))
}

/** The saved info on the embed's annotation line, parsed. */
function savedInfo(body: string): Record<string, unknown> | null {
  const line = body.split(/\r?\n/).find((l) => l.startsWith('<!-- block:'))
  const opt = line ? parseAnnotation(line)?.options.find((o) => o.key === 'localDataViewInfo') : undefined
  return opt ? JSON.parse(opt.value as string) : null
}

const INFO = {
  viewDefinition: { dataViewLayout: 'wall' },
  filterGroup: {
    type: 'filterGroup',
    operator: 'and',
    elements: [{ type: 'filter', propertyId: 'title', option: 'contains', referenceValue: 'Beta' }],
  },
  sorts: [{ propertyId: 'title', option: 'descending' }],
  groupBy: { groups: [{ propertyId: 'type', option: 'default' }] },
}

describe('DataViewEmbedView keeps its own view (M9)', () => {
  test('test embed without option uses the source view and writes nothing', async () => {
    const body = 'Intro\n\n![[collection:c1]]\n\nOutro\n'
    const editor = await mount(body)
    const embed = await screen.findByTestId('data-view-embed')
    await within(embed).findByText('Alpha book')
    await new Promise((r) => setTimeout(r, 500))
    expect(serializeBody(editor)).toBe(body)
  })

  test('test first change writes option on the annotation line only', async () => {
    const body = 'Intro\n\n![[collection:c1]]\n\nOutro\n'
    const editor = await mount(body)
    const embed = await screen.findByTestId('data-view-embed')
    await within(embed).findByText('Alpha book')
    await pickLayout(embed, 'Wall')
    await waitFor(() => expect(serializeBody(editor)).not.toBe(body))
    const out = serializeBody(editor)
    const lines = out.split('\n')
    expect(lines[0]).toBe('Intro')
    expect(lines[1]).toBe('')
    expect(lines[2]).toMatch(/^<!-- block: localDataViewInfo=".*" -->$/)
    expect(lines.slice(3)).toEqual(['![[collection:c1]]', '', 'Outro', ''])
    // The collection's view, copied, with the change: layout, filters, sorts and group, no details flag.
    expect(savedInfo(out)).toEqual({
      viewDefinition: { ...READING.views.all.viewDefinition, dataViewLayout: 'wall' },
      filterGroup: READING.views.all.filterGroup,
      sorts: SORTED,
      groupBy: READING.views.all.groupBy,
    })
  })

  test('test reload restores layout filters sorts group', async () => {
    const body = `<!-- block: details ${formatOption({ key: 'localDataViewInfo', value: JSON.stringify(INFO) })} -->\n![[query:q1]]\n`
    const editor = await mount(body)
    const embed = await screen.findByTestId('data-view-embed')
    const summary = await within(embed).findByTestId('view-summary')
    expect(summary).toHaveTextContent('Filtered by')
    expect(summary).toHaveTextContent('Sorted by')
    expect(summary).toHaveTextContent('Grouped by')
    expect(await within(embed).findByText('Beta book')).toBeInTheDocument()
    expect(within(embed).queryByText('Alpha book')).toBeNull()
    const user = userEvent.setup()
    await user.click(within(embed).getByRole('button', { name: 'Layout' }))
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Wall' })).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{Escape}')
    expect(serializeBody(editor)).toBe(body)
  })

  test('test details flag and localDataViewInfo coexist', async () => {
    const body = `<!-- block: ${formatOption({ key: 'localDataViewInfo', value: JSON.stringify(INFO) })} -->\n![[query:q1]]\n`
    const editor = await mount(body)
    const embed = await screen.findByTestId('data-view-embed')
    await within(embed).findByText('Beta book')
    fireEvent.click(within(embed).getAllByRole('button', { name: 'Block menu' })[0])
    fireEvent.click(await screen.findByText(DATA_VIEW_EMBED_TEXT.showDetails))
    await waitFor(() => expect(serializeBody(editor)).toMatch(/^<!-- block: details localDataViewInfo="/))
    // Toggling details leaves the saved view as it was.
    expect(savedInfo(serializeBody(editor))).toEqual(INFO)
  })

  test('test value with quotes and --> survives', async () => {
    const info = {
      ...INFO,
      filterGroup: { ...INFO.filterGroup, elements: [{ ...INFO.filterGroup.elements[0], referenceValue: 'a "b" --> c\\d' }] },
    }
    const body = `<!-- block: ${formatOption({ key: 'localDataViewInfo', value: JSON.stringify(info) })} -->\n![[query:q1]]\n`
    const editor = await mount(body)
    const embed = await screen.findByTestId('data-view-embed')
    await waitFor(() => expect(within(embed).queryByText('Alpha book')).toBeNull())
    expect(serializeBody(editor)).toBe(body)
    await pickLayout(embed, 'List')
    await waitFor(() => expect(serializeBody(editor)).not.toBe(body))
    const saved = savedInfo(serializeBody(editor)) as typeof info
    expect(saved.filterGroup).toEqual(info.filterGroup)
    expect(saved.viewDefinition.dataViewLayout).toBe('list')
  })

  test('test CRLF body keeps CRLF', async () => {
    const body = 'Intro\r\n\r\n![[query:q1]]\r\n\r\nOutro\r\n'
    const editor = await mount(body)
    const embed = await screen.findByTestId('data-view-embed')
    await within(embed).findByText('Beta book')
    await pickLayout(embed, 'Wall')
    await waitFor(() => expect(serializeBody(editor)).not.toBe(body))
    const out = serializeBody(editor)
    expect(out.replace(/\r\n/g, '')).not.toContain('\n')
    expect(out).toMatch(/^Intro\r\n\r\n<!-- block: localDataViewInfo=".*" -->\r\n!\[\[query:q1\]\]\r\n\r\nOutro\r\n$/)
  })
})
