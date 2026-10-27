import { Editor as TiptapEditor } from '@tiptap/core'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ConflictError } from '@/api/client'
import { Editor } from './Editor'
import { editorExtensions, loadBody, serializeBody } from './document'
import { RawMode } from './RawMode'
import { AUTOSAVE_RETRY_MS, type BodyEditorHandle } from './useAutosave'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
const saveBody = vi.mocked(api).saveBody

const fixtures = import.meta.glob('./__fixtures__/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const BODY = [
  '# Notes',
  '',
  'First paragraph.',
  '',
  'Second paragraph with *emphasis* and [[Ada Lovelace]].',
  '',
  'Third paragraph.',
  '',
  'Status:: Active',
  'Owner:: [[Ada Lovelace|Ada]]',
  '',
  '* one',
  '    * nested',
  '',
  '|Host|Role|',
  '|:---|---:|',
  '|alpha|db|',
  '',
  '<div class="x">html</div>',
  '',
  '```mermaid',
  'graph TD',
  '```',
  '',
  'Last paragraph.',
  '',
].join('\n')

function headless(body: string): TiptapEditor {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  loadBody(editor, body)
  return editor
}

/** Position at the end of the text of the n-th (0-based) top-level node of `type`. */
function endOfNth(editor: TiptapEditor, type: string, n: number): number {
  let seen = 0
  let pos = -1
  editor.state.doc.forEach((node, offset) => {
    if (pos >= 0 || node.type.name !== type) return
    if (seen++ === n) pos = offset + node.nodeSize - 1
  })
  if (pos < 0) throw new Error(`no ${type} #${n}`)
  return pos
}

function changedLines(a: string, b: string): number[] {
  const la = a.split('\n')
  const lb = b.split('\n')
  expect(lb.length).toBe(la.length)
  return la.flatMap((line, i) => (line === lb[i] ? [] : [i]))
}

function pmEditor(container: HTMLElement): TiptapEditor {
  const dom = container.querySelector('.ProseMirror') as (HTMLElement & { editor?: TiptapEditor }) | null
  if (!dom?.editor) throw new Error('editor not mounted')
  return dom.editor
}

