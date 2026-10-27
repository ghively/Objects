import { Editor as TiptapEditor } from '@tiptap/core'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { THEME_COLORS } from '@/theme/palette'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { BlockStyleMenu, currentBlockStyle } from './BlockStyleMenu'
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
      </DropdownMenuContent>
    </DropdownMenu>,
  )
}

// Plain clicks throughout: a pointer path between Radix sub-menus closes them in jsdom.
async function openSub(name: string): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('menuitem', { name }))
  const trigger = screen.getByRole('menuitem', { name })
  const id = trigger.getAttribute('aria-controls')!
  return await screen.findByRole('menu', { name: (_, el) => el.id === id })
}

async function pick(sub: string, item: string, editor: TiptapEditor) {
  const view = renderMenu(editor)
  const menu = await openSub(sub)
  fireEvent.click(within(menu).getByRole('menuitem', { name: item }))
  view.unmount()
}

describe('BlockStyleMenu', () => {
  test('lists the five sub-menus with reference names', () => {
    renderMenu(headless('Hello world\n', 'Hello'))
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Hierarchy', 'List', 'Quote', 'Color', 'Icon'])
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
    let menu = await openSub('Hierarchy')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Standard',
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Heading 4',
      'Small',
    ])
    view.unmount()

    await pick('Hierarchy', 'Heading 2', editor)
    expect(serializeBody(editor)).toBe('## Hello world\n\nAfter.\n')
    expect(currentBlockStyle(editor).hierarchy).toBe('H2')
    await pick('Hierarchy', 'Small', editor)
    expect(serializeBody(editor)).toBe('<!-- block: small -->\nHello world\n\nAfter.\n')
    await pick('Hierarchy', 'Standard', editor)
    expect(serializeBody(editor)).toBe('Hello world\n\nAfter.\n')

    view = renderMenu(editor)
    menu = await openSub('List')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
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

    view = renderMenu(editor)
    menu = await openSub('Quote')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Quote block', 'Standout'])
    view.unmount()
    await pick('Quote', 'Standout', editor)
    expect(serializeBody(editor)).toBe('<!-- block: quote=standout -->\n> Hello world\n\nAfter.\n')
    expect(currentBlockStyle(editor)).toMatchObject({ quote: true, standout: true })
    await pick('Quote', 'Standout', editor)
    expect(serializeBody(editor)).toBe('> Hello world\n\nAfter.\n')
    await pick('Quote', 'Quote block', editor)
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
})
