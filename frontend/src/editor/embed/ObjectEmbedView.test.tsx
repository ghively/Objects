import { Editor as TiptapEditor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TypeDef } from '@/api/types'
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
import { EMBED_VIEWS, embedViewOf } from './ObjectEmbedView'

const mocked = vi.mocked(api)
const editors: TiptapEditor[] = []

const ADA = objectSummary({ path: 'People/Ada Lovelace.md', type: 'person', title: 'Ada Lovelace' })
const PAGE = objectSummary({ path: 'Pages/Embedded target.md', type: 'page', title: 'Embedded target' })

function setup(types: TypeDef[]) {
  resetLinkIndex()
  mocked.space.mockResolvedValue({
    name: 's',
    root: '/s',
    types,
    icon: null,
    description: null,
    hideTaskManagement: false,
    revision: '',
  })
  mocked.objects.mockResolvedValue([ADA, PAGE])
  mocked.resolve.mockImplementation(async (link: string) =>
    link === 'Ada Lovelace' ? ADA.path : link === 'Embedded target' ? PAGE.path : null,
  )
  mocked.rows.mockImplementation(async (scope) =>
    (scope?.paths ?? []).map((p) => row({ summary: p === ADA.path ? ADA : PAGE })),
  )
}

beforeEach(() => {
  setup([typeDef({ id: 'person' }), typeDef({ id: 'page' })])
  vi.mocked(openObject).mockClear()
  mocked.rows.mockClear()
})

afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

