// D3 (M30 hands-on): an imported object's "Source" line sits inside the properties panel, never as
// a column of its own beside the page (which squeezed the body and clipped the title).
import { render, screen } from '@testing-library/react'
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
import { settingsDefaults } from '@/settings/defaults'
import { useSettings } from '@/settings/useSettings'
import { ObjectView } from './ObjectView'

const mocked = vi.mocked(api)
const PAGE: TypeDef = typeDef({
  id: 'page',
  name: 'Page',
  pluralName: 'Pages',
  revision: 'r1',
  propertyDefinitions: [propertyDef({ id: 'title', type: 'entity_title', name: 'Title' }), propertyDef({ id: 'status', type: 'text', name: 'Status' })],
})
const PATH = 'Pages/Imported note.md'

beforeEach(() => {
  localStorage.clear()
  useSettings.setState({ settings: { ...settingsDefaults }, loaded: true })
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE] } satisfies SpaceInfo)
  mocked.resolve.mockResolvedValue(null)
  mocked.onChange.mockReturnValue(() => undefined)
  const detail = objectDetail({
    summary: objectSummary({ path: PATH, type: 'page', title: 'Imported note' }),
    frontmatter: {
      type: 'Page',
      title: 'Imported note',
      importSource: { system: 'markdown', id: 'notes/imported-note.md', batch: 'b1' },
    },
    body: 'Hello.\n',
    version: 'v1',
  })
  mocked.objects.mockResolvedValue([detail.summary])
  mocked.object.mockResolvedValue(detail)
})

describe('ObjectView import source line', () => {
  test('test the source line sits inside the side properties panel, not as its own column', async () => {
    render(<ObjectView path={PATH} mode="page" />)
    await screen.findByText('Hello.')
    const source = screen.getByRole('group', { name: 'Source' })
    const panel = screen.getByRole('complementary', { name: 'Properties' })
    expect(panel.getAttribute('data-panel-variant')).toBe('side')
    expect(panel.contains(source)).toBe(true)
    // The side layout's flex row holds only the panel and the page column.
    const layout = panel.closest('[data-page-layout]')!
    expect(source.parentElement).not.toBe(layout)
  })
})
