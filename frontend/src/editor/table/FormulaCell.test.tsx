import { Editor as TiptapEditor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { matchingStatements } from './FormulaCell'

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

const BODY = [
  'Intro',
  '',
  '| Item | Qty |',
  '| ---- | --- |',
  '| a    | 2   |',
  '| b    | 3   |',
  '| Sum  | =SUM(B2:B3) |',
  '| Bad  | =1/0 |',
  '| New  | = |',
  '',
].join('\n')

async function mount(body: string): Promise<TiptapEditor> {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  editors.push(editor)
  render(<EditorContent editor={editor} />)
  await act(async () => {
    loadBody(editor, body)
  })
  return editor
}

/** Put the caret at the end of the textblock whose text is `text`. */
async function caretAtEnd(editor: TiptapEditor, text: string) {
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isTextblock && node.textContent === text) at = pos + 1 + node.content.size
  })
  expect(at).toBeGreaterThan(0)
  await act(async () => {
    editor.commands.setTextSelection(at)
  })
}

function cellOf(editor: TiptapEditor, row: number, col: number): HTMLElement {
  return editor.view.dom.querySelectorAll('tr')[row].querySelectorAll<HTMLElement>('th, td')[col]
}

describe('FormulaCell', () => {
  test('test cell shows value and edits formula', async () => {
    const editor = await mount(BODY)
    const sum = cellOf(editor, 3, 1)
    expect(sum.classList.contains('formula-cell')).toBe(true)
    expect(sum.querySelector('.formula-value')!.textContent).toBe('5')
    expect(sum.querySelector('.formula-source')).not.toBeNull()
    // An error shows its title, the message as the tooltip.
    const bad = cellOf(editor, 4, 1).querySelector<HTMLElement>('.formula-error')!
    expect(bad.textContent).toBe('Value')
    expect(bad.title).toBe("This formula's result is infinite or undefined.")
    // Ordinary cells are untouched.
    expect(cellOf(editor, 1, 1).classList.contains('formula-cell')).toBe(false)

    // The caret in the cell shows the formula text.
    await caretAtEnd(editor, '=SUM(B2:B3)')
    const editing = cellOf(editor, 3, 1)
    expect(editing.getAttribute('data-formula')).toBe('editing')
    expect(editing.querySelector('.formula-value')).toBeNull()
    expect(editing.querySelector('.formula-source')).toBeNull()
    expect(editing.textContent).toContain('=SUM(B2:B3)')
    // Showing values and moving the caret write nothing.
    expect(serializeBody(editor)).toBe(BODY)

    // A bare `=` shows the "Formula" placeholder and every statement.
    await caretAtEnd(editor, '=')
    const fresh = cellOf(editor, 5, 1)
    expect(fresh.querySelector('.formula-placeholder')!.textContent).toBe('Formula')
    await waitFor(() => expect(fresh.querySelectorAll('[role="option"]').length).toBe(20))

    // Typing a name filters the list; a click puts `NAME(` in its place.
    await act(async () => {
      editor.commands.insertContent('su')
    })
    expect(fresh.querySelector('.formula-placeholder')).toBeNull()
    await waitFor(() => expect(Array.from(fresh.querySelectorAll('[role="option"]')).map((o) => o.textContent)).toEqual(['SUMCalculate sum of values']))
    await act(async () => {
      fireEvent.mouseDown(fresh.querySelector('[role="option"]')!)
    })
    expect(serializeBody(editor)).toMatch(/\| New +\| =SUM\( \|\n/)

    // No match: "No options found".
    await act(async () => {
      editor.commands.insertContent('zz')
    })
    await waitFor(() => expect(cellOf(editor, 5, 1).querySelector('.formula-menu-empty')!.textContent).toBe('No options found'))

    // Keyboard: ArrowDown and Enter pick the second match.
    await act(async () => {
      editor.commands.insertContent(') + M')
    })
    expect(matchingStatements('M').map((s) => s.name)).toEqual(['MAX', 'MEDIAN', 'MIN'])
    await act(async () => {
      fireEvent.keyDown(editor.view.dom, { key: 'ArrowDown' })
    })
    await waitFor(() => expect(cellOf(editor, 5, 1).querySelector('[aria-selected="true"]')!.textContent).toMatch(/^MEDIAN/))
    await act(async () => {
      fireEvent.keyDown(editor.view.dom, { key: 'Enter' })
    })
    expect(serializeBody(editor)).toContain('=SUM(zz) + MEDIAN(')

    // Leaving the cell shows its value (or error) again, and the other lines kept their bytes.
    await caretAtEnd(editor, 'Intro')
    expect(cellOf(editor, 5, 1).querySelector('.formula-error')!.textContent).toBe('Expression')
    expect(cellOf(editor, 3, 1).querySelector('.formula-value')!.textContent).toBe('5')
    const out = serializeBody(editor).split('\n')
    expect(out.slice(0, 8)).toEqual(BODY.split('\n').slice(0, 8))
  })

  test('formula cells in a read-only editor always show their values', async () => {
    const editor = await mount(BODY)
    await act(async () => {
      editor.setEditable(false)
    })
    await caretAtEnd(editor, '=SUM(B2:B3)')
    expect(cellOf(editor, 3, 1).querySelector('.formula-value')!.textContent).toBe('5')
  })
})
