import { Editor as TiptapEditor } from '@tiptap/core'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { blockSelectionRange, selectBlocks } from '../extensions/blockSelection'
import { BlockStyleExtras, BlockStyleMenu } from './BlockStyleMenu'

const editors: TiptapEditor[] = []
afterEach(() => {
  cleanup()
  while (editors.length) editors.pop()!.destroy()
})

function headless(body: string, cursorText?: string): TiptapEditor {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  loadBody(editor, body)
  editors.push(editor)
  if (cursorText) {
    let at = -1
    editor.state.doc.descendants((node, pos) => {
      if (at < 0 && node.isTextblock && node.textContent.includes(cursorText)) at = pos + 1
    })
    editor.commands.setTextSelection(at + 1)
  }
  return editor
}

function renderMenu(editor: TiptapEditor) {
  return render(
    <DropdownMenu open>
      <DropdownMenuTrigger>Block</DropdownMenuTrigger>
      <DropdownMenuContent>
        <BlockStyleMenu editor={editor} />
        <BlockStyleExtras editor={editor} />
      </DropdownMenuContent>
    </DropdownMenu>,
  )
}

async function openAlignment(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('menuitem', { name: 'Alignment' }))
  const id = screen.getByRole('menuitem', { name: 'Alignment' }).getAttribute('aria-controls')!
  return await screen.findByRole('menu', { name: (_, el) => el.id === id })
}

async function pick(editor: TiptapEditor, item: string) {
  const view = renderMenu(editor)
  const menu = await openAlignment()
  fireEvent.click(within(menu).getByRole('menuitem', { name: item }))
  view.unmount()
}

describe('Alignment in the block menu (M9)', () => {
  test('test alignment submenu labels verbatim', async () => {
    renderMenu(headless('Hello\n', 'Hello'))
    const menu = await openAlignment()
    // EditorPanel.shortLabels.alignment; shortcuts.textAlignLeft/Center/Right.name
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent?.trim())).toEqual([
      'Align text left',
      'Text align center',
      'Text align right',
    ])
    // The current alignment (none: left) is checked.
    const checks = within(menu)
      .getAllByRole('menuitem')
      .map((m) => (m.querySelector('svg.lucide-check') as SVGElement | null)?.style.visibility)
    expect(checks).toEqual(['visible', 'hidden', 'hidden'])
  })

  test('test choosing center writes align=center on selected blocks only', async () => {
    const editor = headless('One\n\nTwo\n\nThree\n')
    selectBlocks(editor, 0, editor.state.doc.child(0).nodeSize)
    expect(blockSelectionRange(editor.state)?.blocks).toHaveLength(2)
    await pick(editor, 'Text align center')
    expect(serializeBody(editor)).toBe('<!-- block: align=center -->\nOne\n\n<!-- block: align=center -->\nTwo\n\nThree\n')
  })

  test('test left removes the option', async () => {
    const body = '<!-- block: color=bg-blue align=right -->\nOne\n\nTwo\n'
    const editor = headless(body, 'One')
    renderMenu(editor)
    const menu = await openAlignment()
    const right = within(menu).getByRole('menuitem', { name: 'Text align right' })
    expect((right.querySelector('svg.lucide-check') as SVGElement).style.visibility).toBe('visible')
    cleanup()
    await pick(editor, 'Align text left')
    expect(serializeBody(editor)).toBe('<!-- block: color=bg-blue -->\nOne\n\nTwo\n')
  })

  test('a list item takes its own alignment', async () => {
    const editor = headless('- Buy milk\n- Call Ada\n', 'Call')
    await pick(editor, 'Text align right')
    expect(serializeBody(editor)).toBe('- Buy milk\n- Call Ada <!-- item: align=right -->\n')
    await pick(editor, 'Align text left')
    expect(serializeBody(editor)).toBe('- Buy milk\n- Call Ada\n')
  })

  test('test hidden for blocks without align', () => {
    renderMenu(headless('```js\ncode\n```\n', 'code'))
    expect(screen.queryByRole('menuitem', { name: 'Alignment' })).toBeNull()
    cleanup()
    renderMenu(headless('> quoted\n', 'quoted'))
    expect(screen.queryByRole('menuitem', { name: 'Alignment' })).toBeNull()
  })
})
