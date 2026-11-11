import type { Editor as TiptapEditor } from '@tiptap/core'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { PropertyDef } from '@/api/types'
import { objectSummary } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { installLinkPicker, LinkPicker, useLinkPicker } from '@/links/LinkPicker'
import { resetLinkIndex } from '@/links/linkIndex'
import { usePeek } from '@/nav/tabs'
import { TextBlockCell } from './TextBlockCell'

const mocked = vi.mocked(api)
type TiptapDom = HTMLElement & { editor?: TiptapEditor }

const def: PropertyDef = {
  id: 'p1',
  key: 'p1',
  name: 'Summary',
  type: 'textBlock',
  description: '',
  icon: null,
  visibility: 'alwaysShow',
  options: {},
}

const ADA = objectSummary({ path: 'People/Ada Lovelace.md', type: 'page', title: 'Ada Lovelace' })

beforeEach(() => {
  resetLinkIndex()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [] })
  mocked.objects.mockResolvedValue([ADA])
  mocked.resolve.mockImplementation(async (link: string) => (link === 'Ada Lovelace' ? ADA.path : null))
  installLinkPicker()
})
afterEach(() => {
  cleanup()
  useLinkPicker.getState().hide()
  usePeek.getState().close()
})

async function startEditing(value: string | null) {
  const onChange = vi.fn()
  const utils = render(
    <>
      <TextBlockCell def={def} value={value} onChange={onChange} />
      <LinkPicker />
    </>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Edit Summary' }))
  const dom = await waitFor(() => {
    const el = utils.container.querySelector('.ProseMirror') as TiptapDom | null
    expect(el?.editor).toBeTruthy()
    return el!
  })
  return { onChange, dom, editor: dom.editor!, ...utils }
}

function press(dom: HTMLElement, key: string) {
  act(() => {
    fireEvent.keyDown(dom, { key })
  })
}

describe('TextBlockCell (M9)', () => {
  test('test wikilink renders as chip and opens', async () => {
    const onChange = vi.fn()
    const { container } = render(<TextBlockCell def={def} value="Met [[Ada Lovelace|Ada]] today" onChange={onChange} />)
    const chip = container.querySelector('[data-wikilink]') as HTMLElement
    expect(chip).toHaveTextContent('Ada')
    expect(chip.getAttribute('data-target')).toBe('Ada Lovelace')
    await waitFor(() => expect(chip.getAttribute('data-resolved-path')).toBe(ADA.path))
    fireEvent.click(chip)
    expect(usePeek.getState().path).toBe(ADA.path)
    // Following the link does not open the editor.
    expect(container.querySelector('.ProseMirror')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  test('test typing [[ opens picker and inserts link', async () => {
    const { onChange, dom, editor } = await startEditing('See ')
    const view = editor.view
    act(() => {
      editor.commands.focus('end')
      const end = editor.state.selection.from
      editor.commands.insertContentAt(end, '[')
      const at = end + 1
      view.someProp('handleTextInput', (f) => f(view, at, at, '[', () => view.state.tr))
      editor.commands.insertContentAt(at, '[')
    })
    const input = await screen.findByRole('textbox', { name: 'Search notes' })
    // The picker taking focus does not end the edit.
    act(() => {
      fireEvent.blur(dom, { relatedTarget: input })
    })
    expect(document.querySelector('.ProseMirror')).toBeTruthy()
    await screen.findByRole('listbox', { name: 'Notes' })
    fireEvent.change(input, { target: { value: 'ada' } })
    await screen.findByText('Ada Lovelace')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(useLinkPicker.getState().range).toBeNull())
    press(dom, 'Enter')
    expect(onChange).toHaveBeenLastCalledWith('See [[Ada Lovelace]]')
  })

  test('text typed after [[ before the picker takes focus goes to the picker, not the cell', async () => {
    const { onChange, dom, editor } = await startEditing('See ')
    const view = editor.view
    act(() => {
      editor.commands.focus('end')
      const end = editor.state.selection.from
      editor.commands.insertContentAt(end, '[')
      const at = end + 1
      view.someProp('handleTextInput', (f) => f(view, at, at, '[', () => view.state.tr))
      editor.commands.insertContentAt(at, '[')
      // A fast typist: "Ada" lands in the cell before the trigger hands over to the picker.
      editor.commands.insertContent('Ada')
    })
    const input = (await screen.findByRole('textbox', { name: 'Search notes' })) as HTMLInputElement
    await waitFor(() => expect(input.value).toBe('Ada'))
    act(() => {
      fireEvent.blur(dom, { relatedTarget: input })
    })
    await screen.findByText('Ada Lovelace')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(useLinkPicker.getState().range).toBeNull())
    press(dom, 'Enter')
    expect(onChange).toHaveBeenLastCalledWith('See [[Ada Lovelace]]')
  })

  test('test enter commits single paragraph', async () => {
    const { onChange, dom, editor } = await startEditing('One')
    act(() => {
      editor.commands.focus('end')
      editor.commands.insertContent(' two')
    })
    press(dom, 'Enter')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('One two')
    await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeNull())
  })

  test('test bold and link round trip', async () => {
    const value = 'A **bold** word, [[Ada Lovelace|Ada]] and [site](https://example.com) here'
    const { onChange, dom, editor } = await startEditing(value)
    act(() => {
      editor.commands.focus('end')
      editor.commands.insertContent('!')
    })
    press(dom, 'Enter')
    expect(onChange).toHaveBeenCalledWith(value + '!')
  })

  test('test unchanged value not rewritten', async () => {
    const { onChange, dom } = await startEditing('Plain *em* [[Ada Lovelace]]')
    press(dom, 'Enter')
    await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Edit Summary' }))
    const again = await waitFor(() => document.querySelector('.ProseMirror') as HTMLElement)
    press(again, 'Escape')
    expect(onChange).not.toHaveBeenCalled()
  })

  test('empty text saves null', async () => {
    const { onChange, dom, editor } = await startEditing('Gone')
    act(() => {
      editor.commands.clearContent(true)
    })
    press(dom, 'Enter')
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
