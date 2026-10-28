import fs from 'node:fs'
import path from 'node:path'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SearchResponse } from '@/api/types'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { useCalendar } from '@/calendar/useCalendar'
import { useFocusMode } from '@/focus/useFocusMode'
import { todayYmd } from '@/calendar/dates'
import { useLinkIndex } from '@/links/linkIndex'
import { useRecent } from '@/nav/recent'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { objectSummary, searchResult, typeDef } from '@/test/mockApi'
import { ACTION_TEXT } from './actions'
import { CommandPalette, paletteShortcut } from './CommandPalette'
import { PALETTE_TEXT } from './searchOptions'
import { usePalette } from './usePalette'

const mocked = vi.mocked(api)
const STRINGS_FILE = '../../../docs/strings.txt'

const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true })
const PERSON = typeDef({ id: 'person', name: 'Person', pluralName: 'People' })
const TASK = typeDef({ id: 'task', name: 'Task', pluralName: 'Tasks', basic: true })
const TAG = typeDef({ id: 'tag', name: 'Tag', pluralName: 'Tags', basic: true })

const ALPHA = objectSummary({ path: 'Pages/Alpha.md', title: 'Alpha' })
const BEA = objectSummary({ path: 'People/Bea.md', title: 'Bea', type: 'person' })
const WORK = objectSummary({ path: 'Tags/work.md', title: 'work', type: 'tag' })
const TODO = objectSummary({ path: 'Tasks/Todo.md', title: 'Todo', type: 'task' })

beforeAll(() => {
  // jsdom lacks scrollIntoView, which cmdk calls on the selected item.
  Element.prototype.scrollIntoView ??= function () {}
})

function props() {
  return {
    onOpenTarget: vi.fn((t, o) => useTabs.getState().open(t, o)),
    onToggleSidebar: vi.fn(),
    onToggleRightPanel: vi.fn(),
    onShowRightPanel: vi.fn(),
  }
}

function setup(p = props()) {
  const user = userEvent.setup()
  render(<CommandPalette {...p} />)
  return { user, p }
}

async function openSearch(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Control>}k{/Control}')
  return screen.findByPlaceholderText(PALETTE_TEXT.placeholderSearch)
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

beforeEach(() => {
  for (const f of Object.values(mocked)) (f as { mockClear?: () => void }).mockClear?.()
  mocked.search.mockReset()
  mocked.createObject.mockClear()
  usePalette.setState({ open: false, mode: 'search' })
  usePeek.getState().close()
  useTabs.getState().reset()
  useRecent.setState({ paths: [] })
  useLinkIndex.setState({ types: [PAGE, PERSON, TASK, TAG], objects: [ALPHA, BEA, WORK, TODO], loaded: true })
})

describe('shortcuts', () => {
  test('Ctrl+K and Ctrl+P open search (Object), also with focus in the editor; no key opens actions; Esc closes', async () => {
    const { user } = setup()
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    document.body.appendChild(editor)
    editor.focus()
    expect(document.activeElement).toBe(editor)

    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByPlaceholderText('Search content')).toBeInTheDocument()
    expect(usePalette.getState()).toMatchObject({ open: true, mode: 'search' })

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByPlaceholderText('Search content')).toBeNull())
    expect(usePalette.getState().open).toBe(false)

    // Ctrl+P with the caret in the editor too (and the browser's print is prevented).
    editor.focus()
    const ev = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true })
    act(() => {
      editor.dispatchEvent(ev)
    })
    expect(ev.defaultPrevented).toBe(true)
    expect(await screen.findByPlaceholderText('Search content')).toBeInTheDocument()
    expect(usePalette.getState()).toMatchObject({ open: true, mode: 'search' })
    expect(paletteShortcut(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, shiftKey: true }))).toBeNull()
    expect(paletteShortcut(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true }))).toBe('search')
    editor.remove()
  })

  test('Ctrl+K toggles closed, and does nothing while another modal dialog is open', async () => {
    const { user } = setup()
    await openSearch(user)
    await user.keyboard('{Control>}k{/Control}')
    await waitFor(() => expect(usePalette.getState().open).toBe(false))

    const other = document.createElement('div')
    other.setAttribute('role', 'dialog')
    document.body.appendChild(other)
    await user.keyboard('{Control>}k{/Control}')
    expect(usePalette.getState().open).toBe(false)
    other.remove()
  })

  test('the footer switches modes', async () => {
    const { user } = setup()
    await openSearch(user)
    await user.click(screen.getByRole('button', { name: /Switch to actions/ }))
    expect(await screen.findByPlaceholderText('Search for actions')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Switch to search/ }))
    expect(await screen.findByPlaceholderText('Search content')).toBeInTheDocument()
  })
})

