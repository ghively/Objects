import { Editor as TiptapEditor } from '@tiptap/core'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { cellPos, columnAlignment, setColumnAlignment } from './tableCommands'
import { TableMenu } from './TableMenu'

const editors: TiptapEditor[] = []
afterEach(() => {
  cleanup()
  while (editors.length) editors.pop()!.destroy()
})

const TABLE = '| Name | Qty |\n| ---- | :-: |\n| Apple | 3 |\n| Pear | 10 |\n'

function headless(body: string): TiptapEditor {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  loadBody(editor, body)
  editors.push(editor)
  return editor
}

function tablePos(editor: TiptapEditor): number {
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.type.name === 'table') at = pos
    return at < 0
  })
  return at
}

/** Put the caret in the cell at `row`, `col`. */
function caretIn(editor: TiptapEditor, row: number, col: number) {
  const pos = cellPos(editor.state.doc, tablePos(editor), { row, col })!
  editor.commands.setTextSelection(pos + 2)
}

describe('table cell alignment (M9)', () => {
  test('a column alignment loads from the separator line and round-trips', () => {
    const editor = headless(TABLE)
    const at = tablePos(editor)
    expect(columnAlignment(editor.state.doc, at, 0)).toBe('left')
    expect(columnAlignment(editor.state.doc, at, 1)).toBe('center')
    expect(serializeBody(editor)).toBe(TABLE)
  })

  test('setting a column alignment rewrites only the separator line', () => {
    const editor = headless(`Intro\n\n${TABLE}\nOutro\n`)
    const at = tablePos(editor)
    expect(setColumnAlignment(editor, at, 0, 'right')).toBe(true)
    expect(columnAlignment(editor.state.doc, at, 0)).toBe('right')
    const lines = serializeBody(editor).split('\n')
    expect(lines[0]).toBe('Intro')
    expect(lines[2]).toBe('| Name | Qty |')
    expect(lines[3]).toMatch(/^\| -+: \| :-+: \|$/)
    expect(lines.slice(4)).toEqual(['| Apple | 3 |', '| Pear | 10 |', '', 'Outro', ''])
    // Left is the default: the column's alignment marker goes away again.
    setColumnAlignment(editor, at, 0, 'left')
    setColumnAlignment(editor, tablePos(editor), 1, 'left')
    expect(columnAlignment(editor.state.doc, tablePos(editor), 1)).toBe('left')
    expect(serializeBody(editor).split('\n')[3]).toMatch(/^\| -+ \| -+ \|$/)
  })

  test('the table bar has an Alignment dropdown for the cell with the caret', async () => {
    const editor = headless(TABLE)
    caretIn(editor, 1, 0)
    render(<TableMenu editor={editor} getPos={() => tablePos(editor)} />)
    const button = screen.getByRole('button', { name: 'Alignment' })
    act(() => {
      fireEvent.pointerDown(button, { button: 0, ctrlKey: false })
    })
    const menu = await screen.findByRole('menu')
    const items = within(menu).getAllByRole('menuitemradio')
    expect(items.map((i) => i.textContent?.trim())).toEqual(['Align text left', 'Text align center', 'Text align right'])
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    fireEvent.click(items[1])
    expect(columnAlignment(editor.state.doc, tablePos(editor), 0)).toBe('center')
    expect(serializeBody(editor).split('\n')[1]).toMatch(/^\| :-+: \| :-+: \|$/)
  })

  test('the Alignment dropdown is disabled without a cell holding the caret', () => {
    const editor = headless(`Intro\n\n${TABLE}`)
    editor.commands.setTextSelection(2)
    render(<TableMenu editor={editor} getPos={() => tablePos(editor)} />)
    expect(screen.getByRole('button', { name: 'Alignment' })).toBeDisabled()
  })
})
