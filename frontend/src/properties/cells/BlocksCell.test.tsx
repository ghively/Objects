import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { PropertyDef } from '@/api/types'
import { typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { openSlashMenu, useSlashMenu } from '@/editor/extensions/slashMenu'
import { useLinkIndex } from '@/links/linkIndex'
import { BlocksCell } from './BlocksCell'

type TiptapDom = HTMLElement & { editor?: import('@tiptap/core').Editor }

const def: PropertyDef = {
  id: 'p1',
  key: 'p1',
  name: 'Notes',
  type: 'blocks',
  description: '',
  icon: null,
  visibility: 'alwaysShow',
  options: {},
}

beforeEach(() => {
  useLinkIndex.setState({ types: [typeDef({ id: 'page', name: 'Page', basic: true })] })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useSlashMenu.setState({ editor: null, range: null, query: '', rect: null, sub: null })
})

async function mount(value: string | null) {
  const onChange = vi.fn()
  const utils = render(<BlocksCell def={def} value={value} onChange={onChange} />)
  const dom = await waitFor(() => {
    const el = utils.container.querySelector('.ProseMirror') as TiptapDom | null
    expect(el?.editor).toBeTruthy()
    return el!
  })
  return { onChange, dom, editor: dom.editor!, ...utils }
}

describe('BlocksCell', () => {
  test('test no-edit blur writes nothing', async () => {
    const { onChange, dom } = await mount('# Title\n\n- [ ] task\n- [[Alpha]]')
    act(() => {
      fireEvent.focus(dom)
      fireEvent.blur(dom)
    })
    expect(onChange).not.toHaveBeenCalled()
  })

  test('test value round trips byte for byte', async () => {
    const md = '# Title\n\n<!-- block: color=bg-blue -->\nColoured.\n\n1. one\n2. two [[Alpha|A]]\n\nTail'
    const { onChange, editor, dom } = await mount(md)
    act(() => {
      editor.commands.focus('end')
      editor.commands.insertContent('!')
    })
    act(() => {
      fireEvent.blur(dom)
    })
    expect(onChange).toHaveBeenCalledWith(md + '!')
  })

  test('test edit saves serialized markdown after debounce and on blur', async () => {
    const { onChange, editor } = await mount(null)
    vi.useFakeTimers()
    act(() => {
      editor.commands.focus('end')
      editor.commands.insertContent([{ type: 'text', text: 'Some ' }, { type: 'text', text: 'text', marks: [{ type: 'italic' }] }])
    })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(onChange).toHaveBeenCalledWith('Some *text*')
  })

  test('test empty saves null', async () => {
    const { onChange, editor, dom } = await mount('Gone')
    act(() => {
      editor.commands.focus('end')
      editor.commands.clearContent(true)
    })
    act(() => {
      fireEvent.blur(dom)
    })
    expect(onChange).toHaveBeenCalledWith(null)
  })

  test('test slash menu opens inside the cell', async () => {
    const { editor } = await mount('Hello')
    act(() => {
      editor.commands.focus('end')
      openSlashMenu(editor)
    })
    expect(await screen.findByRole('listbox', { name: '/' })).toBeInTheDocument()
  })

  test('shows the placeholder when empty', async () => {
    const { container } = await mount(null)
    expect(container.querySelector('[data-placeholder]')).toBeTruthy()
  })
})
