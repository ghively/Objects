import type { Editor as TiptapEditor } from '@tiptap/core'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { StringEditor, stripFinalNewline } from './StringEditor'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function mount(value: string, props: Partial<Parameters<typeof StringEditor>[0]> = {}) {
  const onChange = vi.fn()
  let editor: TiptapEditor | null = null
  const utils = render(<StringEditor value={value} onChange={onChange} editorRef={(e) => (editor = e)} {...props} />)
  const dom = await waitFor(() => {
    const el = utils.container.querySelector('.ProseMirror') as HTMLElement | null
    expect(el).toBeTruthy()
    expect(editor).toBeTruthy()
    return el!
  })
  return { onChange, dom, editor: editor! as TiptapEditor, ...utils }
}

const RICH = [
  '## Heading',
  '',
  '- one',
  '- two with [[Router A|the router]]',
  '',
  '<!-- block: quote=standout -->',
  '> A callout.',
  '',
  '<!-- group color=bg-gray -->',
  'Box heading',
  'Body of the box.',
  '<!-- /group -->',
  '',
  'See [[Runbook]] and **this**.',
].join('\n')

describe('StringEditor', () => {
  test('test no-edit blur writes nothing', async () => {
    const { onChange, dom } = await mount(RICH)
    act(() => {
      fireEvent.focus(dom)
      fireEvent.blur(dom)
    })
    expect(onChange).not.toHaveBeenCalled()
  })

  test('test value round trips byte for byte', async () => {
    const { editor, onChange, unmount } = await mount(RICH)
    // An edit and its undo: the reported text equals the original, so nothing is written.
    act(() => {
      editor.commands.focus('end')
      editor.commands.insertContent('x')
    })
    act(() => {
      editor.commands.undo()
    })
    unmount()
    expect(onChange).not.toHaveBeenCalled()
    const { editor: e2, onChange: c2 } = await mount(RICH)
    act(() => {
      e2.commands.focus('end')
      e2.commands.insertContent('!')
    })
    act(() => {
      e2.commands.blur()
      fireEvent.blur(e2.view.dom)
    })
    // Only the edited last block changes; every other block keeps its bytes.
    expect(c2).toHaveBeenCalledWith(RICH + '!')
  })

  test('test edit saves serialized markdown after debounce and on blur', async () => {
    const { editor, onChange, dom } = await mount('Hello')
    vi.useFakeTimers()
    act(() => {
      editor.commands.focus('end')
      editor.commands.insertContent([{ type: 'text', text: ' ' }, { type: 'text', text: 'world', marks: [{ type: 'bold' }] }])
    })
    expect(onChange).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith('Hello **world**')
    act(() => {
      editor.commands.insertContent('!')
    })
    act(() => {
      fireEvent.blur(dom)
    })
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenLastCalledWith('Hello **world!**')
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  test('single paragraph: Enter calls onEnter and does not split', async () => {
    const onEnter = vi.fn()
    const { editor, dom } = await mount('One', { singleParagraph: true, onEnter })
    act(() => {
      editor.commands.focus('end')
    })
    act(() => {
      fireEvent.keyDown(dom, { key: 'Enter' })
    })
    expect(onEnter).toHaveBeenCalledTimes(1)
    expect(editor.state.doc.childCount).toBe(1)
  })

  test('strips one trailing newline', () => {
    expect(stripFinalNewline('a\n\n')).toBe('a\n')
    expect(stripFinalNewline('a\r\n')).toBe('a')
    expect(stripFinalNewline('a')).toBe('a')
  })
})
