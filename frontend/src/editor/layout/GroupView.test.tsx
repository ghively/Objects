import { Editor as TiptapEditor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from '../document'

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

function groupPos(editor: TiptapEditor): number {
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.type.name === 'group') at = pos
    return at < 0
  })
  return at
}

const BODY = ['Intro', '', '<!-- group color=bg-blue align=center -->', 'Box heading', '', 'Body of the box.', '<!-- /group -->', '', 'Outro', ''].join('\n')

describe('GroupView', () => {
  test('group renders colour and placeholder; ungroup keeps children', async () => {
    const user = userEvent.setup()
    const editor = await mount(BODY)
    const box = editor.view.dom.querySelector<HTMLElement>('.block-group')!
    expect(box).toHaveAttribute('data-block-color', 'bg-blue')
    expect(box).toHaveAttribute('data-block-align', 'center')
    expect(box.style.backgroundColor).toBe('var(--label-bg-blue)')
    expect(box.textContent).toContain('Box heading')
    expect(box.querySelector('[data-placeholder]')).toBeNull()

    // An empty first child shows "Box heading...".
    const first = groupPos(editor) + 1
    const heading = editor.state.doc.nodeAt(first)!
    await act(async () => {
      editor.chain().deleteRange({ from: first + 1, to: first + 1 + heading.content.size }).run()
    })
    const placeholder = box.querySelector<HTMLElement>('[data-placeholder]')!
    expect(placeholder).toHaveAttribute('data-placeholder', 'Box heading...')
    expect(placeholder.tagName).toBe('P')
    await act(async () => {
      editor.chain().insertContentAt(first + 1, 'Box heading').run()
    })
    expect(box.querySelector('[data-placeholder]')).toBeNull()
    expect(serializeBody(editor)).toBe(BODY)

    // "Ungroup": the box goes, its blocks stay, byte for byte.
    await user.click(screen.getByRole('button', { name: 'Ungroup' }))
    expect(groupPos(editor)).toBe(-1)
    expect(serializeBody(editor)).toBe(['Intro', '', 'Box heading', '', 'Body of the box.', '', 'Outro', ''].join('\n'))
    await waitFor(() => expect(editor.view.dom.querySelector('.block-group')).toBeNull())
  })

  test('ungrouping a CRLF document keeps CRLF and the blank line after the group', async () => {
    const crlf = BODY.replace(/\n/g, '\r\n')
    const editor = await mount(crlf)
    await act(async () => {
      editor.chain().setTextSelection(groupPos(editor) + 2).unwrapGroup().run()
    })
    expect(serializeBody(editor)).toBe(['Intro', '', 'Box heading', '', 'Body of the box.', '', 'Outro', ''].join('\r\n'))
  })

  test('a group without a colour uses the neutral fill', async () => {
    const editor = await mount('<!-- group -->\nInside\n<!-- /group -->\n')
    const box = editor.view.dom.querySelector<HTMLElement>('.block-group')!
    expect(box).not.toHaveAttribute('data-block-color')
    expect(box.getAttribute('style') ?? '').not.toContain('background')
  })

  test('toggleGroup groups the selected block and ungroups it again', async () => {
    const editor = await mount('Alpha\n\nBeta\n')
    await act(async () => {
      editor.chain().setTextSelection(2).toggleGroup().run()
    })
    expect(serializeBody(editor)).toBe('<!-- group -->\nAlpha\n<!-- /group -->\n\nBeta\n')
    await act(async () => {
      editor.chain().setTextSelection(groupPos(editor) + 2).toggleGroup().run()
    })
    expect(serializeBody(editor)).toBe('Alpha\n\nBeta\n')
  })
})
