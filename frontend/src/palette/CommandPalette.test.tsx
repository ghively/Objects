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
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
  return screen.findByPlaceholderText(PALETTE_TEXT.placeholder)
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

beforeEach(() => {
  for (const f of Object.values(mocked)) (f as { mockClear?: () => void }).mockClear?.()
  mocked.search.mockReset()
  mocked.search.mockResolvedValue({ results: [], partial: false })
  mocked.createObject.mockClear()
  usePalette.setState({ open: false, mode: 'search' })
  usePeek.getState().close()
  useTabs.getState().reset()
  useRecent.setState({ paths: [], openedAt: {} })
  useLinkIndex.setState({ types: [PAGE, PERSON, TASK, TAG], objects: [ALPHA, BEA, WORK, TODO], loaded: true })
})

describe('shortcuts', () => {
  test('the footer lists the keys: navigate, abort, select, new tab, side panel', async () => {
    const { user } = setup()
    await user.keyboard('{Control>}k{/Control}')
    await screen.findByPlaceholderText(PALETTE_TEXT.placeholder)
    const hints = screen.getByRole('note', { name: 'Keyboard hints' })
    for (const t of ['↑↓ to navigate', 'Esc to abort', '↵ to select', 'Ctrl ↵ in new tab', 'Shift ↵ in side panel']) {
      expect(hints).toHaveTextContent(t)
    }
  })

  test('Ctrl+K and Ctrl+P open search, also with focus in the editor; no key opens actions; Esc closes', async () => {
    const { user } = setup()
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    document.body.appendChild(editor)
    editor.focus()
    expect(document.activeElement).toBe(editor)

    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByPlaceholderText(PALETTE_TEXT.placeholder)).toBeInTheDocument()
    expect(usePalette.getState()).toMatchObject({ open: true, mode: 'search' })

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByPlaceholderText(PALETTE_TEXT.placeholder)).toBeNull())
    expect(usePalette.getState().open).toBe(false)

    // Ctrl+P with the caret in the editor too (and the browser's print is prevented).
    editor.focus()
    const ev = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true })
    act(() => {
      editor.dispatchEvent(ev)
    })
    expect(ev.defaultPrevented).toBe(true)
    expect(await screen.findByPlaceholderText(PALETTE_TEXT.placeholder)).toBeInTheDocument()
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
    other.setAttribute('aria-modal', 'true')
    document.body.appendChild(other)
    await user.keyboard('{Control>}k{/Control}')
    expect(usePalette.getState().open).toBe(false)
    other.remove()
  })

  test('Ctrl+K works while a popover (tab menu, spaces menu, date picker) is open', async () => {
    const { user } = setup()
    render(
      <Popover open>
        <PopoverTrigger asChild>
          <button type="button">menu</button>
        </PopoverTrigger>
        <PopoverContent>a popover</PopoverContent>
      </Popover>,
    )
    await screen.findByText('a popover')
    // Radix gives a popover `role="dialog"` too; it is not a modal.
    expect(document.querySelectorAll('[role="dialog"]').length).toBeGreaterThan(0)
    await user.keyboard('{Control>}k{/Control}')
    await waitFor(() => expect(usePalette.getState().open).toBe(true))
  })

  test('the app dialogs are modal (aria-modal), which is what the shortcut counts', async () => {
    const { user } = setup()
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Some dialog</DialogTitle>
        </DialogContent>
      </Dialog>,
    )
    await screen.findByText('Some dialog')
    expect(document.querySelector('[aria-modal="true"]')).not.toBeNull()
    await user.keyboard('{Control>}k{/Control}')
    expect(usePalette.getState().open).toBe(false)
  })

  test('one list: no mode switch; the placeholder names content and actions; opening "actions" shows the same list', async () => {
    const { user } = setup()
    const input = await openSearch(user)
    expect(input).toHaveAttribute('placeholder', 'Find objects and commands, or paste')
    expect(screen.queryByRole('button', { name: /Switch to/ })).toBeNull()
    expect(document.querySelector('[data-palette-info]')).not.toBeNull()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(usePalette.getState().open).toBe(false))
    act(() => usePalette.getState().show('actions'))
    expect(await screen.findByPlaceholderText(PALETTE_TEXT.placeholder)).toBeInTheDocument()
  })
})