async function mount(body: string, path = 'Pages/Host.md'): Promise<TiptapEditor> {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  editors.push(editor)
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

describe('ObjectEmbedView', () => {
  test('test turn into inline link replaces the card with a link line', async () => {
    const editor = await mount('Intro\n\n<!-- block: view=wideCard -->\n![[Ada Lovelace|Ada]]\n\nOutro\n')
    const embed = await screen.findByTestId('object-embed')
    fireEvent.click(within(embed).getByRole('button', { name: 'Block menu' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Turn into inline link' }))
    expect(serializeBody(editor)).toBe('Intro\n\n[[Ada Lovelace|Ada]]\n\nOutro\n')
    expect(screen.queryByTestId('object-embed')).toBeNull()
  })

  test('test object embed renders each view and change block view writes view', async () => {
    const body = 'Intro\n\n<!-- block: view=wideCard -->\n![[Ada Lovelace]]\n\nOutro\n'
    const editor = await mount(body)
    const embed = await screen.findByTestId('object-embed')
    expect(await within(embed).findByTestId('wide-card')).toHaveTextContent('Ada Lovelace')
    expect(embed).toHaveAttribute('data-view', 'wideCard')
    // Resolved from the object that holds the editor, with one rows call.
    expect(mocked.resolve).toHaveBeenCalledWith('Ada Lovelace', 'Pages/Host.md')
    expect(mocked.rows).toHaveBeenCalledWith({ paths: [ADA.path] })

    fireEvent.click(within(embed).getByRole('button', { name: 'Block menu' }))
    const group = await screen.findByRole('group', { name: 'Change Block View' })
    expect(within(group).getAllByRole('menuitemradio').map((b) => b.textContent?.replace('✓', ''))).toEqual([
      'Link block',
      'Small card',
      'Wide card',
      'Embed',
      'Page',
    ])
    expect(within(group).getByRole('menuitemradio', { name: /Wide card/ })).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(within(group).getByRole('menuitemradio', { name: /Small card/ }))
    expect(serializeBody(editor)).toBe('Intro\n\n<!-- block: view=smallCard -->\n![[Ada Lovelace]]\n\nOutro\n')
    expect(await within(embed).findByTestId('small-card')).toBeInTheDocument()

    fireEvent.click(within(embed).getByRole('button', { name: 'Block menu' }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Embed/ }))
    expect(serializeBody(editor)).toBe('Intro\n\n<!-- block: view=embed -->\n![[Ada Lovelace]]\n\nOutro\n')
    expect(await within(embed).findByTestId('embed-card')).toBeInTheDocument()
    // The embed view can be resized.
    expect(within(embed).getByRole('separator', { name: 'Resize width' })).toBeInTheDocument()

    fireEvent.click(within(embed).getByRole('button', { name: 'Block menu' }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Link block/ }))
    expect(serializeBody(editor)).toBe('Intro\n\n<!-- block: view=inline -->\n![[Ada Lovelace]]\n\nOutro\n')
    await waitFor(() => expect(embed).toHaveAttribute('data-view', 'inline'))
    expect(within(embed).queryByRole('separator', { name: 'Resize width' })).toBeNull()

    // Clicking the card opens the object as a link.
    fireEvent.click(within(embed).getByRole('button', { name: /Ada Lovelace/ }), { ctrlKey: true })
    expect(openObject).toHaveBeenCalledWith(ADA.path, expect.objectContaining({ ctrlKey: true, via: 'link' }), 'person')

    // Remove Block.
    fireEvent.click(within(embed).getByRole('button', { name: 'Block menu' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove Block' }))
    expect(serializeBody(editor)).toBe('Intro\n\nOutro\n')
  })

  test('test object embed default view comes from the type', async () => {
    setup([typeDef({ id: 'person', defaultViewType: 'wideCard' }), typeDef({ id: 'page' })])
    await mount('![[Ada Lovelace]]\n\n![[Embedded target]]\n')
    const embeds = await screen.findAllByTestId('object-embed')
    expect(await within(embeds[0]).findByTestId('wide-card')).toBeInTheDocument()
    expect(await within(embeds[1]).findByTestId('small-card')).toBeInTheDocument()
    expect(embedViewOf(null, undefined)).toBe('smallCard')
    expect(embedViewOf([{ key: 'view', value: 'bogus', raw: 'view=bogus' }], undefined)).toBe('smallCard')
    expect(EMBED_VIEWS.map((v) => v.view)).toEqual(['inline', 'smallCard', 'wideCard', 'embed', 'page'])
    expect(embedViewOf([{ key: 'view', value: 'page', raw: 'view=page' }], undefined)).toBe('page')
  })

  test('M31: a type whose link view is Page shows its objects as a page preview; Change Block View offers Page', async () => {
    setup([typeDef({ id: 'person', defaultViewType: 'page' }), typeDef({ id: 'page' })])
    const editor = await mount('![[Ada Lovelace]]\n')
    const embed = await screen.findByTestId('object-embed')
    expect(await within(embed).findByTestId('page-card')).toHaveTextContent('Ada Lovelace')
    expect(embed).toHaveAttribute('data-view', 'page')
    // Read-only: the block holds no editor, and its width is not resized.
    expect(within(embed).queryByRole('separator', { name: 'Resize width' })).toBeNull()
    fireEvent.click(within(embed).getByTestId('page-card'))
    expect(openObject).toHaveBeenCalledWith(ADA.path, expect.objectContaining({ via: 'link' }), 'person')

    fireEvent.click(within(embed).getByRole('button', { name: 'Block menu' }))
    expect(await screen.findByRole('menuitemradio', { name: /Page/ })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Wide card/ }))
    expect(serializeBody(editor)).toBe('<!-- block: view=wideCard -->\n![[Ada Lovelace]]\n')
    fireEvent.click(within(embed).getByRole('button', { name: 'Block menu' }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Page/ }))
    expect(serializeBody(editor)).toBe('<!-- block: view=page -->\n![[Ada Lovelace]]\n')
  })

  test('test unresolved embed shows the muted chip', async () => {
    const body = '![[Nobody here]]\n'
    const editor = await mount(body)
    const chip = await screen.findByTestId('object-embed-unresolved')
    expect(chip).toHaveTextContent('[[Nobody here]]')
    expect(chip).toHaveClass('wikilink-unresolved')
    expect(mocked.rows).not.toHaveBeenCalled()
    expect(serializeBody(editor)).toBe(body)
  })

  test('alignment writes align on the embed', async () => {
    const editor = await mount('![[Embedded target]]\n')
    const embed = await screen.findByTestId('object-embed')
    await within(embed).findByTestId('small-card')
    fireEvent.click(within(embed).getByRole('button', { name: 'Align right' }))
    expect(serializeBody(editor)).toBe('<!-- block: align=right -->\n![[Embedded target]]\n')
  })
})
