import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { useLinkIndex } from '@/links/linkIndex'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { openSlashMenu, useSlashMenu } from '../extensions/slashMenu'
import { SlashMenu } from './SlashMenu'

const editors: TiptapEditor[] = []
afterEach(() => {
  cleanup()
  while (editors.length) editors.pop()!.destroy()
  useSlashMenu.setState({ editor: null, range: null, query: '', rect: null, sub: null })
  document.body.innerHTML = ''
})
beforeEach(() => {
  useLinkIndex.setState({ types: [typeDef({ id: 'page', name: 'Page', basic: true })] })
})

function mounted(body: string): TiptapEditor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new TiptapEditor({ element, extensions: editorExtensions() })
  loadBody(editor, body)
  editors.push(editor)
  const end = editor.state.doc.child(0).nodeSize - 1
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)))
  return editor
}

function type(editor: TiptapEditor, text: string) {
  act(() => {
    editor.view.dispatch(editor.state.tr.insertText(text))
  })
}

function press(editor: TiptapEditor, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  let handled = false
  act(() => {
    handled = editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)) ?? false
  })
  return handled
}

async function openMenu(editor: TiptapEditor) {
  render(<SlashMenu editor={editor} />)
  act(() => openSlashMenu(editor))
  return await screen.findByRole('listbox', { name: '/' })
}

describe('<SlashMenu>', () => {
  test('opens on / with its sections and the footer hint; Enter runs the active item', async () => {
    const editor = mounted('Hello\n')
    const menu = await openMenu(editor)
    expect(within(menu).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual([
      'Create a block',
      'Create an object',
      'Link to a date',
      'Reuse any content',
    ])
    expect(within(menu).getByText('press "/" to search')).toBeInTheDocument()
    expect(within(menu).getByRole('option', { name: /Create Page/ })).toBeInTheDocument()

    type(editor, 'head')
    await waitFor(() => expect(within(menu).getAllByRole('option')[0]).toHaveTextContent('Heading 1'))
    press(editor, 'ArrowDown')
    await waitFor(() => expect(within(menu).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true'))
    expect(press(editor, 'Enter')).toBe(true)
    expect(serializeBody(editor)).toBe('## Hello\n')
    await waitFor(() => expect(screen.queryByRole('listbox', { name: '/' })).toBeNull())
  })

  test('slash filter: no match shows No results, a space then closes the menu', async () => {
    useLinkIndex.setState({ types: [] })
    const editor = mounted('Hello\n')
    const menu = await openMenu(editor)
    type(editor, 'zzqx')
    await waitFor(() => expect(within(menu).getByText('No results')).toBeInTheDocument())
    type(editor, ' ')
    await waitFor(() => expect(screen.queryByRole('listbox', { name: '/' })).toBeNull())
    expect(serializeBody(editor)).toBe('Hello/zzqx \n')
  })

  test('escape closes the menu and leaves the text', async () => {
    const editor = mounted('Hello\n')
    await openMenu(editor)
    expect(press(editor, 'Escape')).toBe(true)
    await waitFor(() => expect(screen.queryByRole('listbox', { name: '/' })).toBeNull())
    expect(serializeBody(editor)).toBe('Hello/\n')
  })

  test('colour items open the colour list and set the block colour', async () => {
    const editor = mounted('Hello\n')
    const menu = await openMenu(editor)
    type(editor, 'backgr')
    fireEvent.click(await within(menu).findByRole('option', { name: /^Background/ }))
    const list = await screen.findByRole('listbox', { name: 'Background color' })
    expect(within(list).getAllByRole('option')).toHaveLength(19)
    fireEvent.click(within(list).getByRole('option', { name: 'Blue background' }))
    expect(serializeBody(editor)).toBe('<!-- block: color=bg-blue -->\nHello\n')
    expect(screen.queryByRole('listbox', { name: 'Background color' })).toBeNull()
  })

  test('create bookmark asks for the URL and inserts a web link block', async () => {
    const editor = mounted('Hello\n')
    const menu = await openMenu(editor)
    type(editor, 'bookmark')
    fireEvent.click(await within(menu).findByRole('option', { name: /Create bookmark/ }))
    const input = await screen.findByPlaceholderText('Paste URL')
    fireEvent.change(input, { target: { value: 'https://example.com/docs' } })
    fireEvent.submit(input.closest('form')!)
    expect(serializeBody(editor)).toBe('Hello\n\n<!-- block: bookmark -->\n[https://example.com/docs](https://example.com/docs)\n')
  })
})
