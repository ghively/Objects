import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { DeviceSettings, References } from '@/api/types'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { objectSummary, references, typeDef } from '@/test/mockApi'
import { ReferencesSection } from './ReferencesSection'
import { referencesKey, referencesSettings, visibleTabs } from './referencesUi'

const mocked = vi.mocked(api)

const SELF = objectSummary({ path: 'Pages/Self.md', id: 'self-id', title: 'Self' })
const PERSON_SELF = objectSummary({ path: 'People/Self.md', id: 'person-self', title: 'Person self', type: 'person' })

const summaries = {
  'Pages/Alpha.md': objectSummary({ path: 'Pages/Alpha.md', title: 'Alpha' }),
  'Pages/Gamma.md': objectSummary({ path: 'Pages/Gamma.md', title: 'Gamma' }),
  'Pages/Delta.md': objectSummary({ path: 'Pages/Delta.md', title: 'Delta' }),
}

const NESTED = {
  context: 'Then Self about it',
  start: 5,
  end: 9,
  ancestors: ['Project notes', 'Phase one'],
}

const FULL: References = references({
  tabs: ['all', 'backlinks', 'related', 'mentions'],
  backlinks: [{ path: 'Pages/Alpha.md', contexts: [NESTED], properties: [] }],
  mentions: [
    {
      path: 'Pages/Gamma.md',
      version: 'vg1',
      occurrences: [{ start: 10, end: 14, text: 'self', context: 'talk about self here', contextStart: 0 }],
    },
  ],
  related: [{ path: 'Pages/Delta.md', score: 3 }],
  summaries,
})

function setSettings(extra: Record<string, unknown>) {
  useSettings.setState({ settings: { ...settingsDefaults, ...extra } as DeviceSettings })
}

beforeEach(() => {
  localStorage.clear()
  resetLinkIndex()
  useLinkIndex.setState({ types: [typeDef({ id: 'page', name: 'Page' }), typeDef({ id: 'person', name: 'Person' })], objects: [], loaded: true })
  useTabs.getState().reset()
  usePeek.getState().close()
  useSettings.setState({ settings: settingsDefaults })
  mocked.references.mockReset()
  mocked.references.mockResolvedValue(FULL)
})

const renderSection = async (summary = SELF) => {
  const utils = render(<ReferencesSection path={summary.path} summary={summary} />)
  await screen.findByRole('tablist', { name: 'References' })
  return utils
}
const tabLabels = () => screen.getAllByRole('tab').map((t) => t.querySelector('span')?.textContent)
const part = (tab: string) => document.querySelector(`[data-all-part="${tab}"]`) as HTMLElement

