import { Editor as TiptapEditor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { touchesLockedCode } from '../nodes/codeBlock'

vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg data-x="1"></svg>' })) },
}))

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

function codePos(editor: TiptapEditor): number {
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.type.name === 'codeBlock') at = pos
  })
  return at
}

const BODY = 'Intro\n\n```js\nconst a = 1\n```\n\nOutro\n'

describe('CodeBlockView', () => {
  test('language picker, wrap and lock write their options', async () => {
    const editor = await mount(BODY)
    expect(screen.getByRole('button', { name: 'Select language' })).toHaveTextContent('JavaScript')

    fireEvent.click(screen.getByRole('button', { name: 'Select language' }))
    fireEvent.change(await screen.findByPlaceholderText('Select language'), { target: { value: 'pyth' } })
    fireEvent.click(screen.getByRole('option', { name: 'Python' }))
    expect(serializeBody(editor)).toBe('Intro\n\n```python\nconst a = 1\n```\n\nOutro\n')

    fireEvent.click(screen.getByRole('button', { name: 'Wrap lines' }))
    expect(serializeBody(editor)).toBe('Intro\n\n<!-- block: wrap -->\n```python\nconst a = 1\n```\n\nOutro\n')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Wrap lines' })).toHaveAttribute('aria-pressed', 'true'))

    fireEvent.click(screen.getByRole('button', { name: 'Lock editing' }))
    expect(serializeBody(editor)).toBe('Intro\n\n<!-- block: wrap lock -->\n```python\nconst a = 1\n```\n\nOutro\n')
    await waitFor(() => expect(document.querySelector('.code-block code')).toHaveAttribute('contenteditable', 'false'))

    // Locked: typing inside the code is refused, the rest of the page still edits.
    const pos = codePos(editor)
    const before = serializeBody(editor)
    editor.chain().insertContentAt(pos + 3, 'X').run()
    expect(serializeBody(editor)).toBe(before)
    editor.chain().insertContentAt(2, 'Y').run()
    expect(serializeBody(editor)).toContain('IYntro')

    // Unlock and unwrap: the annotation line goes, the code edits again.
    fireEvent.click(screen.getByRole('button', { name: 'Lock editing' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lock editing' })).toHaveAttribute('aria-pressed', 'false'))
    fireEvent.click(screen.getByRole('button', { name: 'Wrap lines' }))
    expect(serializeBody(editor)).toBe('IYntro\n\n```python\nconst a = 1\n```\n\nOutro\n')
    editor.chain().insertContentAt(codePos(editor) + 1, '#').run()
    expect(serializeBody(editor)).toContain('```python\n#const a = 1\n```')
  })

  test('picking plain text writes a bare fence', async () => {
    const editor = await mount(BODY)
    fireEvent.click(screen.getByRole('button', { name: 'Select language' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Plain text' }))
    expect(serializeBody(editor)).toBe('Intro\n\n```\nconst a = 1\n```\n\nOutro\n')
  })

  test('lock guard allows option changes and whole-block deletes', async () => {
    const editor = await mount('```\nx\n```\n\nAfter\n')
    editor.commands.setBlockOption('lock', true, 0)
    const state = editor.state
    const setAttr = state.tr.setNodeAttribute(0, 'language', 'go')
    expect(touchesLockedCode(setAttr, state)).toBe(false)
    const del = state.tr.delete(0, state.doc.child(0).nodeSize)
    expect(touchesLockedCode(del, state)).toBe(false)
    const inside = state.tr.insertText('z', 1)
    expect(touchesLockedCode(inside, state)).toBe(true)
  })

  describe('copy and download', () => {
    const createObjectURL = vi.fn(() => 'blob:snippet')
    const revokeObjectURL = vi.fn()
    beforeEach(() => {
      Object.assign(URL, { createObjectURL, revokeObjectURL })
      createObjectURL.mockClear()
    })

    test('copy and download use the code text', async () => {
      const writeText = vi.fn(async () => {})
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
      await mount('```python\nprint("hi")\nprint(2)\n```\n')

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }))
      })
      expect(writeText).toHaveBeenCalledWith('print("hi")\nprint(2)')

      const clicks: HTMLAnchorElement[] = []
      const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push(this)
      })
      fireEvent.click(screen.getByRole('button', { name: 'Download as file' }))
      spy.mockRestore()
      expect(clicks).toHaveLength(1)
      expect(clicks[0].download).toBe('snippet.py')
      const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0]
      expect(await blob.text()).toBe('print("hi")\nprint(2)')
    })
  })

  test('preview modes for markdown and mermaid write preview and default to display', async () => {
    const body = '```markdown\n# Title\n```\n\n```mermaid\ngraph TD\n```\n\n```js\nx\n```\n'
    const editor = await mount(body)
    const blocks = Array.from(document.querySelectorAll('.code-block'))
    expect(blocks.map((b) => b.getAttribute('data-preview'))).toEqual(['display', 'display', null])
    // Only the two preview languages get the segmented control.
    expect(screen.getAllByRole('group', { name: 'Preview' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Display' })[0]).toHaveAttribute('aria-pressed', 'true')

    // Clicking the active mode writes nothing.
    fireEvent.click(screen.getAllByRole('button', { name: 'Display' })[0])
    expect(serializeBody(editor)).toBe(body)

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit & Display' })[0])
    expect(serializeBody(editor)).toBe(`<!-- block: preview=split -->\n${body}`)
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1])
    expect(serializeBody(editor)).toBe(
      '<!-- block: preview=split -->\n```markdown\n# Title\n```\n\n<!-- block: preview=edit -->\n```mermaid\ngraph TD\n```\n\n```js\nx\n```\n',
    )
    await waitFor(() => {
      const modes = Array.from(document.querySelectorAll('.code-block')).map((b) => b.getAttribute('data-preview'))
      expect(modes).toEqual(['split', 'edit', null])
    })
    // Split shows the source and the preview; edit shows no preview.
    expect(blocks[0].querySelector('.code-block-preview')).not.toBeNull()
    expect(document.querySelectorAll('.code-block')[1].querySelector('.code-block-preview')).toBeNull()
  })

  test('markdown preview shows raw html as text', async () => {
    await mount('```markdown\n# Heading\n\n<div class="evil"><script>window.__x = 1</script>boom</div>\n\nPlain *text*\n```\n')
    const preview = await screen.findByTestId('markdown-preview')
    await waitFor(() => expect(preview.querySelector('h1')).toHaveTextContent('Heading'))
    expect(preview.querySelector('div.evil')).toBeNull()
    expect(preview.querySelector('script')).toBeNull()
    expect(preview.textContent).toContain('<div class="evil"><script>window.__x = 1</script>boom</div>')
    expect(preview.querySelector('em')).toHaveTextContent('text')
    expect((window as unknown as { __x?: number }).__x).toBeUndefined()
    expect(preview.querySelector('[contenteditable="true"]')).toBeNull()
  })
})
