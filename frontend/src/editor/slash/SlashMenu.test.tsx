import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { resetAiStore, useAi } from '@/ai/store'
import { useLinkIndex } from '@/links/linkIndex'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
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
      'New',
      'Link to a date',
      'Embed',
    ])
    expect(within(menu).getByRole('note', { name: 'Keyboard hints' })).toHaveTextContent('↑↓ to navigate')
    expect(within(menu).getByRole('option', { name: /Create Note/ })).toBeInTheDocument()

    type(editor, 'head')
    await waitFor(() => expect(within(menu).getAllByRole('option')[0]).toHaveTextContent('Heading 1'))
    press(editor, 'ArrowDown')
    await waitFor(() => expect(within(menu).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true'))
    expect(press(editor, 'Enter')).toBe(true)
    expect(serializeBody(editor)).toBe('## Hello\n')
    await waitFor(() => expect(screen.queryByRole('listbox', { name: '/' })).toBeNull())
  })

  test('sweep 2026-11-08 #2: arrowing past the visible rows scrolls the active row into view', async () => {
    const scroll = vi.fn()
    const had = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scroll, configurable: true, writable: true })
    try {
      const editor = mounted('Hello\n')
      const menu = await openMenu(editor)
      for (let i = 0; i < 12; i++) press(editor, 'ArrowDown')
      await waitFor(() => expect(within(menu).getAllByRole('option')[12]).toHaveAttribute('aria-selected', 'true'))
      expect(scroll).toHaveBeenCalled()
      const last = scroll.mock.contexts[scroll.mock.contexts.length - 1] as HTMLElement
      expect(last).toBe(within(menu).getAllByRole('option')[12])
      expect(scroll.mock.lastCall).toEqual([{ block: 'nearest' }])
    } finally {
      if (had) Object.defineProperty(Element.prototype, 'scrollIntoView', had)
      else delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView
    }
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
    type(editor, 'zz')
    expect(press(editor, 'Escape')).toBe(true)
    await waitFor(() => expect(screen.queryByRole('listbox', { name: '/' })).toBeNull())
    expect(serializeBody(editor)).toBe('Hello/zz\n')
  })

  test('escape on a menu opened for the user (the + handle) with nothing typed takes its / away', async () => {
    const editor = mounted('Hello\n')
    await openMenu(editor)
    expect(press(editor, 'Escape')).toBe(true)
    await waitFor(() => expect(screen.queryByRole('listbox', { name: '/' })).toBeNull())
    expect(serializeBody(editor)).toBe('Hello\n')
  })

  test('colour items are listed while searching and set the block colour', async () => {
    const editor = mounted('Hello\n')
    const menu = await openMenu(editor)
    expect(within(menu).queryByRole('option', { name: /Blue background/ })).toBeNull()
    type(editor, 'blue backgr')
    fireEvent.click(await within(menu).findByRole('option', { name: /^Blue background/ }))
    expect(serializeBody(editor)).toBe('<!-- block: color=bg-blue -->\nHello\n')
  })

  test('a description is a hover tooltip on a right-hand icon, not a second line', async () => {
    const editor = mounted('Hello\n')
    const menu = await openMenu(editor)
    const standard = within(menu).getAllByRole('option')[0]
    expect(standard).toHaveTextContent(/^Standard$/)
    const tip = standard.querySelector('.slash-menu-description')!
    expect(tip.getAttribute('title')).toBe('Show this block as ordinary text')
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

  test('m10: the AI items open the chat about the block, and are gone while AI features are hidden', async () => {
    resetAiStore()
    const editor = mounted('Hello\n')
    let menu = await openMenu(editor)
    fireEvent.click(within(menu).getByRole('option', { name: 'Ask AI about this block' }))
    expect(useAi.getState().pending?.seed).toMatchObject({ mode: 'askBlock', block: 'Hello' })
    expect(serializeBody(editor)).toBe('Hello\n')
    cleanup()

    useSettings.setState({ settings: { ...settingsDefaults, aiHidden: true } })
    try {
      const other = mounted('World\n')
      menu = await openMenu(other)
      expect(within(menu).queryByRole('option', { name: /using AI|Ask AI/ })).toBeNull()
    } finally {
      useSettings.setState({ settings: settingsDefaults })
      resetAiStore()
    }
  })
})

describe('typing / opens the menu only at the start of a block or after whitespace', () => {
  function typeEach(editor: TiptapEditor, text: string) {
    for (const ch of text) type(editor, ch)
  }
  function isOpen(editor: TiptapEditor) {
    return useSlashMenu.getState().editor === editor
  }

  test.each(['and/or', '11/04', 'http://x'])('%s inserts the characters and opens no menu', (text) => {
    const editor = mounted('Hello\n')
    render(<SlashMenu editor={editor} />)
    typeEach(editor, ` ${text}`)
    expect(isOpen(editor)).toBe(false)
    expect(screen.queryByRole('listbox', { name: '/' })).toBeNull()
    expect(serializeBody(editor)).toBe(`Hello ${text}\n`)
  })

  test('a / straight after a word opens no menu', () => {
    const editor = mounted('Hello\n')
    render(<SlashMenu editor={editor} />)
    type(editor, '/')
    expect(isOpen(editor)).toBe(false)
  })

  test('a / after bold text with no space between opens no menu', () => {
    const editor = mounted('**Hello**\n')
    render(<SlashMenu editor={editor} />)
    act(() => {
      editor.view.dispatch(editor.state.tr.setStoredMarks([]).insertText('/'))
    })
    expect(isOpen(editor)).toBe(false)
  })

  test('openSlashMenu in a code block leaves nothing behind for a later mid-word /', () => {
    const editor = mounted('```\nab\n```\n')
    render(<SlashMenu editor={editor} />)
    expect(editor.state.doc.child(0).type.name).toBe('codeBlock')
    const at = editor.state.selection.from
    act(() => openSlashMenu(editor))
    expect(isOpen(editor)).toBe(false)
    // Later: the / goes away, the block becomes plain text, and a / is typed by hand straight
    // after the word, at the very position the earlier call used.
    act(() => {
      editor.view.dispatch(editor.state.tr.delete(at, at + 1))
    })
    act(() => {
      editor.commands.setNode('paragraph')
    })
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)))
    })
    expect(editor.state.doc.child(0).type.name).toBe('paragraph')
    type(editor, '/')
    expect(isOpen(editor)).toBe(false)
    expect(screen.queryByRole('listbox', { name: '/' })).toBeNull()
  })

  test('/ at the start of a block opens the menu', async () => {
    const editor = mounted('Hello\n')
    render(<SlashMenu editor={editor} />)
    act(() => {
      editor.commands.splitBlock()
    })
    type(editor, '/')
    expect(isOpen(editor)).toBe(true)
    expect(await screen.findByRole('listbox', { name: '/' })).toBeInTheDocument()
  })

  test.each([
    ['a space', ' '],
    ['a tab', '\t'],
    ['a non-breaking space', ' '],
  ])('/ after %s opens the menu, and the query may hold spaces', async (_name, gap) => {
    const editor = mounted('Hello\n')
    render(<SlashMenu editor={editor} />)
    typeEach(editor, `${gap}/`)
    expect(isOpen(editor)).toBe(true)
    expect(await screen.findByRole('listbox', { name: '/' })).toBeInTheDocument()
    typeEach(editor, 'blue back')
    expect(useSlashMenu.getState().query).toBe('blue back')
  })
})
