import { EditorView } from '@codemirror/view'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { FIND_TEXT, FindBar } from '@/find/FindBar'
import { useFind } from '@/find/useFind'
import { RawMode } from './RawMode'
import type { BodyEditorHandle } from './useAutosave'

const saveBody = vi.mocked(api).saveBody
const PATH = 'Pages/Raw.md'
// CRLF, a wikilink and markup: raw mode searches the text exactly as stored.
const BODY = '# Alpha\r\n\r\none alpha two [[Alpha Centauri]] alphabet.\r\n- alpha_beta\r\n'

function mount(body = BODY, readOnly = false) {
  const ref = { current: null as BodyEditorHandle | null }
  const utils = render(
    <div>
      <FindBar path={PATH} editorRef={ref} />
      <RawMode path={PATH} text={body} version="v1" onSaved={() => {}} readOnly={readOnly} controlRef={ref} />
    </div>,
  )
  return { ...utils, ref }
}

const findInput = () => screen.getByPlaceholderText(FIND_TEXT.searchPlaceholder) as HTMLInputElement
const marks = (c: HTMLElement) => [...c.querySelectorAll('.cm-content .find-match')].map((e) => e.textContent)
const current = (c: HTMLElement) => [...c.querySelectorAll('.cm-content .find-match-current')].map((e) => e.textContent)
const count = () => screen.getByTestId('find-count').textContent

function openFind(query: string) {
  act(() => useFind.getState().open(PATH))
  fireEvent.change(findInput(), { target: { value: query } })
}

beforeEach(() => {
  useFind.setState({ path: null, query: '', matchCase: false, wholeWord: false, replaceOpen: false, focusTick: 0 })
  saveBody.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('RawMode find', () => {
  test('test raw find highlights and steps matches', () => {
    const { container, ref } = mount()
    openFind('alpha')
    expect(findInput().disabled).toBe(false)
    // Every occurrence in the raw text: the heading, the word, inside the wikilink, the prefix of
    // "alphabet" and of "alpha_beta".
    expect(marks(container)).toEqual(['Alpha', 'alpha', 'Alpha', 'alpha', 'alpha'])
    expect(count()).toBe('1/5')
    expect(current(container)).toEqual(['Alpha'])

    fireEvent.click(screen.getByRole('button', { name: FIND_TEXT.next }))
    expect(count()).toBe('2/5')
    fireEvent.keyDown(findInput(), { key: 'Enter' })
    expect(count()).toBe('3/5')
    fireEvent.keyDown(findInput(), { key: 'Enter', shiftKey: true })
    expect(count()).toBe('2/5')
    fireEvent.click(screen.getByRole('button', { name: FIND_TEXT.previous }))
    fireEvent.click(screen.getByRole('button', { name: FIND_TEXT.previous }))
    // Wraps to the last.
    expect(count()).toBe('5/5')
    expect(ref.current?.find?.status()).toEqual({ index: 4, count: 5 })

    // Stepping selects the current match in the raw text (CodeMirror positions, one per EOL).
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!
    const sel = view.state.selection.main
    expect([sel.from, sel.to]).toEqual([view.state.doc.toString().lastIndexOf('alpha'), view.state.doc.toString().lastIndexOf('alpha') + 5])

    // No results, then closing clears every decoration.
    fireEvent.change(findInput(), { target: { value: 'gamma' } })
    expect(screen.getByRole('status').textContent).toBe('No results for "gamma"')
    expect(marks(container)).toEqual([])
    fireEvent.change(findInput(), { target: { value: 'alpha' } })
    expect(marks(container)).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: FIND_TEXT.close }))
    expect(screen.queryByRole('search')).toBeNull()
    expect(marks(container)).toEqual([])
  })

  test('test raw replace changes only matches', async () => {
    vi.useFakeTimers()
    saveBody.mockResolvedValue({ version: 'v2' })
    mount()
    openFind('alpha')
    act(() => useFind.getState().setOptions({ matchCase: true, wholeWord: true }))
    expect(count()).toBe('1/1')
    fireEvent.click(screen.getByRole('button', { name: FIND_TEXT.toggleReplace }))
    const replaceInput = screen.getByPlaceholderText(FIND_TEXT.replacePlaceholder)
    fireEvent.change(replaceInput, { target: { value: 'beta' } })
    // Enter replaces the current match only; CRLF and every other byte stay.
    fireEvent.keyDown(replaceInput, { key: 'Enter' })
    expect(screen.getByRole('status').textContent).toBe('No results for "alpha"')
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(saveBody).toHaveBeenCalledTimes(1)
    expect(saveBody).toHaveBeenLastCalledWith(PATH, '# Alpha\r\n\r\none beta two [[Alpha Centauri]] alphabet.\r\n- alpha_beta\r\n', 'v1')

    // Replace all: one edit, one save, every case-folded match (a multi-line body).
    act(() => useFind.getState().setOptions({ matchCase: false, wholeWord: false }))
    expect(count()).toBe('1/4')
    fireEvent.change(replaceInput, { target: { value: 'Ω' } })
    fireEvent.click(screen.getByRole('button', { name: FIND_TEXT.replaceAll }))
    expect(screen.getByRole('status').textContent).toBe('No results for "alpha"')
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(saveBody).toHaveBeenCalledTimes(2)
    expect(saveBody).toHaveBeenLastCalledWith(PATH, '# Ω\r\n\r\none beta two [[Ω Centauri]] Ωbet.\r\n- Ω_beta\r\n', 'v2')
  })

  test('test match case and whole word in raw mode', () => {
    const { container } = mount()
    openFind('alpha')
    expect(count()).toBe('1/5')

    fireEvent.click(screen.getByRole('button', { name: FIND_TEXT.matchCase }))
    expect(marks(container)).toEqual(['alpha', 'alpha', 'alpha'])
    expect(count()).toBe('1/3')

    // Whole word: "alphabet" and "alpha_beta" (underscore is a word character) drop out.
    fireEvent.click(screen.getByRole('button', { name: FIND_TEXT.wholeWord }))
    expect(marks(container)).toEqual(['alpha'])
    expect(count()).toBe('1/1')

    fireEvent.click(screen.getByRole('button', { name: FIND_TEXT.matchCase }))
    // Case folded, whole word: the heading, the word and the wikilink's "Alpha".
    expect(marks(container)).toEqual(['Alpha', 'alpha', 'Alpha'])
    expect(count()).toBe('1/3')
  })

  test('read-only raw mode finds but never replaces', () => {
    const { container, ref } = mount(BODY, true)
    openFind('alpha')
    expect(marks(container)).toHaveLength(5)
    expect(ref.current?.find?.replaceAll('x')).toBe(0)
    act(() => ref.current?.find?.replace('x'))
    expect(ref.current?.getBody()).toBe(BODY)
  })

  test('a reload keeps the open bar matching', () => {
    const { container, ref } = mount()
    openFind('alpha')
    expect(marks(container)).toHaveLength(5)
    act(() => ref.current?.reload('alpha and alpha\n', 'v9'))
    expect(marks(container)).toEqual(['alpha', 'alpha'])
    expect(count()).toBe('1/2')
  })
})
