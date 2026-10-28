import fs from 'node:fs'
import path from 'node:path'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { Editor } from '@/editor/Editor'
import { RawMode } from '@/editor/RawMode'
import type { BodyEditorHandle } from '@/editor/useAutosave'
import { FIND_TEXT, FindBar } from './FindBar'
import { useFind } from './useFind'

const saveBody = vi.mocked(api).saveBody
const STRINGS_FILE = '../../../reference/app-unpacked/dist/virtual_intlify-i18n-0366822.js'
const CSS_FILE = '../index.css'
const PATH = 'Pages/Find.md'
const BODY = 'one alpha two Alpha three.\n\nNothing here.\n'

function mount(raw = false, body = BODY) {
  const ref = { current: null as BodyEditorHandle | null }
  const utils = render(
    <div>
      <FindBar path={PATH} editorRef={ref} />
      {raw ? (
        <RawMode path={PATH} text={body} version="v1" onSaved={() => {}} controlRef={ref} />
      ) : (
        <Editor path={PATH} body={body} version="v1" readOnly={false} onSaved={() => {}} onConflict={() => {}} controlRef={ref} />
      )}
    </div>,
  )
  return { ...utils, ref }
}

const marks = (c: HTMLElement) => c.querySelectorAll('.ProseMirror .find-match').length
const findInput = () => screen.getByPlaceholderText(FIND_TEXT.searchPlaceholder) as HTMLInputElement

