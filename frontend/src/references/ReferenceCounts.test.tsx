// The walk's W10 (decision): with the tall body the reference tabs start below the window on every
// note, and nothing above the fold said a note has a backlink or a mention. A quiet count sits
// beside the note's header items, shown only when there is something to count; a click (or Enter)
// scrolls to the references section and opens that tab. It reads what the section already fetched.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { References } from '@/api/types'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { objectSummary, references, typeDef } from '@/test/mockApi'
import { REFERENCE_COUNTS_TEXT, ReferenceCounts } from './ReferenceCounts'
import { ReferencesSection } from './ReferencesSection'
import { referencesKey } from './referencesUi'

const mocked = vi.mocked(api)
const SELF = objectSummary({ path: 'Pages/Self.md', id: 'self-id', title: 'Self' })
const summaries = Object.fromEntries(
  ['Alpha', 'Bea', 'Gamma', 'Delta'].map((t) => [`Pages/${t}.md`, objectSummary({ path: `Pages/${t}.md`, title: t })]),
)
const backlink = (t: string) => ({ path: `Pages/${t}.md`, contexts: [{ context: 'See [[Self]] for more', start: 4, end: 12 }], properties: [] })
const mention = (t: string) => ({
  path: `Pages/${t}.md`,
  version: 'v1',
  occurrences: [{ start: 10, end: 14, text: 'self', context: 'talk about self here', contextStart: 0 }],
})
const refs = (backlinks: string[], mentions: string[]): References =>
  references({ tabs: ['all', 'backlinks', 'related', 'mentions'], backlinks: backlinks.map(backlink), mentions: mentions.map(mention), related: [], summaries })

beforeEach(() => {
  localStorage.clear()
  resetLinkIndex()
  useLinkIndex.setState({ types: [typeDef({ id: 'page', name: 'Page' })], objects: [], loaded: true })
  useSettings.setState({ settings: settingsDefaults })
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.onChange.mockReturnValue(() => undefined)
})

afterEach(() => {
  delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView
})

/** The note's header count and its references section, as the note page holds them. */
function mount(data: References) {
  mocked.references.mockResolvedValue(data)
  return render(
    <div>
      <ReferenceCounts path={SELF.path} />
      <ReferencesSection path={SELF.path} summary={SELF} />
    </div>,
  )
}
const counts = () => screen.queryByTestId('reference-counts')

