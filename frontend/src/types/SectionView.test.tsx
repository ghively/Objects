import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { buildSections } from './dashboardSections'
import { SectionView } from './SectionView'
import { defaultViews } from '@/test/mockApi'

const mocked = vi.mocked(api)

const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
const BL = propertyDef({ id: 'backlinks', key: 'backlinks', name: 'Backlinks', type: 'entity_backlinks' })
const PERSON = typeDef({ id: 'person', name: 'Person', pluralName: 'People', propertyDefinitions: [TITLE, BL] })

const mk = (path: string, title: string, backlinks: { target: string; path: string }[]) =>
  row({ summary: objectSummary({ path, type: 'person', title }), values: { backlinks } })

beforeEach(() => {
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.rows.mockResolvedValue([
    mk('People/Ada.md', 'Ada', [{ target: 'Bob', path: 'People/Bob.md' }]),
    mk('People/Bob.md', 'Bob', []),
    mk('People/Cy.md', 'Cy', []),
  ])
  mocked.collections.mockResolvedValue([])
  mocked.queries.mockResolvedValue([])
  mocked.onChange.mockReturnValue(() => undefined)
  useLinkIndex.setState({ types: [PERSON], objects: [], loaded: true })
})

describe('SectionView: No backlinks (M5)', () => {
  test('test no backlinks section lists the objects nothing links to, as a list', async () => {
    const v = defaultViews()
    const [section] = buildSections(
      PERSON,
      { ...v, dashboard: { sections: [{ key: 'noBacklinks', collapsed: false }], removedSections: [] } },
      { collections: [], queries: [] },
    )
    expect(section.key).toBe('noBacklinks')
    render(<SectionView type={PERSON} section={section} search="" onViewDefinition={() => {}} />)
    await waitFor(() => expect(mocked.rows).toHaveBeenCalledWith({ typeIds: ['person'], preview: false }))
    expect(await screen.findByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Cy')).toBeInTheDocument()
    expect(screen.queryByText('Ada')).toBeNull()
    expect(screen.getByRole('list')).toBeInTheDocument()
  })
})