describe('search mode', () => {
  test('empty query lists recent objects in Today / Earlier groups, type at the right; no actions; empty recents state', async () => {
    const now = Date.now()
    useRecent.setState({
      paths: ['People/Bea.md', 'Gone/Missing.md', 'Tasks/Todo.md', 'Pages/Alpha.md'],
      // Alpha was stored before open times existed: Earlier.
      openedAt: { 'People/Bea.md': now, 'Gone/Missing.md': now, 'Tasks/Todo.md': now - 3 * 86_400_000 },
    })
    const { user } = setup()
    await openSearch(user)
    const today = screen.getByText('Today').closest('[cmdk-group]') as HTMLElement
    expect(within(today).getAllByRole('option').map((i) => i.textContent)).toEqual(['BeaPerson'])
    const earlier = screen.getByText('Earlier').closest('[cmdk-group]') as HTMLElement
    expect(within(earlier).getAllByRole('option').map((i) => i.textContent)).toEqual(['TodoTask', 'AlphaPage'])
    // The type name is the row's last, right-hand element.
    const bea = within(today).getByRole('option')
    expect(bea.lastElementChild?.textContent).toBe('Person')
    expect(document.querySelector('[data-action]')).toBeNull()
    expect(mocked.search).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    useRecent.setState({ paths: ['People/Bea.md'], openedAt: { 'People/Bea.md': now } })
    await openSearch(user)
    expect(screen.queryByText('Earlier')).toBeNull()
    await user.keyboard('{Escape}')
    useRecent.setState({ paths: [], openedAt: {} })
    await openSearch(user)
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument()
    expect(screen.getByText('Recently opened objects appear here.')).toBeInTheDocument()
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
    // Palette result titles use the 600-weight `search-highlights-bold` variant.
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
    // M7: Shift opens the side panel; Alt+Shift keeps the peek.
    expect(usePeek.getState().path).toBeNull()
    const tab = useTabs.getState().tabs.find((t) => t.id === useTabs.getState().activeId)!
    expect(tab.sidepanel?.find((e) => e.isOpen)?.target).toEqual({ kind: 'object', path: 'Pages/Alpha.md' })
    expect(useTabs.getState().tabs).toHaveLength(2)
  })

  test('a recent row: enter opens, ctrl+enter in a new tab, shift+enter in the side panel', async () => {
    useRecent.setState({ paths: ['Pages/Alpha.md'], openedAt: { 'Pages/Alpha.md': Date.now() } })
    const { user } = setup()
    await openSearch(user)
    await user.keyboard('{Enter}')
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Pages/Alpha.md' })
    expect(useTabs.getState().tabs).toHaveLength(1)

    await openSearch(user)
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(usePalette.getState().open).toBe(false)
    expect(useTabs.getState().tabs).toHaveLength(2)

    await openSearch(user)
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    const tab = useTabs.getState().tabs.find((t) => t.id === useTabs.getState().activeId)!
    expect(tab.sidepanel?.find((e) => e.isOpen)?.target).toEqual({ kind: 'object', path: 'Pages/Alpha.md' })
    expect(useTabs.getState().tabs).toHaveLength(2)
  })

  test('content and actions in one list: results first, then matching actions labelled "Action"', async () => {
    mocked.search.mockResolvedValue({ results: [searchResult({ path: 'Pages/Alpha.md', title: 'Calendar notes' })], partial: false })
    const { user } = setup()
    const input = await openSearch(user)
    await user.type(input, 'calendar')
    await screen.findByText('Calendar notes')
    const rows = screen.getAllByRole('option')
    const resultAt = rows.findIndex((r) => r.hasAttribute('data-search-result'))
    const actionAt = rows.findIndex((r) => r.getAttribute('data-action') === 'openCalendar')
    expect(resultAt).toBe(0)
    expect(actionAt).toBeGreaterThan(resultAt)
    expect(rows[actionAt].textContent).toBe('Open calendarAction')
    expect(rows.some((r) => r.textContent?.startsWith('Create Person'))).toBe(false)
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
    await user.click(await screen.findByText('Limit results to the tag "work"'))
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
    expect(screen.getByText('Try other words, or clear a filter to see more.')).toBeInTheDocument()
    expect(
      screen.getByText('Indexing is still running, so some matches may be missing.'),
    ).toBeInTheDocument()
  })
})