beforeEach(() => {
  useFind.setState({ path: null, query: '', matchCase: false, wholeWord: false, replaceOpen: false, focusTick: 0 })
  saveBody.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('<FindBar>', () => {
  test('find bar opens from useFind, Esc closes and clears decorations', () => {
    const { container } = mount()
    expect(screen.queryByRole('search')).toBeNull()

    act(() => useFind.getState().open(PATH))
    expect(screen.getByRole('search')).toBeTruthy()
    expect(document.activeElement).toBe(findInput())

    fireEvent.change(findInput(), { target: { value: 'alpha' } })
    expect(marks(container)).toBe(2)
    expect(screen.getByTestId('find-count').textContent).toBe('1/2')

    fireEvent.click(screen.getByRole('button', { name: FIND_TEXT.next }))
    expect(screen.getByTestId('find-count').textContent).toBe('2/2')
    fireEvent.keyDown(findInput(), { key: 'Enter' }) // wraps
    expect(screen.getByTestId('find-count').textContent).toBe('1/2')
    fireEvent.keyDown(findInput(), { key: 'Enter', shiftKey: true })
    expect(screen.getByTestId('find-count').textContent).toBe('2/2')
    fireEvent.click(screen.getByRole('button', { name: FIND_TEXT.previous }))
    expect(screen.getByTestId('find-count').textContent).toBe('1/2')

    // Match case narrows to one.
    fireEvent.click(screen.getByRole('button', { name: FIND_TEXT.matchCase }))
    expect(screen.getByRole('button', { name: FIND_TEXT.matchCase }).getAttribute('aria-pressed')).toBe('true')
    expect(marks(container)).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: FIND_TEXT.matchCase }))

    // Esc closes without reaching a surrounding dialog's document listener.
    const outer = vi.fn()
    document.addEventListener('keydown', outer, true)
    fireEvent.keyDown(findInput(), { key: 'Escape' })
    document.removeEventListener('keydown', outer, true)
    expect(outer).not.toHaveBeenCalled()
    expect(useFind.getState().path).toBeNull()
    expect(screen.queryByRole('search')).toBeNull()
    expect(marks(container)).toBe(0)

    // Reopening keeps the query and finds again.
    act(() => useFind.getState().open(PATH))
    expect(findInput().value).toBe('alpha')
    expect(marks(container)).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: FIND_TEXT.close }))
    expect(screen.queryByRole('search')).toBeNull()
    expect(marks(container)).toBe(0)
  })

  test('the bar of another object stays closed', () => {
    mount()
    act(() => useFind.getState().open('Pages/Other.md'))
    expect(screen.queryByRole('search')).toBeNull()
  })

  test('find bar strings and chrome width', () => {
    const strings = fs.readFileSync(path.resolve(__dirname, STRINGS_FILE), 'utf8')
    const verbatim = [
      FIND_TEXT.searchPlaceholder,
      FIND_TEXT.matchCase,
      FIND_TEXT.wholeWord,
      FIND_TEXT.previous,
      FIND_TEXT.next,
      FIND_TEXT.toggleReplace,
      FIND_TEXT.replacePlaceholder,
      FIND_TEXT.replace,
      FIND_TEXT.replaceAll,
      FIND_TEXT.close,
    ]
    const group = strings.slice(strings.indexOf('FindInPage:{'), strings.indexOf('FirstSteps:{'))
    for (const s of verbatim) expect(group, s).toContain(`s:\`${s}\``)
    expect(group).toContain('noResults:{t:0,b:{t:2,i:[{t:3,v:`No results for "`},{t:4,k:`query`},{t:3,v:`"`}]}}')
    expect(FIND_TEXT.noResults('zzz')).toBe('No results for "zzz"')

    const css = fs.readFileSync(path.resolve(__dirname, CSS_FILE), 'utf8').replace(/\s+/g, ' ')
    expect(css).toContain('.find-in-page-chrome { flex-shrink: 1; width: 20rem; min-width: 12rem; max-width: 100%; }')

    mount()
    act(() => useFind.getState().open(PATH))
    expect(screen.getByRole('search').classList.contains('find-in-page-chrome')).toBe(true)
    for (const name of [FIND_TEXT.matchCase, FIND_TEXT.wholeWord, FIND_TEXT.previous, FIND_TEXT.next, FIND_TEXT.toggleReplace, FIND_TEXT.close])
      expect(screen.getByRole('button', { name })).toBeTruthy()

    fireEvent.change(findInput(), { target: { value: 'zzz' } })
    expect(screen.getByRole('status').textContent).toBe('No results for "zzz"')
    expect(screen.queryByTestId('find-count')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: FIND_TEXT.toggleReplace }))
    expect(screen.getByPlaceholderText(FIND_TEXT.replacePlaceholder)).toBeTruthy()
    expect(screen.getByRole('button', { name: FIND_TEXT.replace })).toBeTruthy()
    expect(screen.getByRole('button', { name: FIND_TEXT.replaceAll })).toBeTruthy()
  })

  test('raw mode gets the same bar, and switching modes re-binds it', () => {
    const ref = { current: null as BodyEditorHandle | null }
    const view = (raw: boolean) => (
      <div>
        <FindBar path={PATH} editorRef={ref} />
        {raw ? (
          <RawMode path={PATH} text={BODY} version="v1" onSaved={() => {}} controlRef={ref} />
        ) : (
          <Editor path={PATH} body={BODY} version="v1" readOnly={false} onSaved={() => {}} onConflict={() => {}} controlRef={ref} />
        )}
      </div>
    )
    const { container, rerender } = render(view(false))
    act(() => useFind.getState().open(PATH))
    fireEvent.change(findInput(), { target: { value: 'alpha' } })
    expect(marks(container)).toBe(2)

    rerender(view(true))
    expect(findInput().disabled).toBe(false)
    expect(container.querySelectorAll('.cm-content .find-match')).toHaveLength(2)
    expect(screen.getByTestId('find-count').textContent).toBe('1/2')

    rerender(view(false))
    expect(marks(container)).toBe(2)
  })

  test('no editor yet: the bar opens disabled and still closes', () => {
    const ref = { current: null as BodyEditorHandle | null }
    render(<FindBar path={PATH} editorRef={ref} />)
    act(() => useFind.getState().open(PATH))
    expect(findInput().disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toBe(FIND_TEXT.unavailable)
    expect((screen.getByRole('button', { name: FIND_TEXT.next }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: FIND_TEXT.close }))
    expect(screen.queryByRole('search')).toBeNull()
  })

  test('replace all from the bar saves once through autosave', async () => {
    vi.useFakeTimers()
    saveBody.mockResolvedValue({ version: 'v2' })
    mount()
    act(() => useFind.getState().open(PATH))
    fireEvent.change(findInput(), { target: { value: 'alpha' } })
    fireEvent.click(screen.getByRole('button', { name: FIND_TEXT.toggleReplace }))
    fireEvent.change(screen.getByPlaceholderText(FIND_TEXT.replacePlaceholder), { target: { value: 'beta' } })
    fireEvent.click(screen.getByRole('button', { name: FIND_TEXT.replaceAll }))
    expect(screen.getByRole('status').textContent).toBe('No results for "alpha"')
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(saveBody).toHaveBeenCalledTimes(1)
    expect(saveBody).toHaveBeenCalledWith(PATH, 'one beta two beta three.\n\nNothing here.\n', 'v1')
  })

  test('replace from the bar edits the current match', async () => {
    vi.useFakeTimers()
    saveBody.mockResolvedValue({ version: 'v2' })
    mount()
    act(() => useFind.getState().open(PATH))
    fireEvent.change(findInput(), { target: { value: 'alpha' } })
    fireEvent.click(screen.getByRole('button', { name: FIND_TEXT.toggleReplace }))
    const replaceInput = screen.getByPlaceholderText(FIND_TEXT.replacePlaceholder)
    fireEvent.change(replaceInput, { target: { value: 'beta' } })
    fireEvent.keyDown(replaceInput, { key: 'Enter' })
    expect(screen.getByTestId('find-count').textContent).toBe('1/1')
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(saveBody).toHaveBeenCalledWith(PATH, 'one beta two Alpha three.\n\nNothing here.\n', 'v1')
  })
})
