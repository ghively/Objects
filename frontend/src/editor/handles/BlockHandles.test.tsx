import { Editor as TiptapEditor } from '@tiptap/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { editorExtensions, loadBody, serializeBody } from '../document'
import { blockSelectionRange, selectBlocks } from '../extensions/blockSelection'
import { useSlashMenu } from '../extensions/slashMenu'
import { SlashMenu } from '../slash/SlashMenu'
import { BlockHandles, blockAtDOM, richText } from './BlockHandles'
import { moveBlockTo, startBlockDrag } from './dragMove'

const editors: TiptapEditor[] = []
afterEach(() => {
  cleanup()
  while (editors.length) editors.pop()!.destroy()
  useSlashMenu.setState({ editor: null, range: null, query: '', rect: null, sub: null })
  document.body.innerHTML = ''
})

function mounted(body: string): TiptapEditor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new TiptapEditor({ element, extensions: editorExtensions() })
  loadBody(editor, body)
  editors.push(editor)
  return editor
}

function blockPos(editor: TiptapEditor, i: number): number {
  let pos = 0
  for (let k = 0; k < i; k++) pos += editor.state.doc.child(k).nodeSize
  return pos
}

function hoverBlock(editor: TiptapEditor, i: number) {
  const dom = editor.view.nodeDOM(blockPos(editor, i)) as HTMLElement
  act(() => {
    fireEvent.mouseOver(dom)
  })
}

const BODY = 'A *one*  \n\n<!-- block: small -->\nB _two_\n\n<!--toggle open-->\nC\n\nInside\n<!-- /toggle -->\n\nD\n'

