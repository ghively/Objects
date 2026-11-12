import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { References } from '@/api/types'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ApiError, ConflictError } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { resetOpenAsFullPage, setOpenAsFullPage } from '@/test/fullPage'
import { objectSummary, references, typeDef } from '@/test/mockApi'
import { ReferencesSection } from './ReferencesSection'

const mocked = vi.mocked(api)

const SELF = objectSummary({ path: 'People/Ada.md', id: 'ada', title: 'Ada', type: 'person' })

const DATA: References = references({
  tabs: ['all', 'backlinks', 'related', 'mentions'],
  mentions: [
    {
      path: 'Pages/Notes.md',
      version: 'v7',
      occurrences: [
        { start: 18, end: 21, text: 'Ada', context: 'Lunch with Ada.', contextStart: 7 },
        { start: 40, end: 43, text: 'ada', context: 'and ada again', contextStart: 36 },
      ],
    },
    {
      path: 'Pages/Log.md',
      version: 'v3',
      occurrences: [{ start: 0, end: 3, text: 'ADA', context: 'ADA called', contextStart: 0 }],
    },
  ],
  summaries: {
    'Pages/Notes.md': objectSummary({ path: 'Pages/Notes.md', title: 'Notes' }),
    'Pages/Log.md': objectSummary({ path: 'Pages/Log.md', title: 'Log' }),
  },
})

beforeEach(() => {
  localStorage.clear()
  resetLinkIndex()
  useLinkIndex.setState({ types: [typeDef({ id: 'page', name: 'Page' })], objects: [], loaded: true })
  usePeek.getState().close()
  useTabs.getState().reset()
  resetOpenAsFullPage()
  localStorage.setItem('object.references:ada', JSON.stringify({ tab: 'mentions', closed: false }))
  mocked.references.mockReset()
  mocked.references.mockResolvedValue(DATA)
  mocked.linkMention.mockReset()
  mocked.linkMention.mockResolvedValue({ version: 'v8' })
  mocked.onChange.mockImplementation(() => () => undefined)
})

const setup = async () => {
  const user = userEvent.setup()
  render(<ReferencesSection path={SELF.path} summary={SELF} />)
  await screen.findByText('Notes')
  mocked.references.mockClear()
  return user
}

describe('MentionsTab', () => {
  test('occurrences show their context with the match highlighted', async () => {
    await setup()
    const occ = document.querySelectorAll('[data-mention="Pages/Notes.md"] [data-occurrence]')
    expect(occ).toHaveLength(2)
    const first = occ[0].querySelector('.search-highlights') as HTMLElement
    expect(first.textContent).toBe('Lunch with Ada.')
    expect(first.querySelector('b')?.textContent).toBe('Ada')
    expect(occ[1].querySelector('b')?.textContent).toBe('ada')
    expect(screen.getAllByRole('button', { name: 'Link' })).toHaveLength(3)
  })

  test('an emoji before the match does not shift the highlight; link offsets are sent unchanged', async () => {
    mocked.references.mockResolvedValue(
      references({
        tabs: ['all', 'backlinks', 'related', 'mentions'],
        mentions: [
          {
            path: 'Pages/Notes.md',
            version: 'v7',
            occurrences: [{ start: 12, end: 15, text: 'Ada', context: '🚀 with Ada.', contextStart: 5 }],
          },
        ],
        summaries: { 'Pages/Notes.md': objectSummary({ path: 'Pages/Notes.md', title: 'Notes' }) },
      }),
    )
    const user = await setup()
    const occ = document.querySelector('[data-mention="Pages/Notes.md"] [data-occurrence]')!
    expect(occ.querySelector('b')?.textContent).toBe('Ada')
    expect(occ.querySelector('.search-highlights')?.textContent).toBe('🚀 with Ada.')
    await user.click(screen.getByRole('button', { name: 'Link' }))
    expect(mocked.linkMention).toHaveBeenCalledWith(expect.objectContaining({ start: 12, end: 15 }))
  })

  test('link a mention sends version and reloads', async () => {
    const user = await setup()
    await user.click(screen.getAllByRole('button', { name: 'Link' })[1])
    expect(mocked.linkMention).toHaveBeenCalledTimes(1)
    expect(mocked.linkMention).toHaveBeenCalledWith({
      path: 'Pages/Notes.md',
      target: 'People/Ada.md',
      start: 40,
      end: 43,
      text: 'ada',
      baseVersion: 'v7',
    })
    await waitFor(() => expect(mocked.references).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('status')).toHaveTextContent('Link created')
    expect(mocked.linkMention).toHaveBeenCalledTimes(1)
  })

  test('409 on link reloads without retry', async () => {
    mocked.linkMention.mockRejectedValue(new ConflictError('v9'))
    const user = await setup()
    await user.click(screen.getAllByRole('button', { name: 'Link' })[2])
    await waitFor(() => expect(mocked.references).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('status')).toHaveTextContent('Changed elsewhere. Reloaded.')
    expect(mocked.linkMention).toHaveBeenCalledTimes(1)
    expect(mocked.linkMention.mock.calls[0][0]).toMatchObject({ path: 'Pages/Log.md', baseVersion: 'v3' })
  })

  test('422 (text moved) reloads without retry', async () => {
    mocked.linkMention.mockRejectedValue(new ApiError(422, 'The text has changed. Reload and try again.'))
    const user = await setup()
    await user.click(screen.getAllByRole('button', { name: 'Link' })[0])
    await waitFor(() => expect(mocked.references).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('status')).toHaveTextContent('Changed elsewhere. Reloaded.')
    expect(mocked.linkMention).toHaveBeenCalledTimes(1)
  })

  test('a second click while linking sends nothing more', async () => {
    let finish: (v: { version: string }) => void = () => undefined
    mocked.linkMention.mockImplementation(() => new Promise((r) => (finish = r)))
    const user = await setup()
    const buttons = screen.getAllByRole('button', { name: 'Link' })
    await user.click(buttons[0])
    await user.click(buttons[1])
    expect(mocked.linkMention).toHaveBeenCalledTimes(1)
    finish({ version: 'v8' })
    await waitFor(() => expect(mocked.references).toHaveBeenCalledTimes(1))
  })

  test('a mention context click opens the note as a full page (M32)', async () => {
    const user = await setup()
    await user.click(document.querySelector('[data-mention="Pages/Log.md"] [data-occurrence] button') as HTMLElement)
    expect(usePeek.getState().path).toBeNull()
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Pages/Log.md' })
  })

  test('with full pages off a mention context click peeks with the mentions list', async () => {
    setOpenAsFullPage(false)
    const user = await setup()
    await user.click(document.querySelector('[data-mention="Pages/Log.md"] [data-occurrence] button') as HTMLElement)
    expect(usePeek.getState().path).toBe('Pages/Log.md')
    expect(usePeek.getState().list).toEqual(['Pages/Notes.md', 'Pages/Log.md'])
  })
})

