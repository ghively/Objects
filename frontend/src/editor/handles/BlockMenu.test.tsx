import { Editor as TiptapEditor } from '@tiptap/core'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { selectBlocks } from '../extensions/blockSelection'
import { BlockMenu, TURN_INTO_ITEMS } from './BlockMenu'

const editors: TiptapEditor[] = []
afterEach(() => {
  cleanup()
  while (editors.length) editors.pop()!.destroy()
})

function headless(body: string): TiptapEditor {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  loadBody(editor, body)
  editors.push(editor)
  return editor
}

function blockPos(editor: TiptapEditor, i: number): number {
  let pos = 0
  for (let k = 0; k < i; k++) pos += editor.state.doc.child(k).nodeSize
  return pos
}

function renderMenu(editor: TiptapEditor) {
  return render(<BlockMenu editor={editor} open onOpenChange={() => {}} anchor={{ left: 0, top: 0, width: 10, height: 10 }} />)
}

/** Open the sub-menu behind the row named `name` (plain clicks: a pointer path closes Radix sub-menus in jsdom). */
async function openSub(menu: HTMLElement, name: RegExp): Promise<HTMLElement> {
  const trigger = within(menu).getByRole('menuitem', { name })
  fireEvent.click(trigger)
  const id = trigger.getAttribute('aria-controls')!
  return await screen.findByRole('menu', { name: (_, el) => el.id === id })
}

/** Select top-level block `i`, open the block menu and pick `item` (in the sub-menu `sub` when given). */
async function pick(editor: TiptapEditor, i: number, item: string, sub?: RegExp) {
  selectBlocks(editor, blockPos(editor, i))
  const view = renderMenu(editor)
  const menu = await screen.findByRole('menu')
  const target = sub ? await openSub(menu, sub) : menu
  fireEvent.click(within(target).getByRole('menuitem', { name: new RegExp(`^${item}`) }))
  view.unmount()
}

const BODY = 'One\n\n<!-- block: color=bg-red align=center -->\nTwo\n\nThree\n'

describe('<BlockMenu>', () => {
  test('turn into lists every kind with the reference names', async () => {
    expect(TURN_INTO_ITEMS.map((t) => t.name)).toEqual([
      'Text',
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Heading 4',
      'Small',
      'Bullet list',
      'Numbered list',
      'Alphabetical list',
      'Roman list',
      'To-do',
      'Toggle',
      'Quote block',
      'Code',
    ])
  })

  test("the block menu has Capacities' sections, labels and Hierarchy order", async () => {
    const editor = headless(BODY)
    selectBlocks(editor, blockPos(editor, 0))
    renderMenu(editor)
    const menu = await screen.findByRole('menu')
    const names = within(menu)
      .getAllByRole('menuitem')
      .map((el) => el.textContent ?? '')
    const starts = (label: string) => names.findIndex((n) => n.startsWith(label))
    const order = [
      'Hierarchy (Standard)',
      'List',
      'To-do',
      'Icon',
      'Quote',
      'Toggle',
      'Group',
      'Insert block above',
      'Insert block below',
      'Turn into...',
      'Copy',
      'Duplicate',
      'Remove',
      'Color', // ours, kept: nothing else removes a block colour
      'Standout',
      'Indent',
      'Unindent',
    ]
    const at = order.map(starts)
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    // Gone: Capacities has no "Turn Into" type list, Move up/down or Remove style here.
    expect(names.some((n) => /^(Turn Into|Move up|Move down|Remove style|Delete)/.test(n))).toBe(false)
    expect(within(menu).getAllByRole('separator')).toHaveLength(3)

    const hierarchy = await openSub(menu, /^Hierarchy/)
    expect(within(hierarchy).getAllByRole('menuitem').map((m) => (m.textContent ?? '').replace(/(Ctrl|Alt|Mod|⌘).*$/, ''))).toEqual([
      'Standard',
      'Small',
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Heading 4',
    ])
  })

  test('copy sub-menu and the selected count', async () => {
    const editor = headless(BODY)
    selectBlocks(editor, blockPos(editor, 0))
    let view = renderMenu(editor)
    let menu = await screen.findByRole('menu')
    const copy = await openSub(menu, /^Copy/)
    expect(within(copy).getAllByRole('menuitem').map((m) => (m.textContent ?? '').replace(/(Ctrl|Alt|Mod|⌘).*$/, ''))).toEqual([
      'Copy blocks',
      'Copy as Markdown',
      'Copy block reference',
    ])
    expect(within(menu).queryByText(/selected$/)).toBeNull()
    view.unmount()

    selectBlocks(editor, blockPos(editor, 0), blockPos(editor, 2))
    view = renderMenu(editor)
    menu = await screen.findByRole('menu')
    expect(within(menu).getByText('3 selected')).toBeInTheDocument()
    // "Copy block reference" is for one block only.
    const copyMany = await openSub(menu, /^Copy/)
    expect(within(copyMany).queryByRole('menuitem', { name: /Copy block reference/ })).toBeNull()
    view.unmount()
  })

  test('style toggles, insert above and below, duplicate and remove', async () => {
    const editor = headless(BODY)

    await pick(editor, 2, 'Heading 2', /^Hierarchy/)
    expect(serializeBody(editor)).toBe('One\n\n<!-- block: color=bg-red align=center -->\nTwo\n\n## Three\n')
    await pick(editor, 2, 'Standard', /^Hierarchy/)
    expect(serializeBody(editor)).toBe(BODY)
    await pick(editor, 0, 'To-do')
    expect(serializeBody(editor)).toBe('- [ ] One\n\n<!-- block: color=bg-red align=center -->\nTwo\n\nThree\n')
    await pick(editor, 0, 'To-do')
    expect(serializeBody(editor)).toBe(BODY)
    await pick(editor, 0, 'Quote')
    expect(serializeBody(editor)).toBe('> One\n\n<!-- block: color=bg-red align=center -->\nTwo\n\nThree\n')
    await pick(editor, 0, 'Quote')
    expect(serializeBody(editor)).toBe(BODY)
    await pick(editor, 0, 'Group')
    expect(serializeBody(editor)).toBe('<!-- group -->\nOne\n<!-- /group -->\n\n<!-- block: color=bg-red align=center -->\nTwo\n\nThree\n')

    const plain = headless(BODY)
    await pick(plain, 1, 'Duplicate')
    expect(serializeBody(plain)).toBe(
      'One\n\n<!-- block: color=bg-red align=center -->\nTwo\n\n<!-- block: color=bg-red align=center -->\nTwo\n\nThree\n',
    )
    await pick(plain, 2, 'Remove')
    expect(serializeBody(plain)).toBe(BODY)

    await pick(plain, 1, 'Insert block above')
    plain.commands.insertContent('Above')
    await pick(plain, 0, 'Insert block below')
    plain.commands.insertContent('Below')
    expect(serializeBody(plain)).toBe('One\n\nBelow\n\nAbove\n\n<!-- block: color=bg-red align=center -->\nTwo\n\nThree\n')
  })
})