describe('search mode', () => {
  test('empty query lists recently opened objects; empty recents state', async () => {
    useRecent.setState({ paths: ['People/Bea.md', 'Gone/Missing.md', 'Pages/Alpha.md'] })
    const { user } = setup()
    await openSearch(user)
    const group = screen.getByText('Recently Opened').closest('[cmdk-group]') as HTMLElement
    const items = within(group).getAllByRole('option')
    expect(items.map((i) => i.textContent)).toEqual(['BeaPerson', 'AlphaPage'])
    expect(mocked.search).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    useRecent.setState({ paths: [] })
    await openSearch(user)
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument()
    expect(screen.getByText('Objects you open will show up here for quick access.')).toBeInTheDocument()
  })

  test('typing debounces one request and drops stale responses', async () => {
    const first = deferred<SearchResponse>()
    mocked.search.mockImplementationOnce(() => first.promise)
    mocked.search.mockImplementationOnce(async () => ({
      results: [searchResult({ path: 'Pages/Alpha.md', title: 'Alpha' })],
      partial: false,
    }))
    const { user } = setup()
    const input = await openSearch(user)
    await user.type(input, 'alp')
    await waitFor(() => expect(mocked.search).toHaveBeenCalledTimes(1))
    expect(mocked.search.mock.calls[0][0]).toBe('alp')
    const signal = mocked.search.mock.calls[0][1]?.signal
    expect(signal).toBeInstanceOf(AbortSignal)

    await user.type(input, 'h')
    await waitFor(() => expect(mocked.search).toHaveBeenCalledTimes(2))
    expect(signal?.aborted).toBe(true)
    expect(mocked.search.mock.calls[1][0]).toBe('alph')
    await screen.findByText('Alpha')

    // The older request answers late: ignored.
    await act(async () => {
      first.resolve({ results: [searchResult({ path: 'People/Bea.md', title: 'Stale' })], partial: false })
      await first.promise
    })
    expect(screen.queryByText('Stale')).toBeNull()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  test('results show bold title matches and snippets without parsing HTML', async () => {
    mocked.search.mockResolvedValue({
      results: [
        searchResult({
          path: 'Pages/Alpha.md',
          title: 'Alpha',
          titleMatches: [[0, 3]],
          highlights: [
            { field: 'blocksContent', snippets: ['one <img src=x> \u0002alp\u0003ine', 'two \u0002alp\u0003s'] },
            { field: 'tags', snippets: ['three'] },
          ],
        }),
      ],
      partial: false,
    })
    const { user } = setup()
    const input = await openSearch(user)
    await user.type(input, 'alp')
    const row = await waitFor(() => {
      const el = document.querySelector('[data-search-result="Pages/Alpha.md"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    expect(row.querySelector('[data-result-title] b')?.textContent).toBe('Alp')
    // Object: palette result titles use the 600-weight `search-highlights-bold` variant.
    expect(row.querySelector('[data-result-title] .search-highlights.search-highlights-bold b')?.textContent).toBe('Alp')
    expect(row.querySelector('img')).toBeNull()
    const snippets = row.querySelectorAll('.search-highlights:not(.search-highlights-bold)')
    expect(snippets).toHaveLength(2)
    expect(snippets[0].textContent).toBe('one <img src=x> alpine')
    expect(snippets[0].querySelector('b')?.textContent).toBe('alp')
    expect(row.textContent).toContain('Page')
    expect(row.textContent).not.toContain('three')
  })

  test('enter opens in the current tab, ctrl+enter in a new tab, shift+enter in the side panel', async () => {
    mocked.search.mockResolvedValue({ results: [searchResult({ path: 'Pages/Alpha.md', title: 'Alpha' })], partial: false })
    const { user } = setup()

    let input = await openSearch(user)
    await user.type(input, 'alpha')
    await screen.findByText('Alpha')
    await user.keyboard('{Enter}')
    expect(usePalette.getState().open).toBe(false)
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Pages/Alpha.md' })
    expect(useTabs.getState().tabs).toHaveLength(1)

    input = await openSearch(user)
    await user.type(input, 'alpha')
    await screen.findByText('Alpha')
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(useTabs.getState().tabs).toHaveLength(2)

    input = await openSearch(user)
    await user.type(input, 'alpha')
    await screen.findByText('Alpha')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    // M7: Shift opens the side panel (Object's rule); Alt+Shift keeps the peek.
    expect(usePeek.getState().path).toBeNull()
    const tab = useTabs.getState().tabs.find((t) => t.id === useTabs.getState().activeId)!
    expect(tab.sidepanel?.find((e) => e.isOpen)?.target).toEqual({ kind: 'object', path: 'Pages/Alpha.md' })
    expect(useTabs.getState().tabs).toHaveLength(2)
  })

  test('a Task result opens in the peek on plain Enter', async () => {
    mocked.search.mockResolvedValue({ results: [searchResult({ path: 'Tasks/Todo.md', title: 'Todo', type: 'task' })], partial: false })
    const { user } = setup()
    const input = await openSearch(user)
    await user.type(input, 'todo')
    await screen.findByText('Todo')
    await user.keyboard('{Enter}')
    expect(usePeek.getState().path).toBe('Tasks/Todo.md')
  })

  test('type include and exclude and tag options add chips and refetch; clear filter', async () => {
    mocked.search.mockResolvedValue({ results: [], partial: false })
    const { user } = setup()
    const input = await openSearch(user)

    await user.type(input, 'alpha peo')
    await user.click(await screen.findByText('Only search for type "Person"'))
    expect(input).toHaveValue('alpha')
    await waitFor(() =>
      expect(mocked.search).toHaveBeenLastCalledWith('alpha', expect.objectContaining({ types: ['person'], excludeTypes: [] })),
    )
    expect(document.querySelectorAll('[data-filter-chip]')).toHaveLength(1)

    await user.type(input, ' tas')
    await user.click(await screen.findByText('Exclude type "Task"'))
    await waitFor(() =>
      expect(mocked.search).toHaveBeenLastCalledWith('alpha', expect.objectContaining({ types: ['person'], excludeTypes: ['task'] })),
    )

    await user.type(input, ' wor')
    await user.click(await screen.findByText('Only search content tagged with "work"'))
    await waitFor(() => expect(mocked.search).toHaveBeenLastCalledWith('alpha', expect.objectContaining({ tag: 'work' })))
    expect(document.querySelectorAll('[data-filter-chip]')).toHaveLength(3)

    const clears = screen.getAllByRole('button', { name: 'Clear filter' })
    await user.click(clears[0])
    await waitFor(() =>
      expect(mocked.search).toHaveBeenLastCalledWith('alpha', expect.objectContaining({ types: [], excludeTypes: ['task'], tag: 'work' })),
    )
    expect(document.querySelectorAll('[data-filter-chip]')).toHaveLength(2)
  })

  test('clearing a filter chip drops the filtered results until the unfiltered answer arrives', async () => {
    const unfiltered = deferred<SearchResponse>()
    mocked.search.mockImplementation(async (_q, opts) =>
      opts?.types?.includes('person')
        ? { results: [searchResult({ path: 'People/Bea.md', title: 'Bea', type: 'person' })], partial: false }
        : unfiltered.promise,
    )
    const { user } = setup()
    const input = await openSearch(user)
    await user.type(input, 'alpha peo')
    await user.click(await screen.findByText('Only search for type "Person"'))
    await screen.findByText('Bea')
    await user.click(screen.getByRole('button', { name: 'Clear filter' }))
    await waitFor(() => expect(mocked.search).toHaveBeenLastCalledWith('alpha', expect.objectContaining({ types: [] })))
    expect(screen.queryByText('Bea')).toBeNull()
    await act(async () => unfiltered.resolve({ results: [searchResult({ path: 'Pages/Alpha.md', title: 'Alpha' })], partial: false }))
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
  })

  test('create new with title creates once and opens', async () => {
    mocked.search.mockResolvedValue({ results: [], partial: false })
    const { user } = setup()
    const input = await openSearch(user)
    await user.type(input, 'Fresh idea')
    const option = await screen.findByText('Create new Page with title "Fresh idea"')
    await user.click(option)
    await waitFor(() => expect(usePalette.getState().open).toBe(false))
    expect(mocked.createObject).toHaveBeenCalledTimes(1)
    expect(mocked.createObject).toHaveBeenCalledWith('page', { title: 'Fresh idea' })
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'page/Fresh idea.md' })
  })

  test('create new with title uses the type filter', async () => {
    mocked.search.mockResolvedValue({ results: [], partial: false })
    const { user } = setup()
    const input = await openSearch(user)
    await user.type(input, 'people')
    await user.click(await screen.findByText('Only search for type "Person"'))
    await user.type(input, 'Cleo')
    await user.click(await screen.findByText('Create new Person with title "Cleo"'))
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledTimes(1))
    expect(mocked.createObject).toHaveBeenCalledWith('person', { title: 'Cleo' })
  })

  test('no results and partial index messages', async () => {
    mocked.search.mockResolvedValue({ results: [], partial: true })
    const { user } = setup()
    const input = await openSearch(user)
    await user.type(input, 'zzz')
    expect(await screen.findByText('No results for "zzz"')).toBeInTheDocument()
    expect(screen.getByText('Try a different term, or remove filters to widen the search.')).toBeInTheDocument()
    expect(
      screen.getByText('Your content in not fully indexed yet. Search results might not return all matches.'),
    ).toBeInTheDocument()
  })
})

describe('action mode', () => {
  async function openActions(_user: ReturnType<typeof userEvent.setup>) {
    act(() => usePalette.getState().show('actions'))
    return screen.findByPlaceholderText(PALETTE_TEXT.placeholderActions)
  }

  function action(id: string): HTMLElement {
    const el = document.querySelector(`[data-action="${id}"]`)
    if (!el) throw new Error(`no action ${id}`)
    return el as HTMLElement
  }

  test("actions list and each action's effect", async () => {
    const { user, p } = setup()
    await openActions(user)
    expect(screen.getByText('All actions')).toBeInTheDocument()
    const labels = screen.getAllByRole('option').map((o) => o.textContent)
    expect(labels).toEqual([
      'Create Page',
      'Create Person',
      'Create Tag',
      'Create Task',
      'Open calendar',
      'Open today',
      'Open extended search',
      'Open global graph',
      'Open settings',
      'Toggle focus mode', // M8 Task 17 (CommandPalette.actions.options.toggleFocusMode)
      'Toggle left sidebar',
      'Toggle right sidepanel',
    ])

    await user.click(action('openCalendar'))
    expect(usePalette.getState().open).toBe(false)
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'calendar' })

    useCalendar.setState({ view: 'month', anchor: '2001-01-01' })
    await openActions(user)
    await user.click(action('openToday'))
    expect(useCalendar.getState()).toMatchObject({ view: 'day', anchor: todayYmd() })
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'calendar' })
    expect(mocked.createDailyNote).not.toHaveBeenCalled()

    await openActions(user)
    await user.click(action('openGlobalGraph'))
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'graph' })

    await openActions(user)
    await user.click(action('toggleLeftSidebar'))
    expect(p.onToggleSidebar).toHaveBeenCalledTimes(1)

    await openActions(user)
    await user.click(action('toggleSidepanel'))
    expect(p.onToggleRightPanel).toHaveBeenCalledTimes(1)

    useFocusMode.setState({ on: false })
    await openActions(user)
    await user.click(action('toggleFocusMode'))
    expect(usePalette.getState().open).toBe(false)
    expect(useFocusMode.getState().on).toBe(true)
    useFocusMode.getState().leave()

    await openActions(user)
    await user.click(action('create:person'))
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('person', {}))
    expect(mocked.createObject).toHaveBeenCalledTimes(1)
  })

  test('typing filters actions', async () => {
    const { user } = setup()
    const input = await openActions(user)
    await user.type(input, 'calendar')
    const labels = screen.getAllByRole('option').map((o) => o.textContent)
    expect(labels).toContain('Open calendar')
    expect(labels).not.toContain('Create Person')
  })

  test('open graph view only offered with an object open', async () => {
    const { user, p } = setup()
    await openActions(user)
    expect(document.querySelector('[data-action="openGraphView"]')).toBeNull()
    await user.keyboard('{Escape}')

    act(() => useTabs.getState().open({ kind: 'object', path: 'Pages/Alpha.md' }))
    await openActions(user)
    await user.click(action('openGraphView'))
    expect(p.onShowRightPanel).toHaveBeenCalledTimes(1)
  })
})

