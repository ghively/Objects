import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Query } from '@/api/types'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { objectSummary, propertyDef, query, row, searchResult, typeDef } from '@/test/mockApi'
import { useDefs } from '@/types/useDefinitions'
import { SEARCH_PAGE_TEXT, SearchPage, searchDefinition } from './SearchPage'
import { openExtendedSearch } from './openSearch'

const mocked = vi.mocked(api)
const STRINGS_FILE = '../../../docs/strings.txt'

const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true, propertyDefinitions: [TITLE] })
const TAG = typeDef({ id: 'tag', name: 'Tag', pluralName: 'Tags', basic: true, propertyDefinitions: [TITLE] })
const ALPHA = objectSummary({ path: 'Pages/Alpha.md', title: 'Alpha', type: 'page' })
const BETA = objectSummary({ path: 'Pages/Beta.md', title: 'Beta', type: 'page' })
const WORK = objectSummary({ path: 'Tags/work.md', title: 'work', type: 'tag', id: 'tag-work' })

beforeAll(() => {
  Element.prototype.scrollIntoView ??= function () {}
})

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  useDefs.setState({ collections: [], queries: [], loaded: true })
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.collections.mockResolvedValue([])
  mocked.queries.mockResolvedValue([])
  mocked.search.mockResolvedValue({
    results: [
      searchResult({ path: 'Pages/Beta.md', title: 'Beta', type: 'page', highlights: [{ field: 'blocksContent', snippets: ['the \u0002alpha\u0003 word'] }] }),
      searchResult({ path: 'Pages/Alpha.md', title: 'Alpha', type: 'page', titleMatches: [[0, 5]] }),
    ],
    partial: false,
  })
  mocked.rows.mockImplementation(async (scope) =>
    [ALPHA, BETA].filter((s) => scope?.paths?.includes(s.path)).map((s) => row({ summary: s, version: `v-${s.title}` })),
  )
  useLinkIndex.setState({ types: [PAGE, TAG], objects: [ALPHA, BETA, WORK], loaded: true })
})

const lastSearch = () => mocked.search.mock.calls.at(-1)

/** The debounced search and the row load can take a few seconds under a loaded suite. */
const ASYNC = { timeout: 5_000 }

describe('SearchPage', () => {
  test('strings match the reference', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.resolve(__dirname, STRINGS_FILE), 'utf8')
    for (const s of Object.values(SEARCH_PAGE_TEXT)) expect(src).toContain('`' + s + '`')
  })

  test('shows the empty state without a keyword', () => {
    render(<SearchPage />)
    expect(screen.getByRole('heading', { name: 'Search' })).toBeTruthy()
    expect(screen.getByText('Enter a search keyword to show content from your space.')).toBeTruthy()
    expect(mocked.search).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: /Save as Query/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('search page runs the query and shows results', async () => {
    render(<SearchPage q="alpha" />)
    // The search runs after the page's debounce, then the rows load: under a loaded suite that
    // chain can take longer than the testing library's 1 s default, so wait for each step.
    await waitFor(() => expect(mocked.search).toHaveBeenCalled(), ASYNC)
    expect(lastSearch()?.[0]).toBe('alpha')
    expect(lastSearch()?.[1]).toMatchObject({ mode: 'auto' })
    await waitFor(() => expect(mocked.rows).toHaveBeenCalledWith({ paths: ['Pages/Beta.md', 'Pages/Alpha.md'] }), ASYNC)
    // Rows come in the server's rank order, with the full-text snippet beside them: wait for the
    // render that shows both rows, then check it as a whole.
    await waitFor(() => {
      const titles = [...document.querySelectorAll('ul[role="list"] li')].map((li) => li.textContent ?? '')
      expect(titles).toHaveLength(2)
      expect(titles[0]).toContain('Beta')
      expect(titles[1]).toContain('Alpha')
    }, ASYNC)
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(document.querySelector('.search-page-snippet b')?.textContent).toBe('alpha')
  }, 15_000)

  test('text matches only sends full text mode', async () => {
    const user = userEvent.setup()
    render(<SearchPage q="alpha" />)
    await waitFor(() => expect(mocked.search).toHaveBeenCalled())
    await user.click(screen.getByRole('switch', { name: 'Text matches only' }))
    await waitFor(() => expect(lastSearch()?.[1]).toMatchObject({ mode: 'fullText' }))
    expect(lastSearch()?.[0]).toBe('alpha')
  })

  test('opens with text matches only from the target', async () => {
    render(<SearchPage q="alpha" textOnly />)
    await waitFor(() => expect(lastSearch()?.[1]).toMatchObject({ mode: 'fullText' }))
  })

  test('save as query creates and opens the query', async () => {
    const user = userEvent.setup()
    let resolve!: (q: Query) => void
    mocked.createQuery.mockReturnValue(new Promise<Query>((r) => (resolve = r)))
    render(<SearchPage q="alpha" textOnly />)
    await screen.findByText('Alpha')
    await user.click(screen.getByRole('button', { name: /Save as Query/ }))
    expect(screen.getByRole('button', { name: /Saving\.\.\./ })).toBeTruthy()
    expect(mocked.createQuery).toHaveBeenCalledTimes(1)
    const init = mocked.createQuery.mock.calls[0][0]!
    expect(init.name).toBeUndefined()
    expect(init.definition).toMatchObject({
      structures: [],
      search: { searchTerms: [{ text: 'alpha' }], searchMode: 'fullText' },
    })
    resolve(query({ id: 'q-new', name: 'New Query' }))
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'query', id: 'q-new' }))
  })

  test('type and tag filters apply to the search and the saved query', async () => {
    const user = userEvent.setup()
    mocked.createQuery.mockResolvedValue(query({ id: 'q2', name: 'New Query' }))
    render(<SearchPage q="alpha page" />)
    await user.click(await screen.findByRole('button', { name: 'Only search for type "Page"' }))
    await waitFor(() => expect(lastSearch()?.[1]).toMatchObject({ types: ['page'] }))
    expect(lastSearch()?.[0]).toBe('alpha')
    await user.click(screen.getByRole('button', { name: /Save as Query/ }))
    await waitFor(() => expect(mocked.createQuery).toHaveBeenCalled())
    expect(mocked.createQuery.mock.calls[0][0]!.definition).toMatchObject({
      structures: [{ id: 'page' }],
      search: { searchTerms: [{ text: 'alpha' }], searchMode: 'auto' },
    })
  })

  test('search definition maps excluded types and a tag to its id', () => {
    const def = searchDefinition(' alpha ', false, { types: [], excludeTypes: ['tag'], tag: 'work' }, (n) => (n === 'work' ? 'tag-work' : null))
    expect(def).toEqual({
      structures: [],
      excludeStructureIds: ['tag'],
      tags: { ids: ['tag-work'], operator: 'or' },
      search: { searchTerms: [{ text: 'alpha' }], searchMode: 'auto' },
    })
  })

  test('openExtendedSearch opens the search target in the current tab', () => {
    openExtendedSearch('alpha', true)
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'search', q: 'alpha', textOnly: true })
  })
})