describe('the count of backlinks and mentions beside the header (W10)', () => {
  test('test a note with no backlink and no mention shows nothing', async () => {
    mount(refs([], []))
    await screen.findByRole('tablist', { name: 'References' })
    expect(counts()).toBeNull()
  })

  test.each([
    [['Alpha'], [], '1 backlink'],
    [['Alpha', 'Bea'], [], '2 backlinks'],
    [[], ['Gamma'], '1 mention'],
    [[], ['Gamma', 'Delta'], '2 mentions'],
    [['Alpha', 'Bea'], ['Gamma'], '2 backlinks · 1 mention'],
    [['Alpha'], ['Gamma', 'Delta'], '1 backlink · 2 mentions'],
  ])('test %j backlinks and %j mentions read "%s"', async (backlinks, mentions, text) => {
    mount(refs(backlinks as string[], mentions as string[]))
    await waitFor(() => expect(counts()).toHaveTextContent(text))
    expect(counts()!.textContent).toBe(text)
    // Each part only when it is not zero.
    expect(within(counts()!).queryAllByRole('button')).toHaveLength(text.includes('·') ? 2 : 1)
  })

  test('test it uses what the references section fetched: one request for the note', async () => {
    mount(refs(['Alpha'], ['Gamma']))
    await waitFor(() => expect(counts()).not.toBeNull())
    expect(mocked.references).toHaveBeenCalledTimes(1)
  })

  test('test a click scrolls to the references section and opens that tab, also when the section was closed', async () => {
    const user = userEvent.setup()
    const scrolled: Element[] = []
    ;(Element.prototype as unknown as Record<string, unknown>).scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    // The person closed the section on this note earlier.
    localStorage.setItem(referencesKey('self-id'), JSON.stringify({ tab: 'all', closed: true }))
    mount(refs(['Alpha', 'Bea'], ['Gamma']))
    await waitFor(() => expect(counts()).not.toBeNull())
    expect(screen.queryByRole('tabpanel')).toBeNull()

    await user.click(within(counts()!).getByRole('button', { name: REFERENCE_COUNTS_TEXT.backlinks(2) }))
    expect(screen.getByRole('tab', { name: /Backlinks/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('data-tabpanel', 'backlinks')
    expect(scrolled).toEqual([document.querySelector('[data-references-section]')])
    // The focus follows, so the keyboard is where the eyes are.
    expect(screen.getByRole('tab', { name: /Backlinks/ })).toHaveFocus()

    // The mentions part opens the Mentions tab; Enter does what a click does.
    const mentions = within(counts()!).getByRole('button', { name: REFERENCE_COUNTS_TEXT.mentions(1) })
    act(() => mentions.focus())
    await user.keyboard('{Enter}')
    expect(screen.getByRole('tab', { name: /Mentions/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('data-tabpanel', 'mentions')
    expect(scrolled).toHaveLength(2)
    // The choice is the note's own view state, as a click on the tab would save it.
    expect(JSON.parse(localStorage.getItem(referencesKey('self-id'))!)).toMatchObject({ tab: 'mentions', closed: false })
  })

  test('test a part whose section the Settings hide is not counted (there would be no tab to open)', async () => {
    // Settings > Backlinks can hide the unlinked mentions section (an M8 setting; not changed here).
    useSettings.setState({
      settings: { ...settingsDefaults, backlinkSectionsDefault: { backlinks: 'open', relatedContent: 'open', unlinkedMentions: 'hidden' } },
    })
    mount(refs(['Alpha'], ['Gamma']))
    await waitFor(() => expect(counts()).not.toBeNull())
    expect(counts()!.textContent).toBe('1 backlink')
    expect(screen.queryByRole('tab', { name: /Mentions/ })).toBeNull()
  })

  test('test the Mentions tab is there as before, whatever the count shows', async () => {
    mount(refs(['Alpha'], []))
    await waitFor(() => expect(counts()).toHaveTextContent('1 backlink'))
    // No mention to count, and the section still has its Mentions tab with its quiet line.
    expect(screen.getByRole('tab', { name: /Mentions/ })).toBeInTheDocument()
    expect(screen.getByText('No unlinked mentions')).toBeInTheDocument()
  })

  // M33, choice 11: a line that names the note twice is one row. The count was, and is, the number
  // of notes that mention this one (neither matches nor lines), so it matches the tab as before.
  test('test the count still matches the Mentions tab when a line names the note twice', async () => {
    const line = 'self talks about self here'
    const doubled = {
      path: 'Pages/Gamma.md',
      version: 'v1',
      occurrences: [
        { start: 0, end: 4, text: 'self', context: line, contextStart: 0 },
        { start: 17, end: 21, text: 'self', context: line, contextStart: 0 },
      ],
    }
    mount(references({ tabs: ['all', 'backlinks', 'related', 'mentions'], mentions: [doubled, mention('Delta')], related: [], summaries }))
    await waitFor(() => expect(counts()).toHaveTextContent('2 mentions'))
    expect(counts()!.textContent).toBe('2 mentions')
    expect(screen.getByRole('tab', { name: /^Mentions/ }).querySelector('[data-tab-count]')?.textContent).toBe('2')
    // Two notes, each listed, the doubled line once.
    expect(document.querySelectorAll('[data-mention]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-mention="Pages/Gamma.md"] [data-occurrence]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-mention="Pages/Gamma.md"] [data-occurrence] b')).toHaveLength(2)
  })

  test('test the count of another note is not shown here, and it goes with the section', async () => {
    mocked.references.mockResolvedValue(refs(['Alpha'], []))
    const { rerender } = render(
      <div>
        <ReferenceCounts path="Pages/Other.md" />
        <ReferencesSection path={SELF.path} summary={SELF} />
      </div>,
    )
    await screen.findByRole('tablist', { name: 'References' })
    expect(counts()).toBeNull()
    rerender(
      <div>
        <ReferenceCounts path={SELF.path} />
        <ReferencesSection path={SELF.path} summary={SELF} />
      </div>,
    )
    expect(counts()).toHaveTextContent('1 backlink')
    rerender(
      <div>
        <ReferenceCounts path={SELF.path} />
      </div>,
    )
    expect(counts()).toBeNull()
  })
})
