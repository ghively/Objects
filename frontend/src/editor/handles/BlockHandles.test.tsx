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

  test('tooltips are the reference strings with bold words', async () => {
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

  test('drag handle selects the block and opens the block menu with shortcut hints', async () => {
    const editor = mounted('Hello\n\nWorld\n')
    render(<BlockHandles editor={editor} />)
    hoverBlock(editor, 1)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '⋮⋮' }))
    })
    expect(blockSelectionRange(editor.state)?.blocks.map((b) => b.node.textContent)).toEqual(['World'])
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.firstChild?.textContent)).toEqual([
      'Turn Into',
      'Hierarchy',
      'List',
      'Quote',
      'Color',
      'Icon',
      'Insert block above',
      'Insert block below',
      'Move up',
      'Move down',
      'Duplicate',
      'Remove style',
      'Delete',
    ])
    const hint = (name: string) =>
      within(menu)
        .getAllByRole('menuitem')
        .find((m) => m.firstChild?.textContent === name)!
        .querySelector('[data-slot="dropdown-menu-shortcut"]')?.textContent
    expect(hint('Insert block above')).toBe('Alt+Shift+Enter')
    expect(hint('Insert block below')).toBe('Alt+Enter')
    expect(hint('Move up')).toBe('Ctrl+Shift+ArrowUp')
    expect(hint('Duplicate')).toBe('Ctrl+D')
    expect(hint('Delete')).toBe('Backspace')
    expect(hint('Remove style')).toBeUndefined()

    fireEvent.click(within(menu).getByRole('menuitem', { name: /Move up/ }))
    expect(serializeBody(editor)).toBe('World\n\nHello\n')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
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
