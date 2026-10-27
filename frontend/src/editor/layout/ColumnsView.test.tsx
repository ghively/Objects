import { Editor as TiptapEditor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { dividerLeft, gridTemplate } from './ColumnsView'
import { dragWidths, evenWidths, parseWidths } from './Divider'

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

async function mount(body: string): Promise<TiptapEditor> {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  editors.push(editor)
  render(<EditorContent editor={editor} />)
  await act(async () => {
    loadBody(editor, body)
  })
  return editor
}

function columnsPos(editor: TiptapEditor): number {
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.type.name === 'columns') at = pos
    return at < 0
  })
  return at
}

const BODY = ['Intro', '', '<!-- columns -->', 'Left side text.', '<!-- column -->', 'Right side text.', '<!-- /columns -->', '', 'Outro', ''].join('\n')

describe('width arithmetic', () => {
  test('even widths, parsing and dragging keep integers summing to 100', () => {
    expect(evenWidths(2)).toEqual([50, 50])
    expect(evenWidths(3)).toEqual([34, 33, 33])
    expect(evenWidths(6).reduce((a, b) => a + b, 0)).toBe(100)
    expect(parseWidths([{ key: 'widths', value: '40,60', raw: 'widths=40,60' }], 2)).toEqual([40, 60])
    expect(parseWidths([{ key: 'widths', value: '40,60', raw: 'widths=40,60' }], 3)).toBeNull()
    expect(parseWidths([{ key: 'widths', value: '40,50', raw: 'widths=40,50' }], 2)).toBeNull()
    expect(parseWidths(null, 2)).toBeNull()
    expect(dragWidths([50, 50], 0, 12.4)).toEqual([62, 38])
    expect(dragWidths([50, 50], 0, 80)).toEqual([90, 10])
    expect(dragWidths([50, 50], 0, -80)).toEqual([10, 90])
    expect(dragWidths([34, 33, 33], 1, 5)).toEqual([34, 38, 28])
    expect(gridTemplate(null, 3)).toBe('repeat(3, minmax(0, 1fr))')
    expect(gridTemplate([40, 60], 2)).toBe('minmax(0, 40fr) minmax(0, 60fr)')
    expect(dividerLeft([40, 60], 0)).toBe('calc((100% - 24px) * 0.4 + 12px)')
  })
})