describe('ReferencesSection (M8 settings)', () => {
  test('test section defaults open closed hidden', async () => {
    setSettings({ backlinkSectionsDefault: { backlinks: 'open', relatedContent: 'closed', unlinkedMentions: 'hidden' } })
    await renderSection()
    // Hidden: no tab, no part of All.
    expect(tabLabels()).toEqual(['All', 'Backlinks', 'Related Content'])
    expect(part('mentions')).toBeNull()
    // Open shows its content; Closed starts collapsed under its heading.
    expect(part('backlinks')).toHaveAttribute('data-part-open', 'true')
    expect(within(part('backlinks')).getByText('Alpha')).toBeInTheDocument()
    expect(part('related')).toHaveAttribute('data-part-open', 'false')
    expect(within(part('related')).queryByText('Delta')).toBeNull()
    expect(within(part('related')).getByRole('button', { name: 'Related Content' })).toHaveAttribute('aria-expanded', 'false')
    // The tab still shows the section's content when picked.
    await userEvent.setup().click(screen.getByRole('tab', { name: /^Related Content/ }))
    expect(within(screen.getByRole('tabpanel')).getByText('Delta')).toBeInTheDocument()
  })

  test('every shown section closed starts the section closed', async () => {
    setSettings({ backlinkSectionsDefault: { backlinks: 'closed', relatedContent: 'closed', unlinkedMentions: 'closed' } })
    await renderSection()
    expect(screen.queryByRole('tabpanel')).toBeNull()
    expect(screen.getByRole('tab', { name: /^All/ })).toHaveAttribute('aria-expanded', 'false')
  })

  test('every section hidden leaves no references section', async () => {
    setSettings({ backlinkSectionsDefault: { backlinks: 'hidden', relatedContent: 'hidden', unlinkedMentions: 'hidden' } })
    const { container } = render(<ReferencesSection path={SELF.path} summary={SELF} />)
    await vi.waitFor(() => expect(mocked.references).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(container).toBeEmptyDOMElement()
  })

  test('test per object state wins over default', async () => {
    const user = userEvent.setup()
    setSettings({ backlinkSectionsDefault: { backlinks: 'closed', relatedContent: 'open', unlinkedMentions: 'open' } })
    const first = await renderSection()
    expect(part('backlinks')).toHaveAttribute('data-part-open', 'false')
    await user.click(within(part('backlinks')).getByRole('button', { name: 'Backlinks' }))
    expect(part('backlinks')).toHaveAttribute('data-part-open', 'true')
    expect(JSON.parse(localStorage.getItem(referencesKey('self-id'))!)).toEqual({
      tab: 'all',
      closed: false,
      parts: { backlinks: true },
    })
    first.unmount()
    await renderSection()
    expect(part('backlinks')).toHaveAttribute('data-part-open', 'true')

    // A saved open section stays open even when every default says Closed.
    act(() =>
      setSettings({ backlinkSectionsDefault: { backlinks: 'closed', relatedContent: 'closed', unlinkedMentions: 'closed' } }),
    )
    expect(screen.getByRole('tabpanel')).toBeInTheDocument()
    expect(part('backlinks')).toHaveAttribute('data-part-open', 'true')
    expect(part('related')).toHaveAttribute('data-part-open', 'false')
  })

  test('test nested backlink full path above', async () => {
    const user = userEvent.setup()

    // Default: only the block; the per-backlink toggle switches to the full path.
    await renderSection()
    const block = part('backlinks').querySelector('[data-backlink-block]') as HTMLElement
    expect(block.querySelector('[data-backlink-ancestors]')).toBeNull()
    const group = within(block).getByRole('group', { name: 'Default display of nested backlinks' })
    expect(within(group).getByRole('button', { name: 'Only block with backlink' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(group).getByRole('button', { name: 'Full path above' }))
    const lines = [...block.querySelectorAll('[data-backlink-ancestor]')].map((el) => el.textContent)
    expect(lines).toEqual(['Project notes', 'Phase one'])
    expect(block.querySelector('[data-backlink-context]')?.textContent).toBe('Then Self about it')
  })

  test('the full path setting shows parents first; top-level backlinks have no toggle', async () => {
    setSettings({ nestedBacklinkView: 'showFullPathAbove', backlinkContentView: 'wideCard' })
    mocked.references.mockResolvedValue({
      ...FULL,
      backlinks: [{ path: 'Pages/Alpha.md', contexts: [NESTED, { context: 'Top Self', start: 4, end: 8 }], properties: [] }],
    })
    await renderSection()
    const [nested, top] = [...part('backlinks').querySelectorAll('[data-backlink-block]')] as HTMLElement[]
    expect([...nested.querySelectorAll('[data-backlink-ancestor]')].map((el) => el.textContent)).toEqual([
      'Project notes',
      'Phase one',
    ])
    expect(within(top).queryByRole('group', { name: 'Default display of nested backlinks' })).toBeNull()
    // "Backlink content view" sets how the block renders.
    expect(top.querySelector('[data-backlink-context]')).toHaveAttribute('data-backlink-view', 'wideCard')
  })

  test('test related content hidden for listed types', async () => {
    setSettings({ relatedContentHiddenTypes: ['person'] })
    const first = await renderSection(PERSON_SELF)
    expect(tabLabels()).toEqual(['All', 'Backlinks', 'Mentions'])
    expect(part('related')).toBeNull()
    first.unmount()
    await renderSection(SELF)
    expect(tabLabels()).toEqual(['All', 'Backlinks', 'Related Content', 'Mentions'])
  })

  test('settings read tolerantly: bad values fall back to the defaults', () => {
    const s = referencesSettings({
      backlinkSectionsDefault: { backlinks: 'nope' },
      backlinkContentView: 'huge',
      relatedContentHiddenTypes: ['page', 3],
      nestedBacklinkView: null,
    })
    expect(s).toEqual({
      backlinkSectionsDefault: { backlinks: 'open', relatedContent: 'open', unlinkedMentions: 'open' },
      backlinkContentView: 'embed',
      relatedContentHiddenTypes: ['page'],
      nestedBacklinkView: 'showBlockContainingBacklink',
    })
    expect(visibleTabs(['all', 'related', 'relatedTags'], s, 'page')).toEqual(['all', 'relatedTags'])
  })
})
