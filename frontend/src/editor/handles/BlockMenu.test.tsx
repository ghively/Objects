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

/** Select top-level block `i`, open the block menu and pick `item` (in "Turn Into" when `turnInto`). */
async function pick(editor: TiptapEditor, i: number, item: string, turnInto = false) {
  selectBlocks(editor, blockPos(editor, i))
  const view = render(<BlockMenu editor={editor} open onOpenChange={() => {}} anchor={{ left: 0, top: 0, width: 10, height: 10 }} />)
  const menu = await screen.findByRole('menu')
  if (turnInto) {
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Turn Into' }))
    const id = within(menu).getByRole('menuitem', { name: 'Turn Into' }).getAttribute('aria-controls')!
    const sub = await screen.findByRole('menu', { name: (_, el) => el.id === id })
    fireEvent.click(within(sub).getByRole('menuitem', { name: new RegExp(`^${item}`) }))
  } else {
    fireEvent.click(within(menu).getByRole('menuitem', { name: new RegExp(`^${item}`) }))
  }
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

  test('turn into, insert above and below, move, duplicate, remove style and delete', async () => {
    const editor = headless(BODY)

    await pick(editor, 2, 'Heading 2', true)
    expect(serializeBody(editor)).toBe('One\n\n<!-- block: color=bg-red align=center -->\nTwo\n\n## Three\n')
    await pick(editor, 2, 'Text', true)
    expect(serializeBody(editor)).toBe(BODY)
    await pick(editor, 0, 'To-do', true)
    expect(serializeBody(editor)).toBe('- [ ] One\n\n<!-- block: color=bg-red align=center -->\nTwo\n\nThree\n')
    await pick(editor, 0, 'Text', true)
    expect(serializeBody(editor)).toBe(BODY)
    await pick(editor, 0, 'Quote block', true)
    expect(serializeBody(editor)).toBe('> One\n\n<!-- block: color=bg-red align=center -->\nTwo\n\nThree\n')
    await pick(editor, 0, 'Text', true)
    expect(serializeBody(editor)).toBe(BODY)

    await pick(editor, 1, 'Move up')
    expect(serializeBody(editor)).toBe('<!-- block: color=bg-red align=center -->\nTwo\n\nOne\n\nThree\n')
    await pick(editor, 0, 'Move down')
    expect(serializeBody(editor)).toBe(BODY)

    await pick(editor, 1, 'Duplicate')
    expect(serializeBody(editor)).toBe(
      'One\n\n<!-- block: color=bg-red align=center -->\nTwo\n\n<!-- block: color=bg-red align=center -->\nTwo\n\nThree\n',
    )
    await pick(editor, 2, 'Delete')
    expect(serializeBody(editor)).toBe(BODY)

    await pick(editor, 1, 'Remove style')
    expect(serializeBody(editor)).toBe('One\n\nTwo\n\nThree\n')

    await pick(editor, 1, 'Insert block above')
    editor.commands.insertContent('Above')
    await pick(editor, 0, 'Insert block below')
    editor.commands.insertContent('Below')
    expect(serializeBody(editor)).toBe('One\n\nBelow\n\nAbove\n\nTwo\n\nThree\n')
  })
})