describe('document model', () => {
  test('load then serialize without edits returns original body', () => {
    for (const [name, body] of Object.entries({ BODY, ...fixtures })) {
      const editor = headless(body)
      expect(serializeBody(editor), name).toBe(body)
      editor.destroy()
    }
    for (const body of ['', '\n', 'no newline', '\n\nlead\n\n\n', 'a\r\n\r\nb\r\n']) {
      const editor = headless(body)
      expect(serializeBody(editor)).toBe(body)
      editor.destroy()
    }
  })

  test('typing in paragraph 3 only changes paragraph 3', () => {
    const editor = headless(BODY)
    // paragraphs: 0 First, 1 Second, 2 Third
    editor.commands.insertContentAt(endOfNth(editor, 'paragraph', 2), ' Edited')
    const out = serializeBody(editor)
    const lines = changedLines(BODY, out)
    expect(lines).toEqual([6])
    expect(out.split('\n')[6]).toBe('Third paragraph. Edited')
    editor.destroy()
  })

  test('typing in a CRLF body keeps CRLF on every line', () => {
    const crlf = BODY.replace(/\n/g, '\r\n')
    const editor = headless(crlf)
    editor.commands.insertContentAt(endOfNth(editor, 'paragraph', 0), '!')
    const out = serializeBody(editor)
    expect(out.replace(/\r\n/g, '')).not.toContain('\n')
    expect(changedLines(crlf.replace(/\r\n/g, '\n'), out.replace(/\r\n/g, '\n'))).toEqual([2])
    editor.destroy()
  })

  test('Field:: line survives untouched', () => {
    const editor = headless(BODY)
    const types: string[] = []
    editor.state.doc.forEach((n) => types.push(n.type.name))
    expect(types).toContain('rawBlock')
    // The Field:: block, the HTML and the Mermaid block are raw blocks.
    expect(types.filter((t) => t === 'rawBlock')).toHaveLength(3)
    // Edit every other paragraph: the Field:: lines stay byte-identical.
    for (let i = 0; i < 3; i++) editor.commands.insertContentAt(endOfNth(editor, 'paragraph', i), ' x')
    const out = serializeBody(editor)
    expect(out).toContain('Status:: Active\nOwner:: [[Ada Lovelace|Ada]]\n')
    editor.destroy()
  })

  test('editing a field line in its raw block rewrites only that line', () => {
    const editor = headless(BODY)
    editor.commands.insertContentAt(endOfNth(editor, 'rawBlock', 0) - 'Owner:: [[Ada Lovelace|Ada]]'.length - 1, '!')
    const out = serializeBody(editor)
    expect(changedLines(BODY, out)).toEqual([8])
    expect(out.split('\n')[8]).toBe('Status:: Active!')
    editor.destroy()
  })

  test('fixture blocks are mostly modelled, not raw', () => {
    const editor = headless(fixtures['./__fixtures__/mixed.md'])
    const types: string[] = []
    editor.state.doc.forEach((n) => types.push(n.type.name))
    for (const t of ['heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'table', 'horizontalRule', 'paragraph'])
      expect(types, t).toContain(t)
    editor.destroy()
  })

  test('editing a table cell and a list item rewrites only those lines', () => {
    const editor = headless(BODY)
    let cellPos = -1
    editor.state.doc.descendants((n, pos) => {
      if (cellPos < 0 && n.isText && n.text === 'alpha') cellPos = pos + n.nodeSize
    })
    editor.commands.insertContentAt(cellPos, '2')
    let itemPos = -1
    editor.state.doc.descendants((n, pos) => {
      if (itemPos < 0 && n.isText && n.text === 'nested') itemPos = pos + n.nodeSize
    })
    editor.commands.insertContentAt(itemPos, '!')
    const out = serializeBody(editor)
    expect(changedLines(BODY, out)).toEqual([12, 16])
    expect(out.split('\n')[12]).toBe('    * nested!')
    expect(out.split('\n')[16]).toBe('|alpha2|db|')
    editor.destroy()
  })

  test('editing line 2 of a paragraph leaves line 1 untouched', () => {
    for (const body of ['_it_ first\nsecond\n', 'a * not em\nb\n']) {
      const editor = headless(body)
      editor.commands.insertContentAt(endOfNth(editor, 'paragraph', 0), 'Z')
      const out = serializeBody(editor)
      expect(out).toBe(body.replace(/\n$/, 'Z\n'))
      editor.destroy()
    }
  })

  test('editing an item of a loose list keeps its blank lines', () => {
    const cases: [string, string, string][] = [
      ['- a\n\n- b\n\n- c\n', 'b', '- a\n\n- bZ\n\n- c\n'],
      ['* one\n\n  para in item\n\n* two\n', 'two', '* one\n\n  para in item\n\n* twoZ\n'],
    ]
    for (const [body, text, expected] of cases) {
      const editor = headless(body)
      let pos = -1
      editor.state.doc.descendants((n, p) => {
        if (pos < 0 && n.isText && n.text === text) pos = p + n.nodeSize
      })
      editor.commands.insertContentAt(pos, 'Z')
      expect(serializeBody(editor)).toBe(expected)
      editor.destroy()
    }
  })

  test('wikilinks parse as inline atoms and round-trip', () => {
    const editor = headless('See [[Ada Lovelace]] and [[Alpha|the server]].\n')
    const links: { target: string; label: string | null }[] = []
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'wikilink') links.push(n.attrs as { target: string; label: string | null })
    })
    expect(links).toEqual([
      { target: 'Ada Lovelace', label: null },
      { target: 'Alpha', label: 'the server' },
    ])
    editor.commands.insertContentAt(1, 'X ')
    expect(serializeBody(editor)).toBe('X See [[Ada Lovelace]] and [[Alpha|the server]].\n')
    editor.destroy()
  })

  test('a new paragraph is separated by a blank line', () => {
    const editor = headless('# Title\nIntro\n')
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph', content: [{ type: 'text', text: 'New' }] })
    expect(serializeBody(editor)).toBe('# Title\nIntro\n\nNew')
    editor.destroy()
  })
})

