import { Editor as TiptapEditor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { TableMenu } from './TableMenu'
import { tableAt } from './tableCommands'

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

const TABLE = ['| Host  | Role |', '| :---- | ---: |', '| alpha | db   |', '| beta  | web  |'].join('\n')
const BODY = `Before\n\n${TABLE}\n\nAfter\n`

async function mount(body: string): Promise<TiptapEditor> {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  editors.push(editor)
  render(<EditorContent editor={editor} />)
  await act(async () => {
    loadBody(editor, body)
  })
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

async function cursorIn(editor: TiptapEditor, text: string) {
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isTextblock && node.textContent === text) at = pos + 1
  })
  await act(async () => {
    editor.commands.setTextSelection(at)
  })
}

async function pick(user: ReturnType<typeof userEvent.setup>, menu: string, item: string) {
  await user.click(screen.getByRole('button', { name: menu }))
  const list = await screen.findByRole('menu')
  await user.click(within(list).getByRole('menuitem', { name: item }))
}

function cellsOfRow(editor: TiptapEditor, row: number): HTMLElement[] {
  const tr = editor.view.dom.querySelectorAll('tr')[row]
  return Array.from(tr.querySelectorAll<HTMLElement>('th, td'))
}

describe('TableMenu', () => {
  test('header row and header column switches write their options and change cells', async () => {
    const user = userEvent.setup()
    const editor = await mount(BODY)
    // The bar appears once the table holds the cursor.
    await cursorIn(editor, 'db')
    await user.click(await screen.findByRole('button', { name: 'Edit table' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Header row' })).toHaveAttribute('aria-checked', 'true')
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Header column' })).toHaveAttribute('aria-checked', 'false')

    await user.click(within(menu).getByRole('menuitemcheckbox', { name: 'Header row' }))
    expect(serializeBody(editor)).toBe(`Before\n\n<!-- block: no-header-row -->\n${TABLE}\n\nAfter\n`)
    // The file keeps its header and separator lines; the first row now shows as ordinary cells.
    await waitFor(() => expect(cellsOfRow(editor, 0)[0]).toHaveAttribute('data-cell-header', 'false'))
    expect(cellsOfRow(editor, 0).map((c) => c.tagName)).toEqual(['TH', 'TH'])
    // The menu stays open on a switch.
    await waitFor(() =>
      expect(within(screen.getByRole('menu')).getByRole('menuitemcheckbox', { name: 'Header row' })).toHaveAttribute('aria-checked', 'false'),
    )

    await user.click(within(screen.getByRole('menu')).getByRole('menuitemcheckbox', { name: 'Header column' }))
    expect(serializeBody(editor)).toBe(`Before\n\n<!-- block: header-column no-header-row -->\n${TABLE}\n\nAfter\n`)
    await waitFor(() => expect(cellsOfRow(editor, 1)[0]).toHaveAttribute('data-cell-header', 'true'))
    expect(cellsOfRow(editor, 1)[1]).not.toHaveAttribute('data-cell-header')
    expect(cellsOfRow(editor, 0)[0]).not.toHaveAttribute('data-cell-header') // header row off, header column on: a header
    expect(cellsOfRow(editor, 0)[1]).toHaveAttribute('data-cell-header', 'false')

    await user.click(within(screen.getByRole('menu')).getByRole('menuitemcheckbox', { name: 'Header row' }))
    await user.click(within(screen.getByRole('menu')).getByRole('menuitemcheckbox', { name: 'Header column' }))
    expect(serializeBody(editor)).toBe(BODY)
    await waitFor(() => expect(editor.view.dom.querySelector('[data-cell-header]')).toBeNull())
  })

  test('row and column menus insert, delete and clear', async () => {
    const user = userEvent.setup()
    const editor = await mount(BODY)
    await cursorIn(editor, 'db')
    await screen.findByRole('button', { name: 'Edit row' })

    await pick(user, 'Edit row', 'Insert row below')
    let table = tableAt(editor.state.doc, tablePos(editor))!
    expect(table.childCount).toBe(4)
    expect(table.child(2).textContent).toBe('')

    await cursorIn(editor, 'db')
    await pick(user, 'Edit row', 'Insert row above')
    table = tableAt(editor.state.doc, tablePos(editor))!
    expect(table.childCount).toBe(5)
    expect(table.child(1).textContent).toBe('')
    expect(table.child(2).textContent).toBe('alphadb')

    await cursorIn(editor, 'db')
    await pick(user, 'Edit row', 'Delete row')
    table = tableAt(editor.state.doc, tablePos(editor))!
    expect(table.childCount).toBe(4)
    expect(table.textContent).not.toContain('alpha')

    await cursorIn(editor, 'web')
    await pick(user, 'Edit row', 'Clear row')
    table = tableAt(editor.state.doc, tablePos(editor))!
    expect(table.textContent).toBe('HostRole')

    await cursorIn(editor, 'Role')
    await pick(user, 'Edit column', 'Insert column before')
    expect(tableAt(editor.state.doc, tablePos(editor))!.child(0).childCount).toBe(3)
    await cursorIn(editor, 'Role')
    await pick(user, 'Edit column', 'Insert column after')
    table = tableAt(editor.state.doc, tablePos(editor))!
    expect(table.child(0).childCount).toBe(4)
    expect(Array.from({ length: 4 }, (_, i) => table.child(0).child(i).textContent)).toEqual(['Host', '', 'Role', ''])

    await cursorIn(editor, 'Role')
    await pick(user, 'Edit column', 'Clear column')
    expect(tableAt(editor.state.doc, tablePos(editor))!.textContent).toBe('Host')

    await cursorIn(editor, 'Host')
    await pick(user, 'Edit column', 'Delete column')
    table = tableAt(editor.state.doc, tablePos(editor))!
    expect(table.child(0).childCount).toBe(3)
    expect(table.textContent).toBe('')

    // A cell's "Clear cell contents", then "Delete table".
    await act(async () => {
      editor.commands.insertContentAt(tablePos(editor) + 4, 'Zed')
    })
    await cursorIn(editor, 'Zed')
    await pick(user, 'Edit table', 'Clear cell contents')
    expect(tableAt(editor.state.doc, tablePos(editor))!.textContent).toBe('')

    await act(async () => {
      editor.commands.setTextSelection(tablePos(editor) + 4)
    })
    await pick(user, 'Edit table', 'Delete table')
    expect(tablePos(editor)).toBe(-1)
    expect(serializeBody(editor)).toBe('Before\n\nAfter\n')
  })

  test('row and column menus are disabled without a cell under the cursor', async () => {
    const editor = await mount(BODY)
    render(<TableMenu editor={editor} getPos={() => tablePos(editor)} />)
    expect(screen.getByRole('button', { name: 'Edit row' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit column' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit table' })).toBeEnabled()
  })

  test('the bar mounts when a table is hovered', async () => {
    const editor = await mount(BODY)
    expect(screen.queryByRole('button', { name: 'Edit table' })).toBeNull()
    const cell = editor.view.dom.querySelector('td')!
    await act(async () => {
      cell.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(await screen.findByRole('button', { name: 'Edit table' })).toBeInTheDocument()
  })
})