describe('ColumnsView', () => {
  test('dragging a divider writes widths once on release', async () => {
    const editor = await mount(BODY)
    const wrapper = editor.view.dom.querySelector<HTMLElement>('.block-columns')!
    expect(wrapper).toHaveAttribute('data-columns', '2')
    expect(wrapper.style.getPropertyValue('--columns-template')).toBe('repeat(2, minmax(0, 1fr))')
    const body = wrapper.querySelector<HTMLElement>('.block-columns-body')!
    body.getBoundingClientRect = () => ({ width: 1024, height: 100, top: 0, left: 0, right: 1024, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    let updates = 0
    editor.on('update', () => updates++)
    const divider = screen.getByRole('separator')
    fireEvent.pointerDown(divider, { button: 0, clientX: 500 })
    fireEvent.pointerMove(window, { clientX: 550 })
    fireEvent.pointerMove(window, { clientX: 600 })
    // A preview while dragging, nothing written yet.
    await waitFor(() => expect(wrapper.style.getPropertyValue('--columns-template')).toBe('minmax(0, 60fr) minmax(0, 40fr)'))
    expect(updates).toBe(0)
    expect(serializeBody(editor)).toBe(BODY)

    fireEvent.pointerUp(window, { clientX: 600 })
    expect(updates).toBe(1)
    expect(serializeBody(editor)).toBe(BODY.replace('<!-- columns -->', '<!-- columns widths=60,40 -->'))
    await waitFor(() => expect(wrapper.style.getPropertyValue('--columns-template')).toBe('minmax(0, 60fr) minmax(0, 40fr)'))

    // A click without movement writes nothing.
    fireEvent.pointerDown(screen.getByRole('separator'), { button: 0, clientX: 600 })
    fireEvent.pointerUp(window, { clientX: 600 })
    expect(updates).toBe(1)
  })

  test('column layout writes layout=grid; add and remove column redistribute widths', async () => {
    const user = userEvent.setup()
    const editor = await mount(BODY.replace('<!-- columns -->', '<!-- columns widths=30,70 -->'))
    const wrapper = () => editor.view.dom.querySelector<HTMLElement>('.block-columns')!

    await user.click(screen.getByRole('button', { name: 'Column layout' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('Column layout')).toBeInTheDocument()
    expect(within(menu).getAllByRole('menuitemradio').map((m) => m.textContent)).toEqual(['Columns', 'Grid'])
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Grid' }))
    expect(serializeBody(editor)).toContain('<!-- columns widths=30,70 layout=grid -->\n')
    await waitFor(() => expect(wrapper()).toHaveAttribute('data-layout', 'grid'))
    // Grid wraps the columns: no dividers.
    expect(screen.queryByRole('separator')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Column layout' }))
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitemradio', { name: 'Columns' }))
    expect(serializeBody(editor)).toContain('<!-- columns widths=30,70 -->\n')

    await user.click(screen.getByRole('button', { name: 'Add column' }))
    expect(editor.state.doc.nodeAt(columnsPos(editor))!.childCount).toBe(3)
    expect(serializeBody(editor)).toBe(
      ['Intro', '', '<!-- columns -->', 'Left side text.', '<!-- column -->', 'Right side text.', '<!-- column -->', '<!-- /columns -->', '', 'Outro', ''].join('\n'),
    )
    await waitFor(() => expect(wrapper()).toHaveAttribute('data-columns', '3'))
    expect(wrapper().style.getPropertyValue('--columns-template')).toBe('repeat(3, minmax(0, 1fr))')
    expect(screen.getAllByRole('separator')).toHaveLength(2)
    // The new, empty column shows its placeholder line.
    expect(wrapper().querySelectorAll('[data-column-empty]')).toHaveLength(1)

    for (let i = 0; i < 3; i++) await user.click(screen.getByRole('button', { name: 'Add column' }))
    expect(editor.state.doc.nodeAt(columnsPos(editor))!.childCount).toBe(6)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add column' })).toBeDisabled())

    for (let i = 0; i < 4; i++) await user.click(screen.getByRole('button', { name: 'Remove column' }))
    expect(editor.state.doc.nodeAt(columnsPos(editor))!.childCount).toBe(2)
    expect(serializeBody(editor)).toBe(BODY)

    // Removing a column keeps its blocks: they move to the column before it.
    await user.click(screen.getByRole('button', { name: 'Remove column' }))
    expect(editor.state.doc.nodeAt(columnsPos(editor))!.childCount).toBe(1)
    expect(serializeBody(editor)).toBe(
      ['Intro', '', '<!-- columns -->', 'Left side text.', '', 'Right side text.', '<!-- /columns -->', '', 'Outro', ''].join('\n'),
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove column' })).toBeDisabled())
  })

  test('typing in an empty column clears its placeholder', async () => {
    const editor = await mount('Intro\n')
    await act(async () => {
      editor.chain().setTextSelection(1).insertColumns(2).run()
    })
    const wrapper = editor.view.dom.querySelector<HTMLElement>('.block-columns')!
    expect(wrapper.querySelectorAll('[data-column-empty]')).toHaveLength(2)
    const first = editor.state.doc.nodeAt(columnsPos(editor))!
    expect(first.childCount).toBe(2)
    await act(async () => {
      editor.chain().insertContentAt(columnsPos(editor) + 3, 'Typed').run()
    })
    expect(wrapper.querySelectorAll('[data-column-empty]')).toHaveLength(1)
    expect(serializeBody(editor)).toContain('<!-- columns -->\nTyped\n<!-- column -->\n')
  })

  test('the container colour paints the columns block', async () => {
    const editor = await mount(BODY.replace('<!-- columns -->', '<!-- columns color=bg-blue -->'))
    const wrapper = editor.view.dom.querySelector<HTMLElement>('.block-columns')!
    expect(wrapper).toHaveAttribute('data-block-color', 'bg-blue')
    expect(wrapper.style.backgroundColor).toBe('var(--label-bg-blue)')
  })
})