describe('actions in the list', () => {
  /** Open the palette, type `q`, and return the action row `id` once it shows. */
  async function findAction(user: ReturnType<typeof userEvent.setup>, q: string, id: string): Promise<HTMLElement> {
    const input = await openSearch(user)
    await user.type(input, q)
    return waitFor(() => {
      const el = document.querySelector(`[data-action="${id}"]`)
      if (!el) throw new Error(`no action ${id}`)
      return el as HTMLElement
    })
  }

  function actionLabels(): string[] {
    return [...document.querySelectorAll('[data-action]')].map((o) => o.querySelector('[data-action-label]')?.textContent ?? '')
  }

  test('typing lists the matching actions in their order, each with "Action" at the right', async () => {
    const { user } = setup()
    const input = await openSearch(user)
    await user.type(input, 'create')
    await waitFor(() => expect(actionLabels()).toEqual(['Create Page', 'Create Person', 'Create Tag', 'Create Task']))
    for (const row of document.querySelectorAll('[data-action]')) expect(row.lastElementChild?.textContent).toBe('Action')
    await user.clear(input)
    await user.type(input, 'toggle')
    await waitFor(() => expect(actionLabels()).toEqual(['Toggle focus mode', 'Toggle left sidebar', 'Toggle right side panel']))
  })

  test('a matching action keeps "No results" away; no match at all shows it', async () => {
    const { user } = setup()
    const input = await openSearch(user)
    await user.type(input, 'settings')
    await waitFor(() => expect(mocked.search).toHaveBeenCalled())
    await waitFor(() => expect(actionLabels()).toEqual(['Open settings']))
    expect(screen.queryByText('No results for "settings"')).toBeNull()
    await user.clear(input)
    await user.type(input, 'zzz')
    expect(await screen.findByText('No results for "zzz"')).toBeInTheDocument()
  })

  test('actions are left out while a type or tag filter is set', async () => {
    const { user } = setup()
    const input = await openSearch(user)
    await user.type(input, 'peo')
    await user.click(await screen.findByText('Only search for type "Person"'))
    await user.type(input, 'calendar')
    await waitFor(() => expect(mocked.search).toHaveBeenLastCalledWith('calendar', expect.objectContaining({ types: ['person'] })))
    expect(document.querySelector('[data-action]')).toBeNull()
  })

  test("each action's effect", async () => {
    const { user, p } = setup()
    await user.click(await findAction(user, 'calendar', 'openCalendar'))
    expect(usePalette.getState().open).toBe(false)
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'calendar' })

    useCalendar.setState({ view: 'month', anchor: '2001-01-01' })
    await user.click(await findAction(user, 'today', 'openToday'))
    expect(useCalendar.getState()).toMatchObject({ view: 'day', anchor: todayYmd() })
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'calendar' })
    expect(mocked.createDailyNote).not.toHaveBeenCalled()

    await user.click(await findAction(user, 'global graph', 'openGlobalGraph'))
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'graph' })

    await user.click(await findAction(user, 'left sidebar', 'toggleLeftSidebar'))
    expect(p.onToggleSidebar).toHaveBeenCalledTimes(1)

    await user.click(await findAction(user, 'right side panel', 'toggleSidepanel'))
    expect(p.onToggleRightPanel).toHaveBeenCalledTimes(1)

    useFocusMode.setState({ on: false })
    await user.click(await findAction(user, 'focus', 'toggleFocusMode'))
    expect(usePalette.getState().open).toBe(false)
    expect(useFocusMode.getState().on).toBe(true)
    useFocusMode.getState().leave()

    await user.click(await findAction(user, 'create person', 'create:person'))
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('person', {}))
    expect(mocked.createObject).toHaveBeenCalledTimes(1)
  })

  test('Enter runs the selected action', async () => {
    const { user } = setup()
    const input = await openSearch(user)
    await user.type(input, 'open calendar')
    await waitFor(() => expect(actionLabels()).toEqual(['Open calendar']))
    // Results come first; with none, the action is the first row.
    await waitFor(() => expect(screen.getAllByRole('option')[0]).toHaveAttribute('data-action', 'openCalendar'))
    await user.keyboard('{Enter}')
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'calendar' })
  })

  test('open graph view only offered with an object open', async () => {
    const { user, p } = setup()
    const input = await openSearch(user)
    await user.type(input, 'graph view')
    await waitFor(() => expect(mocked.search).toHaveBeenCalled())
    expect(document.querySelector('[data-action="openGraphView"]')).toBeNull()
    await user.keyboard('{Escape}')

    act(() => useTabs.getState().open({ kind: 'object', path: 'Pages/Alpha.md' }))
    await user.click(await findAction(user, 'graph view', 'openGraphView'))
    expect(p.onShowRightPanel).toHaveBeenCalledTimes(1)
  })
})

test('palette string templates', () => {
  expect(PALETTE_TEXT.placeholder).toBe('Find objects and commands, or paste')
  expect(PALETTE_TEXT.emptyTitle('q')).toBe('No results for "q"')
  expect(PALETTE_TEXT.createNewWithTitle('Page', 't')).toBe('Create new Page with title "t"')
  expect(PALETTE_TEXT.typeFilter('X')).toBe('Only search for type "X"')
  expect(PALETTE_TEXT.typeFilterExclude('X')).toBe('Exclude type "X"')
  expect(PALETTE_TEXT.tagFilter('x')).toBe('Limit results to the tag "x"')
  expect(ACTION_TEXT.createNewEntity('Page')).toBe('Create Page')
})
