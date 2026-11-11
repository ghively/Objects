// M9 Task 17: a collection's row menu is the common one, then the collection's own items.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Row } from '@/api/types'
import { collection, objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { useDefs } from '@/types/useDefinitions'
import { CollectionPage } from './CollectionPage'

const mocked = vi.mocked(api)
const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
const SERVER = typeDef({ id: 'server', name: 'Server', pluralName: 'Servers', revision: 'r1', propertyDefinitions: [TITLE] })
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', revision: 'r1', propertyDefinitions: [TITLE] })
const ROWS: Row[] = [
  row({ summary: objectSummary({ path: 'Servers/Alpha.md', type: 'server', title: 'Alpha', collections: ['Tooling'] }), version: 'v-Alpha' }),
]

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  useDefs.setState({ collections: [], queries: [], loaded: false })
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.collections.mockResolvedValue([collection({ id: 'tooling', name: 'Tooling', typeIds: ['server'], revision: 'c1' })])
  mocked.rows.mockResolvedValue(ROWS)
  mocked.queries.mockResolvedValue([])
  mocked.templates.mockResolvedValue([])
  mocked.onChange.mockReturnValue(() => undefined)
  useLinkIndex.setState({ types: [SERVER, PAGE], objects: ROWS.map((r) => r.summary), loaded: true })
})

describe('CollectionPage row menu (Task 17)', () => {
  test('test collection page keeps its items after common ones', async () => {
    const user = userEvent.setup()
    render(<CollectionPage id="tooling" />)
    const alpha = (await screen.findByText('Alpha')).closest('[data-path]') as HTMLElement
    await user.pointer({ keys: '[MouseRight]', target: alpha })
    const menu = await screen.findByTestId('row-menu')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Select multiple',
      'Open in side panel',
      'Open in new tab',
      'Change type',
      'Copy reference',
      'Duplicate',
      'Delete',
      'Pin to collection',
      'Remove from collection',
    ])
  })
})