test('palette strings match reference', () => {
  const strings = fs.readFileSync(path.resolve(__dirname, STRINGS_FILE), 'utf8')
  const verbatim = [
    PALETTE_TEXT.placeholderSearch,
    PALETTE_TEXT.placeholderActions,
    PALETTE_TEXT.recentlyOpened,
    PALETTE_TEXT.allActions,
    PALETTE_TEXT.emptyRecentsTitle,
    PALETTE_TEXT.emptyRecentsDescription,
    PALETTE_TEXT.emptyDescription,
    PALETTE_TEXT.onlyPartialResults,
    PALETTE_TEXT.clearFilter,
    PALETTE_TEXT.switchToActions,
    PALETTE_TEXT.switchToSearch,
    PALETTE_TEXT.searchTitle,
    PALETTE_TEXT.actionsTitle,
    ACTION_TEXT.openCalendar,
    ACTION_TEXT.openToday,
    ACTION_TEXT.openGlobalGraph,
    ACTION_TEXT.openGraphView,
    ACTION_TEXT.toggleLeftSidebar,
    ACTION_TEXT.toggleSidepanel,
  ]
  for (const s of verbatim) expect(strings, s).toContain(`s:\`${s}\``)
  // Interpolated strings: their literal pieces, in order.
  const pieces = [
    'v:`No results for "`},{t:4,k:`query`}',
    'v:`Create new `},{t:4,k:`structureTitle`},{t:3,v:` with title "`},{t:4,k:`title`}',
    'v:`Only search for type "`},{t:4,k:`structureName`}',
    'v:`Exclude type "`},{t:4,k:`structureName`}',
    'v:`Only search content tagged with "`},{t:4,k:`tagName`}',
    'createNewEntity:{t:0,b:{t:2,i:[{t:3,v:`Create `},{t:4,k:`structureName`}',
  ]
  for (const s of pieces) expect(strings, s).toContain(s)
  expect(PALETTE_TEXT.emptyTitle('q')).toBe('No results for "q"')
  expect(PALETTE_TEXT.createNewWithTitle('Page', 't')).toBe('Create new Page with title "t"')
  expect(PALETTE_TEXT.structureFilter('X')).toBe('Only search for type "X"')
  expect(PALETTE_TEXT.structureFilterExclude('X')).toBe('Exclude type "X"')
  expect(PALETTE_TEXT.tagFilter('x')).toBe('Only search content tagged with "x"')
  expect(ACTION_TEXT.createNewEntity('Page')).toBe('Create Page')
})