describe('<Editor> autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    saveBody.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function mount(overrides: Partial<Parameters<typeof Editor>[0]> = {}) {
    const onSaved = vi.fn()
    const onConflict = vi.fn()
    const utils = render(
      <Editor
        path="Pages/Notes.md"
        body={BODY}
        version="v1"
        readOnly={false}
        onSaved={onSaved}
        onConflict={onConflict}
        {...overrides}
      />,
    )
    return { ...utils, onSaved, onConflict, editor: pmEditor(utils.container) }
  }

  test('autosave debounced 1000ms calls saveBody once', async () => {
    saveBody.mockResolvedValue({ version: 'v2' })
    const { editor, onSaved } = mount()
    act(() => {
      editor.commands.insertContentAt(endOfNth(editor, 'paragraph', 0), ' a')
    })
    await act(async () => vi.advanceTimersByTimeAsync(500))
    act(() => {
      editor.commands.insertContentAt(endOfNth(editor, 'paragraph', 0), 'b')
    })
    await act(async () => vi.advanceTimersByTimeAsync(999))
    expect(saveBody).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(saveBody).toHaveBeenCalledTimes(1)
    const expected = BODY.replace('First paragraph.', 'First paragraph. ab')
    expect(saveBody).toHaveBeenCalledWith('Pages/Notes.md', expected, 'v1')
    expect(onSaved).toHaveBeenCalledWith('v2')

    // The next save is based on the new version.
    act(() => {
      editor.commands.insertContentAt(endOfNth(editor, 'paragraph', 0), 'c')
    })
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(saveBody).toHaveBeenCalledTimes(2)
    expect(saveBody.mock.calls[1][2]).toBe('v2')
  })

  test('no save when content unchanged', async () => {
    saveBody.mockResolvedValue({ version: 'v2' })
    const { editor } = mount()
    // Type then delete: the document is back to the original.
    const pos = endOfNth(editor, 'paragraph', 1)
    act(() => {
      editor.commands.insertContentAt(pos, 'zz')
    })
    act(() => {
      editor.commands.deleteRange({ from: pos, to: pos + 2 })
    })
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    act(() => {
      editor.commands.blur()
      editor.view.dom.dispatchEvent(new FocusEvent('blur'))
    })
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(saveBody).not.toHaveBeenCalled()
  })

  test('read-only editor never saves', async () => {
    const { editor } = mount({ readOnly: true })
    expect(editor.isEditable).toBe(false)
    act(() => {
      editor.commands.insertContentAt(1, 'x')
    })
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(saveBody).not.toHaveBeenCalled()
  })

  test('flush() resolves only after the save in flight and the one queued behind it', async () => {
    const resolvers: ((v: { version: string }) => void)[] = []
    saveBody.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)))
    const ref = { current: null as BodyEditorHandle | null }
    const { editor, onSaved } = mount({ controlRef: ref })
    act(() => {
      editor.commands.insertContentAt(endOfNth(editor, 'paragraph', 0), ' a')
    })
    void ref.current!.flush() // first save goes out
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(saveBody).toHaveBeenCalledTimes(1)
    act(() => {
      editor.commands.insertContentAt(endOfNth(editor, 'paragraph', 0), 'b')
    })
    let settled = false
    void ref.current!.flush().then(() => {
      settled = true
    })
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(settled).toBe(false)

    await act(async () => {
      resolvers[0]({ version: 'v2' })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(saveBody).toHaveBeenCalledTimes(2) // the queued save, against the new version
    expect(saveBody.mock.calls[1][2]).toBe('v2')
    expect(settled).toBe(false)

    await act(async () => {
      resolvers[1]({ version: 'v3' })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(settled).toBe(true)
    expect(onSaved).toHaveBeenLastCalledWith('v3')
  })

  test('conflict calls onConflict', async () => {
    saveBody.mockRejectedValue(new ConflictError('v9'))
    const { editor, onConflict, onSaved } = mount()
    act(() => {
      editor.commands.insertContentAt(endOfNth(editor, 'paragraph', 0), ' x')
    })
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(onConflict).toHaveBeenCalledWith('v9')
    expect(onSaved).not.toHaveBeenCalled()
    // Further edits do not hammer the server until a new version arrives.
    act(() => {
      editor.commands.insertContentAt(endOfNth(editor, 'paragraph', 0), 'y')
    })
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(saveBody).toHaveBeenCalledTimes(1)
  })

  test('another failure shows an unsaved state and retries until it saves', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    saveBody.mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce({ version: 'v2' })
    const { editor, onSaved, queryByRole } = mount()
    act(() => {
      editor.commands.insertContentAt(endOfNth(editor, 'paragraph', 0), ' x')
    })
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(saveBody).toHaveBeenCalledTimes(1)
    expect(queryByRole('status')?.textContent).toMatch(/not saved/i)
    await act(async () => vi.advanceTimersByTimeAsync(AUTOSAVE_RETRY_MS))
    expect(saveBody).toHaveBeenCalledTimes(2)
    expect(saveBody.mock.calls[1][2]).toBe('v1')
    expect(onSaved).toHaveBeenCalledWith('v2')
    expect(queryByRole('status')).toBeNull()
  })
})

