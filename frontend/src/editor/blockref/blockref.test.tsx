import { Editor as TiptapEditor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent } from '@/api/types'
import { objectSummary, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/create/createAndOpen', async (orig) => ({
  ...(await orig<typeof import('@/create/createAndOpen')>()),
  openObject: vi.fn(() => 'current'),
}))

import { api } from '@/api/client'
import { openObject } from '@/create/createAndOpen'
import { resetLinkIndex } from '@/links/linkIndex'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { BlockMenu } from '../handles/BlockMenu'
import { setEditorObject } from '../nodes/blockRef'
import type { BlockClient, BlockInfo } from './blockClient'
import { BLOCK_REF_TEXT, withoutBlockId } from './BlockRefView'
import { REFERENCED_IN, ReferencedIn } from './ReferencedIn'

const mocked = vi.mocked(api)
const blockApi = api as unknown as { block: ReturnType<typeof vi.fn<BlockClient['block']>>; blockReferences: ReturnType<typeof vi.fn<BlockClient['blockReferences']>> }
const editors: TiptapEditor[] = []
let listeners: ((ev: ChangeEvent) => void)[] = []

const SOURCE = objectSummary({ path: 'Pages/Source note.md', type: 'page', title: 'Source note' })
const HOST = objectSummary({ path: 'Pages/Host.md', type: 'page', title: 'Host' })
const LOOP = objectSummary({ path: 'Pages/Loop.md', type: 'page', title: 'Loop' })

beforeEach(() => {
  resetLinkIndex()
  listeners = []
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [typeDef({ id: 'page' })], icon: null, description: null, hideTaskManagement: false, revision: '' })
  mocked.objects.mockResolvedValue([SOURCE, HOST, LOOP])
  mocked.resolve.mockImplementation(async (link: string) => [SOURCE, HOST, LOOP].find((o) => o.title === link)?.path ?? null)
  mocked.rows.mockImplementation(async (scope) => (scope?.paths ?? []).map((p) => row({ summary: [SOURCE, HOST, LOOP].find((o) => o.path === p)! })))
  mocked.onChange.mockImplementation((cb: (ev: ChangeEvent) => void) => {
    listeners.push(cb)
    return () => {
      listeners = listeners.filter((l) => l !== cb)
    }
  })
  Object.assign(api, {
    block: vi.fn<BlockClient['block']>(),
    blockReferences: vi.fn<BlockClient['blockReferences']>(async () => ({ paths: [] })),
  })
  vi.mocked(openObject).mockClear()
})

afterEach(() => {
  cleanup()
  while (editors.length) editors.pop()!.destroy()
})

async function mount(body: string, path = HOST.path, editable = true): Promise<TiptapEditor> {
  const editor = new TiptapEditor({ extensions: editorExtensions(), editable })
  editors.push(editor)
  setEditorObject(editor, { path })
  render(
    <div data-object-path={path}>
      <EditorContent editor={editor} />
    </div>,
  )
  await act(async () => {
    loadBody(editor, body)
  })
  return editor
}

const info = (path: string, id: string, markdown: string, version = 'v1'): BlockInfo => ({ path, id, markdown, version })

