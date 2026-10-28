import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { MarkdownView, TextBlockEditor, wikilinkText } from './TextBlockEditor'

type TiptapDom = HTMLElement & { editor?: { commands: { focus(p: string): void; insertContent(s: string): void } } }

async function mount(markdown: string) {
  const onCommit = vi.fn()
  const utils = render(<TextBlockEditor markdown={markdown} onCommit={onCommit} />)
  const dom = await waitFor(() => {
    const el = utils.container.querySelector('.ProseMirror') as TiptapDom | null
    expect(el).toBeTruthy()
    return el!
  })
  return { onCommit, dom, ...utils }
}

describe('TextBlockEditor', () => {
  test('unedited Markdown with a wikilink commits byte for byte, once', async () => {
    const md = 'See [[Router A|the router]] and **this**.\n\n- one\n- two'
    const { onCommit, dom } = await mount(md)
    expect(dom.closest('[data-whiteboard-editing]')).toHaveClass('nodrag')
    act(() => {
      fireEvent.blur(dom)
      fireEvent.focusOut(dom)
      fireEvent.keyDown(dom, { key: 'Escape' })
    })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(md)
  })

  test('typed text commits as Markdown on Escape', async () => {
    const { onCommit, dom } = await mount('')
    act(() => {
      dom.editor!.commands.focus('end')
      dom.editor!.commands.insertContent('Hello')
    })
    act(() => {
      fireEvent.keyDown(dom, { key: 'Escape' })
    })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('Hello')
  })

  test('keys typed in the editor do not reach the canvas', async () => {
    const onKey = vi.fn()
    const utils = render(
      <div onKeyDown={onKey}>
        <TextBlockEditor markdown="x" onCommit={() => {}} />
      </div>,
    )
    const dom = await waitFor(() => utils.container.querySelector('.ProseMirror') as HTMLElement)
    fireEvent.keyDown(dom, { key: 'Delete' })
    expect(onKey).not.toHaveBeenCalled()
  })
})

describe('MarkdownView', () => {
  test('renders headings, lists, marks and wikilinks as elements (never HTML)', () => {
    const { container } = render(
      <MarkdownView markdown={'# Title\n\nSome *em* and `code` [[Note#Part]] <b>raw</b>\n- [x] done'} align="right" />,
    )
    const root = container.querySelector('[data-whiteboard-text]') as HTMLElement
    expect(root.style.textAlign).toBe('right')
    expect(root).toHaveTextContent('Title')
    expect(root.querySelector('em')).toHaveTextContent('em')
    expect(root.querySelector('code')).toHaveTextContent('code')
    expect(root.querySelector('[data-wikilink]')).toHaveTextContent('Note')
    expect(root.querySelector('b')).toBeNull()
    expect(root).toHaveTextContent('<b>raw</b>')
    expect(root).toHaveTextContent('☑')
  })

  test('wikilink text is the alias, else the target', () => {
    expect(wikilinkText('[[Router A]]')).toBe('Router A')
    expect(wikilinkText('[[Router A|Edge]]')).toBe('Edge')
    expect(wikilinkText('[[Router A#Ports]]')).toBe('Router A')
  })
})
