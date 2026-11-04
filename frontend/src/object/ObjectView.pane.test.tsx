// Polish item 17: the property-pane toggle (top left of the content column, in the page and the
// peek) hides the pane for that object and remembers it in the object's `hideProperties` key
// (`hideProperties` in the frontmatter).
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpaceInfo, TypeDef } from '@/api/types'
import { objectDetail, objectSummary, propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/find/FindBar', () => ({ FindBar: () => null }))
vi.mock('@/references/ReferencesSection', () => ({ ReferencesSection: () => null }))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { ObjectView } from './ObjectView'

const mocked = vi.mocked(api)
const PAGE: TypeDef = typeDef({
  id: 'page',
  name: 'Page',
  pluralName: 'Pages',
  revision: 'r1',
  propertyDefinitions: [propertyDef({ id: 'title', type: 'entity_title', name: 'Title' }), propertyDef({ id: 'status', type: 'text', name: 'Status' })],
})
const PATH = 'Pages/Notes.md'

function load(frontmatter: Record<string, unknown>) {
  const detail = objectDetail({
    summary: objectSummary({ path: PATH, type: 'page', title: 'Notes' }),
    frontmatter: { type: 'Page', title: 'Notes', ...frontmatter },
    body: 'Hello.\n',
    version: 'v1',
  })
  mocked.objects.mockResolvedValue([detail.summary])
  mocked.object.mockResolvedValue(detail)
}

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE] } satisfies SpaceInfo)
  mocked.resolve.mockResolvedValue(null)
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.updateProperties.mockImplementation(async (_p, updates) => ({
    version: 'v2',
    frontmatter: { type: 'Page', title: 'Notes', ...updates },
    links: {},
  }) as never)
})

describe('property-pane toggle (polish item 17)', () => {
  test('an object saved with hideProperties opens with the pane hidden', async () => {
    load({ hideProperties: true })
    render(<ObjectView path={PATH} mode="peek" />)
    await screen.findByText('Hello.')
    expect(screen.getByRole('button', { name: 'Show properties' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText('Status')).toBeNull()
  })

  test('toggling saves hideProperties on the object, and showing again removes it', async () => {
    const user = userEvent.setup()
    load({})
    render(<ObjectView path={PATH} mode="peek" />)
    await screen.findByText('Hello.')
    expect(screen.getByText('Status')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Hide properties' }))
    expect(screen.queryByText('Status')).toBeNull()
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith(PATH, { hideProperties: true }, 'v1', undefined))
    await user.click(screen.getByRole('button', { name: 'Show properties' }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenLastCalledWith(PATH, { hideProperties: null }, expect.anything(), undefined))
    expect(screen.getByText('Status')).toBeInTheDocument()
  })
})