describe('block references (M8 Task 27)', () => {
  test('test block ref renders source live', async () => {
    blockApi.block.mockResolvedValue(info(SOURCE.path, 'ab12cd', 'The referenced block lives here. ^ab12cd'))
    const body = 'Intro\n\n![[Source note#^ab12cd]]\n'
    const editor = await mount(body)
    const ref = await screen.findByTestId('block-ref')
    const content = await within(ref).findByTestId('block-ref-content')
    await waitFor(() => expect(content).toHaveTextContent('The referenced block lives here.'))
    expect(content.textContent).not.toContain('^ab12cd')
    expect(within(ref).getByTestId('block-ref-source')).toHaveTextContent('Source note')
    expect(mocked.resolve).toHaveBeenCalledWith('Source note', HOST.path)
    expect(blockApi.block).toHaveBeenCalledWith(SOURCE.path, 'ab12cd')
    // Read-only: the transclusion's editor is not editable.
    expect(content.querySelector('[contenteditable="true"]')).toBeNull()

    // A change to the source re-fetches it.
    blockApi.block.mockResolvedValue(info(SOURCE.path, 'ab12cd', 'Edited elsewhere. ^ab12cd', 'v2'))
    act(() => listeners.forEach((l) => l({ kind: 'changed', path: SOURCE.path, version: 'v2' })))
    await waitFor(() => expect(within(ref).getByTestId('block-ref-content')).toHaveTextContent('Edited elsewhere.'))

    // A click opens the source as a link.
    fireEvent.click(within(ref).getByTestId('block-ref-source'))
    expect(openObject).toHaveBeenCalledWith(SOURCE.path, expect.objectContaining({ via: 'link' }), 'page')
    // Rendering changed nothing in the body.
    expect(serializeBody(editor)).toBe(body)
  })

  test('test missing block shows our line', async () => {
    blockApi.block.mockRejectedValue(new Error('404'))
    await mount('![[Source note#^zzzzzz]]\n')
    expect(await screen.findByTestId('block-ref-missing')).toHaveTextContent(BLOCK_REF_TEXT.notFound)
    expect(BLOCK_REF_TEXT.notFound).toBe('Block not found.')
  })

  test('test self reference message', async () => {
    // Loop's block holds a reference to itself: the nested rendering stops with the message.
    blockApi.block.mockResolvedValue(info(LOOP.path, 'loop01', '![[Loop#^loop01]]'))
    await mount('![[Loop#^loop01]]\n')
    const msg = await screen.findByTestId('block-ref-recursive', {}, { timeout: 3000 })
    expect(msg).toHaveTextContent(
      'This block reference seems to be referencing itself either directly or through another embedded object.',
    )
    expect(screen.getAllByTestId('block-ref')).toHaveLength(2)
  })

  test('test copy block reference writes id and clipboard', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const editor = new TiptapEditor({ extensions: editorExtensions() })
    editors.push(editor)
    setEditorObject(editor, { path: HOST.path, title: 'Host' })
    loadBody(editor, 'Hello world\n\nOther\n')
    editor.commands.setTextSelection(3)
    render(<BlockMenu editor={editor} open onOpenChange={() => {}} anchor={{ left: 0, top: 0, width: 10, height: 10 }} />)
    const menu = await screen.findByRole('menu')
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Copy block reference/ }))
    const body = serializeBody(editor)
    const id = /Hello world \^([a-z0-9]{6})\n/.exec(body)?.[1]
    expect(id).toBeTruthy()
    expect(body).toBe(`Hello world ^${id}\n\nOther\n`)
    expect(writeText).toHaveBeenCalledWith(`![[Host#^${id}]]`)
  })

  test('test referenced in lists referrers', async () => {
    blockApi.blockReferences.mockImplementation(async (_path: string, id: string) => ({ paths: id === 'ab12cd' ? [HOST.path, LOOP.path] : [] }))
    render(<ReferencedIn path={SOURCE.path} id="ab12cd" />)
    const box = await screen.findByTestId('referenced-in')
    expect(box).toHaveTextContent(REFERENCED_IN)
    expect(REFERENCED_IN).toBe('Referenced in')
    expect(within(box).getAllByRole('button').map((b) => b.textContent)).toEqual(['Host', 'Loop'])
    fireEvent.click(within(box).getByRole('button', { name: 'Loop' }))
    expect(openObject).toHaveBeenCalledWith(LOOP.path, expect.objectContaining({ via: 'link' }), undefined)
    cleanup()
    // Nothing shows without referrers.
    render(<ReferencedIn path={SOURCE.path} id="zz9zz9" />)
    await waitFor(() => expect(blockApi.blockReferences).toHaveBeenCalledWith(SOURCE.path, 'zz9zz9'))
    expect(screen.queryByTestId('referenced-in')).toBeNull()
  })

  test('test referenced in appears after a block with an id in the editor', async () => {
    blockApi.blockReferences.mockResolvedValue({ paths: [HOST.path] })
    const body = 'The referenced block lives here. ^ab12cd\n\nNo id here.\n'
    const editor = await mount(body, SOURCE.path)
    const box = await screen.findByTestId('referenced-in')
    expect(box).toHaveTextContent('Host')
    expect(blockApi.blockReferences).toHaveBeenCalledWith(SOURCE.path, 'ab12cd')
    // Only the block with an id asks (a redraw of its paragraph may ask again).
    expect(new Set(blockApi.blockReferences.mock.calls.map((c) => c[1]))).toEqual(new Set(['ab12cd']))
    expect(serializeBody(editor)).toBe(body)
  })

  test('withoutBlockId drops only the trailing id', () => {
    expect(withoutBlockId('a ^ab12cd', 'ab12cd')).toBe('a')
    expect(withoutBlockId('- item ^ab12cd\n  - child', 'ab12cd')).toBe('- item\n  - child')
    expect(withoutBlockId('a ^other1', 'ab12cd')).toBe('a ^other1')
  })
})
