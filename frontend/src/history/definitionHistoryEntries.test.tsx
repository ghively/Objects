// M31 item 9: "Version History" opens the definition's history from Object type settings (header),
// a saved query's `…` menu and a collection's `…` menu.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { QueryDefinition } from '@/api/types'
import { collection, defaultViews, propertyDef, query, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/api/d2Api', async (orig) => ({
  ...(await orig<typeof import('@/api/d2Api')>()),
  definitionHistoryApi: { versions: vi.fn(), version: vi.fn(), restore: vi.fn() },
}))

import { api } from '@/api/client'
import { definitionHistoryApi } from '@/api/d2Api'
import { CollectionPage } from '@/collections/CollectionPage'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { QueryPage } from '@/queries/QueryPage'
import { TypeSettings } from '@/types/TypeSettings'
import { useDefs } from '@/types/useDefinitions'
import { DEFINITION_HISTORY as S } from './DefinitionHistoryDialog'

const mocked = vi.mocked(api)
const hist = vi.mocked(definitionHistoryApi)

const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
const SERVER = typeDef({ id: 'server', name: 'Server', pluralName: 'Servers', revision: 'r1', propertyDefinitions: [TITLE] })
const DEF: QueryDefinition = {
  types: [{ id: 'server' }],
  filterGroup: { type: 'filterGroup', operator: 'and', elements: [] },
  sorts: [],
  groupBy: null,
}

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  useDefs.setState({ collections: [], queries: [], loaded: false })
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.rows.mockResolvedValue([])
  mocked.templates.mockResolvedValue([])
  mocked.views.mockResolvedValue({ views: defaultViews(), revision: 'v0' })
  mocked.collections.mockResolvedValue([collection({ id: 'tooling', name: 'Tooling', typeIds: ['server'], revision: 'c1' })])
  mocked.queries.mockResolvedValue([query({ id: 'q1', name: 'Open servers', revision: 'q1r', definition: DEF })])
  useLinkIndex.setState({ types: [SERVER], objects: [], loaded: true })
  hist.versions.mockReset().mockResolvedValue([{ id: 'v1', number: 1, at: '2026-11-09T10:00:00Z', size: 10 }])
  hist.version.mockReset().mockResolvedValue({ id: 'v1', text: '{"name":"Old"}' })
})

async function opens(path: string) {
  const dialog = await screen.findByTestId('definition-history')
  expect(within(dialog).getByRole('heading', { name: S.title })).toBeInTheDocument()
  await waitFor(() => expect(hist.versions).toHaveBeenCalledWith(path))
  expect(await within(dialog).findByText('Version 1')).toBeInTheDocument()
}

describe('Version History entries for definitions', () => {
  test('type settings has Version History in its header', async () => {
    const user = userEvent.setup()
    render(<TypeSettings typeId="server" />)
    await user.click(screen.getByRole('button', { name: S.menuItem }))
    await opens('.object/types/server.json')
  })

  test('a saved query has Version History in its … menu', async () => {
    const user = userEvent.setup()
    render(<QueryPage id="q1" />)
    await user.click(await screen.findByRole('button', { name: 'More' }))
    await user.click(await screen.findByRole('menuitem', { name: S.menuItem }))
    await opens('.object/queries/q1.json')
  })

  test('a collection has Version History in its … menu', async () => {
    const user = userEvent.setup()
    render(<CollectionPage id="tooling" />)
    await user.click(await screen.findByRole('button', { name: 'More' }))
    await user.click(await screen.findByRole('menuitem', { name: S.menuItem }))
    await opens('.object/collections/tooling.json')
  })
})
