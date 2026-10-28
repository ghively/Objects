import { Editor as TiptapEditor } from '@tiptap/core'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { THEME_COLORS } from '@/theme/palette'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { blockSelectionRange, selectBlocks } from '../extensions/blockSelection'
import { BlockStyleExtras, BlockStyleMenu, currentBlockStyle } from './BlockStyleMenu'
import { colorMenuName } from './colors'

const editors: TiptapEditor[] = []
afterEach(() => {
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

/** A row's text without its shortcut hint. */
const label = (el: Element) =>
  Array.from(el.childNodes)
    .filter((n) => !(n instanceof Element && (n.getAttribute('aria-hidden') === 'true' || n.getAttribute('data-slot') === 'dropdown-menu-shortcut')))
    .map((n) => n.textContent ?? '')
    .join('')

// Plain clicks throughout: a pointer path between Radix sub-menus closes them in jsdom.
async function openSub(name: string | RegExp): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('menuitem', { name }))
  const trigger = screen.getByRole('menuitem', { name })
  const id = trigger.getAttribute('aria-controls')!
  return await screen.findByRole('menu', { name: (_, el) => el.id === id })
}

async function pick(sub: string | RegExp, item: string, editor: TiptapEditor) {
  const view = renderMenu(editor)
  const menu = await openSub(sub)
  fireEvent.click(within(menu).getByRole('menuitem', { name: new RegExp(`^${item}`) }))
  view.unmount()
}

/** Click a top-level row. */
async function click(item: string, editor: TiptapEditor) {
  const view = renderMenu(editor)
  fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(`^${item}`) }))
  view.unmount()
}

