import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { typeDef } from '@/test/mockApi'

vi.mock('sigma', async () => (await import('./testSigma')).sigmaModule())
import { CUSTOMIZATION_TEXT, GraphCustomization } from './GraphCustomization'
import { LOADING_STEPS } from './GraphLoading'
import { GRAPH_TEXT } from './GraphPage'
import { TOOLBAR_TEXT } from './GraphToolbar'
import { LARGE_NODE_LIMIT } from './filterGraph'

const STRINGS = readFileSync(
  path.resolve(import.meta.dirname, '../../../reference/app-unpacked/dist/virtual_intlify-i18n-0366822.js'),
  'utf8',
)

/** A plain message is stored as `s:\`text\``; one with a placeholder as `v:\`before\``,`{t:4,k:\`name\`}`. */
function inReference(text: string): boolean {
  if (STRINGS.includes(`s:\`${text}\``)) return true
  const m = /^(.*)\{(\w+)\}(.*)$/.exec(text)
  if (!m) return false
  const [, before, key, after] = m
  return STRINGS.includes(`{t:3,v:\`${before}\`},{t:4,k:\`${key}\`},{t:3,v:\`${after}\`}`)
}

const TYPES = [
  typeDef({ id: 'page', name: 'Page', pluralName: 'Pages' }),
  typeDef({ id: 'person', name: 'Person', pluralName: 'People' }),
]

describe('GraphCustomization', () => {
  test('customization labels and tooltips match reference', async () => {
    const plain = [
      CUSTOMIZATION_TEXT.customize,
      CUSTOMIZATION_TEXT.filterObjectTypes,
      CUSTOMIZATION_TEXT.excludeObjectTypes,
      CUSTOMIZATION_TEXT.deselectAll,
      CUSTOMIZATION_TEXT.showCompletedTasks,
      CUSTOMIZATION_TEXT.alwaysMinimalNodes,
      CUSTOMIZATION_TEXT.hideLargeNodes,
      CUSTOMIZATION_TEXT.hideDates,
      CUSTOMIZATION_TEXT.hideIndirectLinks,
      CUSTOMIZATION_TEXT.hideIndirectLinksTooltip,
      CUSTOMIZATION_TEXT.showTagsNetwork,
      GRAPH_TEXT.heading,
      GRAPH_TEXT.emptyTitle,
      GRAPH_TEXT.emptyDescription,
      GRAPH_TEXT.emptyFiltered,
      TOOLBAR_TEXT.search,
      TOOLBAR_TEXT.fit,
      ...LOADING_STEPS,
    ]
    for (const s of plain) expect(inReference(s), s).toBe(true)
    expect(inReference('Nodes with more than {limit} links are hidden')).toBe(true)
    expect(CUSTOMIZATION_TEXT.hideLargeNodesTooltip(LARGE_NODE_LIMIT)).toBe('Nodes with more than 100 links are hidden')

    const user = userEvent.setup()
    render(<GraphCustomization custom={{}} onPatch={vi.fn()} types={TYPES} tagsNetworkKey="showSpaceTagsNetwork" />)
    await user.click(screen.getByRole('button', { name: 'Customize' }))
    const pop = await screen.findByRole('dialog')
    for (const label of ['Filter object types', 'Exclude object types']) expect(within(pop).getByRole('region', { name: label })).toBeInTheDocument()
    expect(within(pop).getAllByRole('button', { name: 'Deselect all' })).toHaveLength(2)
    for (const label of ['Show completed tasks', 'Show simplified graph', 'Hide objects with many links', 'Hide dates', 'Hide indirect links', 'Show tags network']) {
      expect(within(pop).getByRole('switch', { name: label })).toBeInTheDocument()
    }
    expect(within(pop).getByRole('switch', { name: 'Hide objects with many links' }).closest('label')).toHaveAttribute(
      'title',
      'Nodes with more than 100 links are hidden',
    )
    expect(within(pop).getByRole('switch', { name: 'Hide indirect links' }).closest('label')).toHaveAttribute(
      'title',
      'Links that only pass through a hidden object are not shown.',
    )
  })

  test('switches and type lists patch the verbatim keys; the tags network key follows the scope', async () => {
    const user = userEvent.setup()
    const onPatch = vi.fn()
    const { unmount } = render(
      <GraphCustomization custom={{ excludeStructureIds: ['person'] }} onPatch={onPatch} types={TYPES} tagsNetworkKey="showSpaceTagsNetwork" />,
    )
    await user.click(screen.getByRole('button', { name: 'Customize' }))
    const pop = await screen.findByRole('dialog')
    const filter = within(pop).getByRole('region', { name: 'Filter object types' })
    await user.click(within(filter).getByRole('menuitemcheckbox', { name: /People/ }))
    expect(onPatch).toHaveBeenLastCalledWith({ filterStructureIds: ['person'] })
    const exclude = within(pop).getByRole('region', { name: 'Exclude object types' })
    expect(within(exclude).getByRole('menuitemcheckbox', { name: /People/ })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(exclude).getByRole('button', { name: 'Deselect all' }))
    expect(onPatch).toHaveBeenLastCalledWith({ excludeStructureIds: [] })
    await user.click(within(pop).getByRole('switch', { name: 'Show completed tasks' }))
    expect(onPatch).toHaveBeenLastCalledWith({ showCompletedTasks: true })
    await user.click(within(pop).getByRole('switch', { name: 'Show tags network' }))
    expect(onPatch).toHaveBeenLastCalledWith({ showSpaceTagsNetwork: true })
    unmount()

    render(<GraphCustomization custom={{}} onPatch={onPatch} types={TYPES} tagsNetworkKey="showTagsNetwork" />)
    await user.click(screen.getByRole('button', { name: 'Customize' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('switch', { name: 'Show tags network' }))
    expect(onPatch).toHaveBeenLastCalledWith({ showTagsNetwork: true })
  })
})