// M33, choice 11: a mention reads as text, and a line that names the note twice is listed once.
describe('MentionsTab: a mention reads as text and a line is listed once (M33)', () => {
  const NOTES = 'Pages/Notes.md'
  /** A stand-in for the mentioning note's file: `link` rewrites it as the back end does. */
  let file: { body: string; version: number }

  /** The occurrences of "Ada" the back end sends for the body: one per match, with its line. */
  function occurrencesOf(body: string) {
    const out = []
    for (const m of body.matchAll(/(?<![\w[|])Ada(?![\w\]|])/g)) {
      const start = m.index
      const ls = body.lastIndexOf('\n', start - 1) + 1
      const le = body.indexOf('\n', start) < 0 ? body.length : body.indexOf('\n', start)
      out.push({ start, end: start + 3, text: 'Ada', context: body.slice(ls, le), contextStart: ls })
    }
    return out
  }

  function serve(body: string) {
    file = { body, version: 7 }
    mocked.references.mockImplementation(async () =>
      references({
        tabs: ['all', 'backlinks', 'related', 'mentions'],
        mentions: occurrencesOf(file.body).length ? [{ path: NOTES, version: `v${file.version}`, occurrences: occurrencesOf(file.body) }] : [],
        summaries: { [NOTES]: objectSummary({ path: NOTES, title: 'Notes' }) },
      }),
    )
    // The back end's link: one write that replaces exactly those characters, on the version sent.
    mocked.linkMention.mockImplementation(async ({ start, end, text, baseVersion }) => {
      if (baseVersion !== `v${file.version}`) throw new ConflictError(`v${file.version}`)
      if (file.body.slice(start, end) !== text) throw new ApiError(422, 'The text has changed. Reload and try again.')
      file = { body: `${file.body.slice(0, start)}[[${text}]]${file.body.slice(end)}`, version: file.version + 1 }
      return { version: `v${file.version}` }
    })
  }

  const rows = () => [...document.querySelectorAll(`[data-mention="${NOTES}"] [data-occurrence]`)] as HTMLElement[]
  const shown = (row: HTMLElement) => row.querySelector('.search-highlights') as HTMLElement
  const highlighted = (row: HTMLElement) => [...shown(row).querySelectorAll('b')].map((b) => b.textContent)

  test('a link in the line shows its words (the alias when there is one), and the name is still highlighted', async () => {
    serve('First.\n- Lunch with **Ada** and [[Fix printer]], see [[Alpha|the first page]].\n')
    await setup()
    expect(rows()).toHaveLength(1)
    expect(shown(rows()[0]).textContent).toBe('Lunch with Ada and Fix printer, see the first page.')
    expect(highlighted(rows()[0])).toEqual(['Ada'])
    expect(shown(rows()[0]).textContent).not.toContain('[[')
  })

  test('a line that names the note twice is one row, both names highlighted, with one Link', async () => {
    serve('Intro.\nAda met Ada in the mirror.\nLater Ada left.\n')
    await setup()
    expect(rows()).toHaveLength(2)
    expect(shown(rows()[0]).textContent).toBe('Ada met Ada in the mirror.')
    expect(highlighted(rows()[0])).toEqual(['Ada', 'Ada'])
    expect(rows()[0]).toHaveAttribute('data-occurrences', '2')
    expect(shown(rows()[1]).textContent).toBe('Later Ada left.')
    expect(screen.getAllByRole('button', { name: 'Link' })).toHaveLength(2)
  })

  test('Link on that row links both names, the last one first, each on the version the one before answered', async () => {
    serve('Intro.\nAda met Ada in the mirror.\nLater Ada left.\n')
    const user = await setup()
    await user.click(within(rows()[0]).getByRole('button', { name: 'Link' }))
    await waitFor(() => expect(mocked.linkMention).toHaveBeenCalledTimes(2))
    expect(mocked.linkMention.mock.calls.map(([c]) => c)).toEqual([
      { path: NOTES, target: 'People/Ada.md', start: 15, end: 18, text: 'Ada', baseVersion: 'v7' },
      { path: NOTES, target: 'People/Ada.md', start: 7, end: 10, text: 'Ada', baseVersion: 'v8' },
    ])
    // The file's line reads right, and nothing else in it changed.
    expect(file.body).toBe('Intro.\n[[Ada]] met [[Ada]] in the mirror.\nLater Ada left.\n')
    expect(await screen.findByRole('status')).toHaveTextContent('Link created')
    // One reload, and the line that is left is the one row.
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(mocked.references).toHaveBeenCalledTimes(1)
    expect(shown(rows()[0]).textContent).toBe('Later Ada left.')
    expect(mocked.linkMention).toHaveBeenCalledTimes(2)
  })

  test('if the file changes between the two, the first stays linked, nothing is guessed, and the row is offered again', async () => {
    serve('Ada met Ada in the mirror.\n')
    const user = await setup()
    const link = mocked.linkMention.getMockImplementation()!
    mocked.linkMention.mockImplementationOnce(async (input) => {
      const res = await link(input)
      // Somebody else writes the note before the second link.
      file = { body: `Hello. ${file.body}`, version: file.version + 1 }
      return res
    })
    await user.click(screen.getByRole('button', { name: 'Link' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Changed elsewhere. Reloaded.')
    expect(mocked.linkMention).toHaveBeenCalledTimes(2)
    expect(file.body).toBe('Hello. Ada met [[Ada]] in the mirror.\n')
    // Reloaded: the one mention that is left has its row and its Link.
    await waitFor(() => expect(shown(rows()[0]).textContent).toBe('Hello. Ada met Ada in the mirror.'))
    expect(highlighted(rows()[0])).toEqual(['Ada'])
    expect(screen.getByRole('button', { name: 'Link' })).toBeEnabled()
  })

  test('a name inside a code span or a link is not a mention, as before: only the plain one is highlighted and linked', async () => {
    // The back end leaves those out (it sends one occurrence here); the row shows them as written or as the link's words.
    const body = 'In code `Ada` stays, [[Ada Lovelace|Ada]] is a link, and Ada is neither.\n'
    file = { body, version: 7 }
    const start = body.lastIndexOf('Ada')
    mocked.references.mockResolvedValue(
      references({
        tabs: ['all', 'backlinks', 'related', 'mentions'],
        mentions: [{ path: NOTES, version: 'v7', occurrences: [{ start, end: start + 3, text: 'Ada', context: body.trimEnd(), contextStart: 0 }] }],
        summaries: { [NOTES]: objectSummary({ path: NOTES, title: 'Notes' }) },
      }),
    )
    const user = await setup()
    expect(rows()).toHaveLength(1)
    expect(shown(rows()[0]).textContent).toBe('In code `Ada` stays, Ada is a link, and Ada is neither.')
    const bold = [...shown(rows()[0]).querySelectorAll('b')]
    expect(bold).toHaveLength(1)
    // The highlighted one is the last "Ada" of the shown text.
    expect(bold[0].nextSibling?.textContent).toBe(' is neither.')
    await user.click(screen.getByRole('button', { name: 'Link' }))
    expect(mocked.linkMention).toHaveBeenCalledTimes(1)
    expect(mocked.linkMention).toHaveBeenCalledWith(expect.objectContaining({ start, end: start + 3, text: 'Ada' }))
  })

  test('the tab still counts notes: one note with a doubled line and another line is "1"', async () => {
    serve('Ada met Ada in the mirror.\nLater Ada left.\n')
    await setup()
    expect(screen.getByRole('tab', { name: /^Mentions/ }).querySelector('[data-tab-count]')?.textContent).toBe('1')
    expect(document.querySelectorAll('[data-mention]')).toHaveLength(1)
  })
})