describe('BlockStyleMenu', () => {
  test("lists Capacities' first block-menu section, then our kept rows", () => {
    renderMenu(headless('Hello world\n', 'Hello'))
    expect(screen.getAllByRole('menuitem').map(label)).toEqual([
      'Hierarchy (Standard)', // blocksMenu.hierarchy.title (+ the current level)
      'List',
      'To-do',
      'Icon',
      'Quote', // ActionItems.setBlockQuoteInterface.title
      'Toggle',
      'Group', // ActionItems.groupBlocks.title
      'Color',
      'Alignment', // M9: EditorPanel.shortLabels.alignment (a paragraph takes `align`)
      'Standout',
      'Indent', // tokensMenu.indent.shortName
      'Unindent', // tokensMenu.unindent.shortName
    ])
  })

  test('colour menu lists 18 text and 18 background colours with reference names', async () => {
    const editor = headless('Hello world\n', 'Hello')
      renderMenu(editor)
    const color = await openSub('Color')
    expect(within(color).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Text color', 'Background color'])

    const text = await openSub('Text color')
    const textItems = within(text).getAllByRole('menuitem').map((m) => m.textContent!.trim())
    expect(textItems[0]).toBe('Remove text color')
    expect(textItems.slice(1)).toHaveLength(18)
    expect(textItems.slice(1)).toEqual(THEME_COLORS.map((c) => colorMenuName('text', c)).map((n) => `A${n}`))
    expect(textItems).toContain('ASky text')
    expect(textItems).toContain('AGray text')
    expect(text.querySelector('[data-swatch="text-blue"]')).toHaveStyle({ color: 'var(--label-text-blue)' })

    const bg = await openSub('Background color')
    const bgItems = within(bg).getAllByRole('menuitem').map((m) => m.textContent!.trim())
    expect(bgItems[0]).toBe('Remove background color')
    expect(bgItems.slice(1)).toEqual(THEME_COLORS.map((c) => colorMenuName('bg', c)))
    expect(bgItems).toContain('Amber background')
    expect(bg.querySelector('[data-swatch="bg-teal"]')).toHaveStyle({ backgroundColor: 'var(--label-bg-teal)' })
  })

  test('colour items set and remove the block colour', async () => {
    const editor = headless('Hello world\n', 'Hello')
      let view = renderMenu(editor)
    await openSub('Color')
    fireEvent.click(within(await openSub('Background color')).getByRole('menuitem', { name: 'Blue background' }))
    expect(serializeBody(editor)).toBe('<!-- block: color=bg-blue -->\nHello world\n')
    view.unmount()

    // "Remove text color" leaves a background colour alone; "Remove background color" removes it.
    view = renderMenu(editor)
    await openSub('Color')
    fireEvent.click(within(await openSub('Text color')).getByRole('menuitem', { name: 'Remove text color' }))
    expect(serializeBody(editor)).toBe('<!-- block: color=bg-blue -->\nHello world\n')
    view.unmount()
    view = renderMenu(editor)
    await openSub('Color')
    fireEvent.click(within(await openSub('Background color')).getByRole('menuitem', { name: 'Remove background color' }))
    expect(serializeBody(editor)).toBe('Hello world\n')
    view.unmount()
  })

  test('hierarchy, list and quote menus apply to the current block', async () => {
    const editor = headless('Hello world\n\nAfter.\n', 'Hello')
      let view = renderMenu(editor)
    let menu = await openSub(/^Hierarchy/)
    // Capacities' order: Standard, Small, Heading 1–4.
    expect(within(menu).getAllByRole('menuitem').map(label)).toEqual([
      'Standard',
      'Small',
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Heading 4',
    ])
    view.unmount()

    await pick(/^Hierarchy/, 'Heading 2', editor)
    expect(serializeBody(editor)).toBe('## Hello world\n\nAfter.\n')
    expect(currentBlockStyle(editor).hierarchy).toBe('H2')
    view = renderMenu(editor)
    expect(screen.getByRole('menuitem', { name: /^Hierarchy/ })).toHaveTextContent('Hierarchy (Heading 2)')
    view.unmount()
    await pick(/^Hierarchy/, 'Small', editor)
    expect(serializeBody(editor)).toBe('<!-- block: small -->\nHello world\n\nAfter.\n')
    await pick(/^Hierarchy/, 'Standard', editor)
    expect(serializeBody(editor)).toBe('Hello world\n\nAfter.\n')

    view = renderMenu(editor)
    menu = await openSub('List')
    expect(within(menu).getAllByRole('menuitem').map(label)).toEqual([
      'No listing',
      'Bulleted',
      'Numbered',
      'Alphabetical',
      'Roman',
    ])
    view.unmount()
    await pick('List', 'Alphabetical', editor)
    expect(serializeBody(editor)).toBe('<!-- block: list=alphabetical -->\n1. Hello world\n\nAfter.\n')
    expect(currentBlockStyle(editor).list).toBe('alphabetical')
    await pick('List', 'Bulleted', editor)
    expect(serializeBody(editor)).toBe('- Hello world\n\nAfter.\n')
    await pick('List', 'No listing', editor)
    expect(serializeBody(editor)).toBe('Hello world\n\nAfter.\n')

    await click('Standout', editor)
    expect(serializeBody(editor)).toBe('<!-- block: quote=standout -->\n> Hello world\n\nAfter.\n')
    expect(currentBlockStyle(editor)).toMatchObject({ quote: true, standout: true })
    await click('Standout', editor)
    expect(serializeBody(editor)).toBe('> Hello world\n\nAfter.\n')
    await click('Quote', editor)
    expect(serializeBody(editor)).toBe('Hello world\n\nAfter.\n')

    // To-do and Toggle are toggles too.
    await click('To-do', editor)
    expect(serializeBody(editor)).toBe('- [ ] Hello world\n\nAfter.\n')
    await click('To-do', editor)
    expect(serializeBody(editor)).toBe('Hello world\n\nAfter.\n')
    await click('Toggle', editor)
    expect(serializeBody(editor)).toBe('<!-- toggle open -->\nHello world\n<!-- /toggle -->\n\nAfter.\n')
    editor.commands.setTextSelection(3) // into the toggle's line
    expect(currentBlockStyle(editor).toggle).toBe(true)
    await click('Toggle', editor)
    expect(serializeBody(editor)).toBe('Hello world\n\nAfter.\n')
  })

  test('icon menu opens the icon picker and sets the block icon', async () => {
    const editor = headless('Hello world\n', 'Hello')
      renderMenu(editor)
    const menu = await openSub('Icon')
    fireEvent.click(within(menu).getByRole('tab', { name: 'Emoji' }))
    const emoji = within(menu).getAllByRole('button').find((b) => b.textContent === '⭐')!
    fireEvent.click(emoji)
    expect(serializeBody(editor)).toBe('<!-- block: icon="⭐" -->\nHello world\n')
  })
  // Known issue 4: the menu acted only on the block at the cursor.
  describe('with a block selection', () => {
    const body = 'One\n\nTwo\n\nThree\n\nAfter.\n'
    function selectFirstThree(editor: TiptapEditor) {
      const doc = editor.state.doc
      const third = doc.child(0).nodeSize + doc.child(1).nodeSize
      selectBlocks(editor, 0, third)
      expect(blockSelectionRange(editor.state)?.blocks).toHaveLength(3)
    }

    test('hierarchy applies to every selected block and keeps the selection', async () => {
      const editor = headless(body)
      selectFirstThree(editor)
      await pick(/^Hierarchy/, 'Heading 2', editor)
      expect(serializeBody(editor)).toBe('## One\n\n## Two\n\n## Three\n\nAfter.\n')
      expect(blockSelectionRange(editor.state)?.blocks).toHaveLength(3)
      await pick(/^Hierarchy/, 'Small', editor)
      expect(serializeBody(editor)).toBe(
        '<!-- block: small -->\nOne\n\n<!-- block: small -->\nTwo\n\n<!-- block: small -->\nThree\n\nAfter.\n',
      )
      await pick(/^Hierarchy/, 'Standard', editor)
      expect(serializeBody(editor)).toBe(body)
    })

    test('colour applies to every selected block, and removal removes it from each', async () => {
      const editor = headless(body)
      selectFirstThree(editor)
      let view = renderMenu(editor)
      await openSub('Color')
      fireEvent.click(within(await openSub('Background color')).getByRole('menuitem', { name: 'Blue background' }))
      view.unmount()
      expect(serializeBody(editor)).toBe(
        '<!-- block: color=bg-blue -->\nOne\n\n<!-- block: color=bg-blue -->\nTwo\n\n<!-- block: color=bg-blue -->\nThree\n\nAfter.\n',
      )
      view = renderMenu(editor)
      await openSub('Color')
      fireEvent.click(within(await openSub('Background color')).getByRole('menuitem', { name: 'Remove background color' }))
      view.unmount()
      expect(serializeBody(editor)).toBe(body)
    })

    test('list turns the selected blocks into one list', async () => {
      const editor = headless(body)
      selectFirstThree(editor)
      await pick('List', 'Bulleted', editor)
      expect(serializeBody(editor)).toBe('- One\n- Two\n- Three\n\nAfter.\n')
    })

    test('quote and standout apply to every selected block', async () => {
      const editor = headless(body)
      selectFirstThree(editor)
      await click('Quote', editor)
      expect(serializeBody(editor)).toBe('> One\n\n> Two\n\n> Three\n\nAfter.\n')
      await click('Standout', editor)
      expect(serializeBody(editor)).toBe(
        '<!-- block: quote=standout -->\n> One\n\n<!-- block: quote=standout -->\n> Two\n\n<!-- block: quote=standout -->\n> Three\n\nAfter.\n',
      )
      await click('Standout', editor)
      expect(serializeBody(editor)).toBe('> One\n\n> Two\n\n> Three\n\nAfter.\n')
      await click('Quote', editor)
      expect(serializeBody(editor)).toBe(body)
    })

    test('icon applies to every selected block', async () => {
      const editor = headless(body)
      selectFirstThree(editor)
      renderMenu(editor)
      const menu = await openSub('Icon')
      fireEvent.click(within(menu).getByRole('tab', { name: 'Emoji' }))
      fireEvent.click(within(menu).getAllByRole('button').find((b) => b.textContent === '⭐')!)
      expect(serializeBody(editor)).toBe(
        '<!-- block: icon="⭐" -->\nOne\n\n<!-- block: icon="⭐" -->\nTwo\n\n<!-- block: icon="⭐" -->\nThree\n\nAfter.\n',
      )
    })
  })

  describe('M8: one list item and indent rows', () => {
    const LIST = '- Buy milk\n- Call Ada\n- Book trip\n'

    test('test block style menu styles one list item', async () => {
      const editor = headless(LIST, 'Call')
      const view = renderMenu(editor)
      await openSub('Color')
      const text = await openSub('Text color')
      fireEvent.click(within(text).getByRole('menuitem', { name: 'Red text' }))
      view.unmount()
      expect(serializeBody(editor)).toBe('- Buy milk\n- Call Ada <!-- item: color=text-red -->\n- Book trip\n')
      expect(currentBlockStyle(editor).color).toBe('text-red')

      await pick(/^Hierarchy/, 'Small', editor)
      expect(serializeBody(editor)).toBe('- Buy milk\n- Call Ada <!-- item: small color=text-red -->\n- Book trip\n')
      expect(currentBlockStyle(editor).hierarchy).toBe('S')

      // Removing the colour keeps the other option; Standard removes "small" and with it the comment.
      const v2 = renderMenu(editor)
      await openSub('Color')
      const t2 = await openSub('Text color')
      fireEvent.click(within(t2).getByRole('menuitem', { name: 'Remove text color' }))
      v2.unmount()
      expect(serializeBody(editor)).toBe('- Buy milk\n- Call Ada <!-- item: small -->\n- Book trip\n')
      await pick(/^Hierarchy/, 'Standard', editor)
      expect(serializeBody(editor)).toBe(LIST)
    })

    test('an item colour is drawn on its own list item', () => {
      const element = document.createElement('div')
      document.body.appendChild(element)
      const editor = new TiptapEditor({ element, extensions: editorExtensions() })
      editors.push(editor)
      loadBody(editor, '- Buy milk\n- Call Ada <!-- item: color=text-red icon="⭐" -->\n')
      const items = editor.view.dom.querySelectorAll('li')
      expect(items[0]).not.toHaveAttribute('data-item-color')
      expect(items[1]).toHaveAttribute('data-item-color', 'text-red')
      expect(items[1].getAttribute('style')).toContain('var(--label-text-red)')
      expect(items[1].querySelector('.item-icon')).toHaveTextContent('⭐')
      element.remove()
    })

    test('test indent rows', () => {
      const editor = headless('First\n\nSecond\n', 'Second')
      let view = renderMenu(editor)
      fireEvent.click(screen.getByRole('menuitem', { name: 'Indent' }))
      view.unmount()
      expect(serializeBody(editor)).toBe('<!-- indent -->\nFirst\n\nSecond\n<!-- /indent -->\n')
      view = renderMenu(editor)
      fireEvent.click(screen.getByRole('menuitem', { name: 'Unindent' }))
      view.unmount()
      expect(serializeBody(editor)).toBe('First\n\nSecond\n')

      // In a list, the item sinks and lifts.
      const list = headless('- One\n- Two\n', 'Two')
      view = renderMenu(list)
      fireEvent.click(screen.getByRole('menuitem', { name: 'Indent' }))
      view.unmount()
      expect(serializeBody(list)).toMatch(/^- One\n {2,4}- Two\n$/)
      view = renderMenu(list)
      fireEvent.click(screen.getByRole('menuitem', { name: 'Unindent' }))
      view.unmount()
      expect(serializeBody(list)).toBe('- One\n- Two\n')
    })

    test('indent rows act on a block selection of non-list blocks', () => {
      const editor = headless('First\n\nSecond\n\nThird\n', 'First')
      const positions: number[] = []
      editor.state.doc.forEach((_n, offset) => positions.push(offset))
      selectBlocks(editor, positions[1], positions[2])
      let view = renderMenu(editor)
      fireEvent.click(screen.getByRole('menuitem', { name: 'Indent' }))
      view.unmount()
      expect(serializeBody(editor)).toBe('<!-- indent -->\nFirst\n\nSecond\n\nThird\n<!-- /indent -->\n')
      view = renderMenu(editor)
      fireEvent.click(screen.getByRole('menuitem', { name: 'Unindent' }))
      view.unmount()
      // The caret ended in "Third": it moves out, one blank line after the close line.
      expect(serializeBody(editor)).toBe('<!-- indent -->\nFirst\n\nSecond\n<!-- /indent -->\n\nThird\n')
    })
  })
})
