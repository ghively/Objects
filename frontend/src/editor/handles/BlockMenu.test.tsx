import { Editor as TiptapEditor } from '@tiptap/core'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { resetAiStore, useAi } from '@/ai/store'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { selectBlocks } from '../extensions/blockSelection'
import { BlockMenu, TURN_INTO_ITEMS } from './BlockMenu'
import { GroupBlocksKey } from './groupKey'

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

/** A row's text without its shortcut hint and hidden check mark. */
const label = (el: Element) =>
  Array.from(el.childNodes)
    .filter((n) => !(n instanceof Element && (n.getAttribute('aria-hidden') === 'true' || n.getAttribute('data-slot') === 'dropdown-menu-shortcut')))
    .map((n) => n.textContent ?? '')
    .join('')

const BODY = 'One\n\n<!-- block: color=bg-red align=center -->\nTwo\n\nThree\n'

describe('<BlockMenu>', () => {
  test('turn into lists every kind with its name', async () => {
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

  test('the block menu has the catalogued set, in its order, with key hints', async () => {
    const editor = headless(BODY)
    selectBlocks(editor, blockPos(editor, 0))
    renderMenu(editor)
    const menu = await screen.findByRole('menu')
    const rows = within(menu).getAllByRole('menuitem')
    const names = rows.map((el) => label(el))
    // The catalogued block menu (catalog section 6), then Object's own rows (no other entry point).
    expect(names).toEqual([
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
      'Alignment', // ours (M9): block alignment's one entry point
      'Standout', // ours
      'Indent', // ours
      'Unindent', // ours
    ])
    // Key hints from the registry: Group Ctrl+G, Duplicate Ctrl+D, Remove Backspace.
    const hintOf = (name: string) => rows[names.indexOf(name)].querySelector('[data-slot="dropdown-menu-shortcut"]')?.textContent
    expect(hintOf('Group')).toMatch(/^(Ctrl\+G|⌘G)$/)
    expect(hintOf('Duplicate')).toMatch(/^(Ctrl\+D|⌘D)$/)
    expect(hintOf('Remove')).toBe('Backspace')
    expect(within(menu).getAllByRole('separator')).toHaveLength(2)

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
  })

  test('Ctrl+G groups the selected blocks, and ungroups them again', () => {
    const editor = new TiptapEditor({ extensions: [...editorExtensions(), GroupBlocksKey] })
    loadBody(editor, BODY)
    editors.push(editor)
    selectBlocks(editor, blockPos(editor, 0))
    const press = () =>
      editor.view.someProp('handleKeyDown', (f) =>
        f(editor.view, new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', ctrlKey: true, bubbles: true, cancelable: true })),
      )
    expect(press()).toBe(true)
    expect(serializeBody(editor)).toBe('<!-- group -->\nOne\n<!-- /group -->\n\n<!-- block: color=bg-red align=center -->\nTwo\n\nThree\n')
    editor.commands.setTextSelection(3)
    selectBlocks(editor, blockPos(editor, 0))
    expect(press()).toBe(true)
    expect(serializeBody(editor)).toBe(BODY)
    // Without a block selection the key is left alone.
    editor.commands.setTextSelection(2)
    expect(press()).toBeFalsy()
  })

  test('m10: AI assistant... opens the chat about the selected blocks; accepting replaces them', async () => {
    resetAiStore()
    const editor = headless(BODY)
    await pick(editor, 0, 'AI assistant...')
    const seed = useAi.getState().pending!.seed
    expect(seed).toMatchObject({ mode: 'askBlock', block: 'One' })
    seed.onReplace!('- Uno\n- Dos')
    expect(serializeBody(editor)).toBe('- Uno\n- Dos\n\n<!-- block: color=bg-red align=center -->\nTwo\n\nThree\n')

    // Several blocks: their Markdown, and insert below goes after the last.
    selectBlocks(editor, blockPos(editor, 1), blockPos(editor, 2))
    renderMenu(editor)
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /^AI assistant/ }))
    const many = useAi.getState().pending!.seed
    expect(many.block).toBe('<!-- block: color=bg-red align=center -->\nTwo\n\nThree')
    many.onInsertBelow!('After')
    expect(serializeBody(editor)).toBe('- Uno\n- Dos\n\n<!-- block: color=bg-red align=center -->\nTwo\n\nThree\n\nAfter\n')
    resetAiStore()
  })

  test('m10: no AI assistant... while AI features are hidden', async () => {
    useSettings.setState({ settings: { ...settingsDefaults, aiHidden: true } })
    try {
      const editor = headless(BODY)
      selectBlocks(editor, blockPos(editor, 0))
      renderMenu(editor)
      const menu = await screen.findByRole('menu')
      expect(within(menu).queryByRole('menuitem', { name: /AI assistant/ })).toBeNull()
    } finally {
      useSettings.setState({ settings: settingsDefaults })
    }
  })
})