describe('<RawMode>', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    saveBody.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('saves edited body text through saveBody, keeping CRLF', async () => {
    saveBody.mockResolvedValue({ version: 'v2' })
    const onSaved = vi.fn()
    const text = 'a\r\nb\r\n'
    const { container } = render(<RawMode path="Tasks/Fix printer.md" text={text} version="v1" onSaved={onSaved} />)
    const { EditorView } = await import('@codemirror/view')
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!
    act(() => {
      view.dispatch({ changes: { from: 1, insert: 'X' } })
    })
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(saveBody).toHaveBeenCalledWith('Tasks/Fix printer.md', 'aX\r\nb\r\n', 'v1')
    expect(onSaved).toHaveBeenCalledWith('v2')
  })
})

describe('<Editor> find in page', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    saveBody.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const FIND_BODY = [
    '# Alpha notes',
    '',
    'one alpha two Alpha three.',
    '',
    'Untouched   __strong__ line',
    '',
    'See [[Alpha Server]] and alpha.',
    '',
    'Status:: alpha',
    '',
  ].join('\n')

  function mountFind(body = FIND_BODY, overrides: Partial<Parameters<typeof Editor>[0]> = {}) {
    const ref = { current: null as BodyEditorHandle | null }
    const utils = render(
      <Editor
        path="Pages/Find.md"
        body={body}
        version="v1"
        readOnly={false}
        onSaved={() => {}}
        onConflict={() => {}}
        controlRef={ref}
        {...overrides}
      />,
    )
    const find = ref.current!.find!
    return { ...utils, ref, find, editor: pmEditor(utils.container) }
  }

  const marks = (c: HTMLElement) => [...c.querySelectorAll('.find-match')].map((e) => e.textContent)
  const current = (c: HTMLElement) => [...c.querySelectorAll('.find-match-current')].map((e) => e.textContent)

  test('decorations mark every match and the current one; next and previous wrap', () => {
    const { container, find } = mountFind('one alpha two Alpha three alpha\n')
    let count = 0
    act(() => {
      count = find.set('alpha')
    })
    expect(count).toBe(3)
    expect(marks(container)).toEqual(['alpha', 'Alpha', 'alpha'])
    expect(current(container)).toEqual(['alpha'])
    expect(find.status()).toEqual({ index: 0, count: 3 })
    act(() => {
      expect(find.next()).toBe(1)
    })
    expect(current(container)).toEqual(['Alpha'])
    act(() => {
      find.next()
    })
    act(() => {
      expect(find.next()).toBe(0) // wraps forward
    })
    act(() => {
      expect(find.previous()).toBe(2) // wraps back
    })
    // Match case narrows; whole word excludes partial words.
    act(() => {
      count = find.set('Alpha', { matchCase: true })
    })
    expect(count).toBe(1)
    act(() => {
      count = find.set('alph', { matchCase: false, wholeWord: true })
    })
    expect(count).toBe(0)
    expect(marks(container)).toEqual([])
    // Clearing removes every decoration.
    act(() => {
      find.set('alpha', { wholeWord: false })
    })
    expect(marks(container)).toHaveLength(3)
    act(() => {
      find.clear()
    })
    expect(marks(container)).toEqual([])
    expect(find.status()).toEqual({ index: -1, count: 0 })
  })

  test('matches follow edits', () => {
    const { find, editor } = mountFind('alpha\n')
    act(() => {
      find.set('alpha')
    })
    expect(find.status().count).toBe(1)
    act(() => {
      editor.commands.insertContentAt(endOfNth(editor, 'paragraph', 0), ' alpha')
    })
    expect(find.status().count).toBe(2)
  })

  test('replace changes only the current match and autosaves with the version', async () => {
    saveBody.mockResolvedValue({ version: 'v2' })
    const body = 'one alpha two alpha three alpha\n\nUntouched   __strong__ line\n'
    const { find } = mountFind(body)
    act(() => {
      find.set('alpha')
    })
    act(() => {
      find.next()
    })
    act(() => {
      find.replace('omega')
    })
    // The match after the replaced one becomes current.
    expect(find.status()).toEqual({ index: 1, count: 2 })
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(saveBody).toHaveBeenCalledTimes(1)
    expect(saveBody).toHaveBeenCalledWith(
      'Pages/Find.md',
      'one alpha two omega three alpha\n\nUntouched   __strong__ line\n',
      'v1',
    )
  })

  test('replace all saves once through autosave and changes only matches', async () => {
    saveBody.mockResolvedValue({ version: 'v2' })
    const { find } = mountFind()
    let count = 0
    act(() => {
      count = find.set('alpha')
    })
    expect(count).toBe(6) // the wikilink's label is a match too
    let replaced = 0
    act(() => {
      replaced = find.replaceAll('omega')
    })
    expect(replaced).toBe(5) // ... but replace never edits inside it
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(saveBody).toHaveBeenCalledTimes(1)
    const saved = saveBody.mock.calls[0][1]
    expect(saved).toBe(
      [
        '# omega notes',
        '',
        'one omega two omega three.',
        '',
        'Untouched   __strong__ line',
        '',
        'See [[Alpha Server]] and omega.',
        '',
        'Status:: omega',
        '',
      ].join('\n'),
    )
    expect(saveBody.mock.calls[0][2]).toBe('v1')
    // Per `preserve`: only the lines holding a replaced match differ.
    expect(changedLines(FIND_BODY, saved)).toEqual([0, 2, 6, 8])
  })

  test('wikilink labels are matched but never split by replace', async () => {
    saveBody.mockResolvedValue({ version: 'v2' })
    const body = 'See [[Alpha Server|the server]] here.\n'
    const { container, find } = mountFind(body)
    let count = 0
    act(() => {
      count = find.set('server')
    })
    expect(count).toBe(1)
    const chip = container.querySelector('.wikilink')!
    expect(chip.classList.contains('find-match-current')).toBe(true)
    // The target that isn't shown is not matched.
    act(() => {
      count = find.set('Alpha')
    })
    expect(count).toBe(0)
    // A match running from text into the label covers the chip, and is skipped by replace.
    act(() => {
      count = find.set('see the')
    })
    expect(count).toBe(1)
    act(() => {
      find.replace('x')
      expect(find.replaceAll('x')).toBe(0)
    })
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(saveBody).not.toHaveBeenCalled()
  })

  test('read-only editor finds but never replaces', async () => {
    const { find } = mountFind('alpha alpha\n', { readOnly: true })
    act(() => {
      expect(find.set('alpha')).toBe(2)
      find.replace('x')
      expect(find.replaceAll('x')).toBe(0)
    })
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(saveBody).not.toHaveBeenCalled()
    expect(find.status().count).toBe(2)
  })

  test('raw mode offers no find control', () => {
    const ref = { current: null as BodyEditorHandle | null }
    render(<RawMode path="Pages/Find.md" text="alpha" version="v1" onSaved={() => {}} controlRef={ref} />)
    expect(ref.current).not.toBeNull()
    expect(ref.current!.find).toBeUndefined()
  })
})