describe('<BlockHandles>', () => {
  test('hovering a block shows its handles; nested blocks get their own', () => {
    const editor = mounted(BODY)
    render(<BlockHandles editor={editor} />)
    hoverBlock(editor, 1)
    const handles = document.querySelector('[data-block-handles]')!
    expect(handles.getAttribute('data-pos')).toBe(String(blockPos(editor, 1)))
    expect(within(handles as HTMLElement).getAllByRole('button')).toHaveLength(2)

    // A block inside the toggle.
    const inside = Array.from(editor.view.dom.querySelectorAll('p')).find((p) => p.textContent === 'Inside')!
    const block = blockAtDOM(editor, inside)!
    expect(block.node.textContent).toBe('Inside')
    act(() => {
      fireEvent.mouseOver(inside)
    })
    expect(document.querySelector('[data-block-handles]')!.getAttribute('data-pos')).toBe(String(block.pos))
  })

  test('tooltips are the expected strings with bold words', async () => {
    render(<p data-testid="t">{richText('<b>Drag</b> to move block around\n\n<b>Click</b> to show block options')}</p>)
    const p = screen.getByTestId('t')
    expect(Array.from(p.querySelectorAll('b')).map((b) => b.textContent)).toEqual(['Drag', 'Click'])
    expect(p.textContent).toBe('Drag to move block around\n\nClick to show block options')

    const editor = mounted('Hello\n')
    render(<BlockHandles editor={editor} />)
    hoverBlock(editor, 0)
    act(() => {
      fireEvent.focus(screen.getByRole('button', { name: '+' }))
    })
    const tip = await screen.findAllByText((_, el) => el?.textContent === 'Click to insert block below\n\nShift-click to insert block above')
    expect(tip.length).toBeGreaterThan(0)
  })

  test('plus handle inserts a paragraph and opens the slash menu', async () => {
    const editor = mounted('Hello\n\nWorld\n')
    render(
      <>
        <BlockHandles editor={editor} />
        <SlashMenu editor={editor} />
      </>,
    )
    hoverBlock(editor, 0)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '+' }))
    })
    expect(editor.state.doc.childCount).toBe(3)
    expect(editor.state.doc.child(1).textContent).toBe('/')
    expect(await screen.findByRole('listbox', { name: '/' })).toBeInTheDocument()

    // Shift-click inserts above.
    const other = mounted('Hello\n')
    render(<BlockHandles editor={other} />)
    hoverBlock(other, 0)
    act(() => {
      fireEvent.click(screen.getAllByRole('button', { name: '+' }).at(-1)!, { shiftKey: true })
    })
    expect(other.state.doc.child(0).textContent).toBe('/')
    expect(other.state.doc.child(1).textContent).toBe('Hello')
  })

  test('Escape after the plus handle takes its `/` away, leaving the new empty block (M7#20)', async () => {
    const editor = mounted('Hello\n\nWorld\n')
    render(
      <>
        <BlockHandles editor={editor} />
        <SlashMenu editor={editor} />
      </>,
    )
    hoverBlock(editor, 0)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '+' }))
    })
    await screen.findByRole('listbox', { name: '/' })
    const esc = (target: TiptapEditor) => {
      const event = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })
      Object.defineProperty(event, 'keyCode', { value: 27 })
      act(() => {
        target.view.dom.dispatchEvent(event)
      })
    }
    esc(editor)
    await waitFor(() => expect(screen.queryByRole('listbox', { name: '/' })).toBeNull())
    expect(editor.state.doc.childCount).toBe(3)
    expect(editor.state.doc.child(1).textContent).toBe('')
    expect(serializeBody(editor)).not.toContain('/')

    // A `/` typed by hand stays when Escape closes its menu.
    const typed = mounted('Hello\n')
    render(<SlashMenu editor={typed} />)
    act(() => {
      typed.commands.setTextSelection(typed.state.doc.content.size - 1)
      typed.view.dispatch(typed.state.tr.insertText(' /'))
    })
    esc(typed)
    expect(typed.state.doc.textContent).toBe('Hello /')
  })

  test('drag handle selects the block and opens the block menu with shortcut hints', async () => {
    const editor = mounted('Hello\n\nWorld\n')
    render(<BlockHandles editor={editor} />)
    hoverBlock(editor, 1)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '⋮⋮' }))
    })
    expect(blockSelectionRange(editor.state)?.blocks.map((b) => b.node.textContent)).toEqual(['World'])
    const menu = await screen.findByRole('menu')
    // A row's label: its text without the shortcut hint.
    const label = (m: Element) =>
      Array.from(m.childNodes)
        .filter((n) => !(n instanceof Element && n.getAttribute('data-slot') === 'dropdown-menu-shortcut'))
        .map((n) => n.textContent ?? '')
        .join('')
    // The block menu (catalog section 6), then our kept rows.
    expect(within(menu).getAllByRole('menuitem').map(label)).toEqual([
      'Hierarchy (Standard)',
      'List',
      'To-do',
      'Quote',
      'Toggle',
      'Group',
      'AI assistant...', // M10
      'Turn into...',
      'Copy',
      'Duplicate',
      'Remove',
      'Alignment', // M9
      'Standout',
      'Indent',
      'Unindent',
    ])
    const hint = (name: string) =>
      within(menu)
        .getAllByRole('menuitem')
        .find((m) => label(m) === name)!
        .querySelector('[data-slot="dropdown-menu-shortcut"]')?.textContent
    expect(hint('Group')).toBe('Ctrl+G')
    expect(hint('Duplicate')).toBe('Ctrl+D')
    expect(hint('Remove')).toBe('Backspace')

    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Duplicate/ }))
    expect(serializeBody(editor)).toBe('Hello\n\nWorld\n\nWorld\n')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  // The 2026-11-08 sweep: "Open block styling" (Ctrl+Shift+E, the catalog's Block editing group)
  // opens the block menu for the block with the cursor, as a click on its drag handle does.
  test('Ctrl+Shift+E opens the block menu for the block with the cursor; with blocks selected, for them', async () => {
    const editor = mounted('Hello\n\nWorld\n\nLast\n')
    render(<BlockHandles editor={editor} />)
    const world = blockPos(editor, 1)
    editor.commands.setTextSelection(world + 1)
    const press = () => {
      const event = new KeyboardEvent('keydown', { key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
      Object.defineProperty(event, 'keyCode', { value: 69 })
      let prevented = false
      act(() => {
        prevented = !editor.view.dom.dispatchEvent(event)
      })
      return prevented
    }
    expect(press()).toBe(true)
    const menu = await screen.findByRole('menu')
    expect(blockSelectionRange(editor.state)?.blocks.map((b) => b.node.textContent)).toEqual(['World'])
    expect(within(menu).getByRole('menuitem', { name: /^Duplicate/ })).toBeInTheDocument()
    // The handles sit beside the block the menu is for.
    expect(document.querySelector('[data-block-handles]')?.getAttribute('data-pos')).toBe(String(world))
    fireEvent.keyDown(menu, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    // A block selection is kept: the menu acts on all of it.
    selectBlocks(editor, blockPos(editor, 1), blockPos(editor, 2))
    expect(press()).toBe(true)
    const again = await screen.findByRole('menu')
    expect(within(again).getByText('2 selected')).toBeInTheDocument()
    expect(blockSelectionRange(editor.state)?.blocks.map((b) => b.node.textContent)).toEqual(['World', 'Last'])
  })

  test('move via handle keeps the moved block\'s bytes', () => {
    const editor = mounted(BODY)
    // Drop B below the toggle: the blocks reordered, each byte-identical.
    expect(moveBlockTo(editor, blockPos(editor, 1), blockPos(editor, 3))).toBe(true)
    expect(serializeBody(editor)).toBe(
      'A *one*  \n\n<!--toggle open-->\nC\n\nInside\n<!-- /toggle -->\n\n<!-- block: small -->\nB _two_\n\nD\n',
    )
    // And back: the original bytes.
    expect(moveBlockTo(editor, blockPos(editor, 2), blockPos(editor, 1))).toBe(true)
    expect(serializeBody(editor)).toBe(BODY)

    // Starting a drag selects the block as a node and hands ProseMirror a move.
    const setData = vi.fn()
    const event = { dataTransfer: { setData, effectAllowed: '' } } as unknown as DragEvent
    expect(startBlockDrag(editor, blockPos(editor, 1), event)).toBe(true)
    const dragging = (editor.view as unknown as { dragging: { move: boolean; slice: { content: { firstChild: { textContent: string } } } } }).dragging
    expect(dragging.move).toBe(true)
    expect(dragging.slice.content.firstChild.textContent).toBe('B two')
    expect(setData).toHaveBeenCalledWith('text/plain', '<!-- block: small -->\nB _two_')
    selectBlocks(editor, 0)
  })
})
