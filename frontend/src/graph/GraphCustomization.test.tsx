import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { typeDef } from '@/test/mockApi'

vi.mock('sigma', async () => (await import('./testSigma')).sigmaModule())
import { CUSTOMIZATION_TEXT, GraphCustomization } from './GraphCustomization'
import { LARGE_NODE_LIMIT } from './filterGraph'

const TYPES = [
  typeDef({ id: 'page', name: 'Page', pluralName: 'Pages' }),
  typeDef({ id: 'person', name: 'Person', pluralName: 'People' }),
]

describe('GraphCustomization', () => {
  test('customization labels and tooltips', async () => {
    expect(CUSTOMIZATION_TEXT.hideLargeNodesTooltip(LARGE_NODE_LIMIT)).toBe('Nodes with more than 20 links are hidden')

    const user = userEvent.setup()
    render(<GraphCustomization custom={{}} onPatch={vi.fn()} types={TYPES} tagsNetworkKey="showSpaceTagsNetwork" />)
    await user.click(screen.getByRole('button', { name: 'Customize' }))
    const pop = await screen.findByRole('dialog')
    for (const label of ['Filter object types', 'Exclude object types']) expect(within(pop).getByRole('region', { name: label })).toBeInTheDocument()
    expect(within(pop).getAllByRole('button', { name: 'Deselect all' })).toHaveLength(2)
    // Catalog order: Show tags network first, then the type lists and the switches; "Show simplified graph" is ours, last.
    const order = Array.from(pop.querySelectorAll('[role="switch"], section[aria-label]')).map((el) => el.getAttribute('aria-label'))
    expect(order).toEqual([
      'Show tags network',
      'Filter object types',
      'Exclude object types',
      'Show completed tasks',
      'Hide heavily linked objects',
      'Hide dates',
      'Hide indirect links',
      'Show simplified graph',
    ])
    expect(within(pop).getByRole('switch', { name: 'Hide heavily linked objects' }).closest('label')).toHaveAttribute(
      'title',
      'Nodes with more than 20 links are hidden',
    )
    expect(within(pop).getByRole('switch', { name: 'Hide indirect links' }).closest('label')).toHaveAttribute(
      'title',
      'A link that runs only through hidden objects is hidden too.',
    )
  })

  test('switches and type lists patch the verbatim keys; the tags network key follows the scope', async () => {
    const user = userEvent.setup()
    const onPatch = vi.fn()
    const { unmount } = render(
      <GraphCustomization custom={{ excludeTypeIds: ['person'] }} onPatch={onPatch} types={TYPES} tagsNetworkKey="showSpaceTagsNetwork" />,
    )
    await user.click(screen.getByRole('button', { name: 'Customize' }))
    const pop = await screen.findByRole('dialog')
    const filter = within(pop).getByRole('region', { name: 'Filter object types' })
    await user.click(within(filter).getByRole('menuitemcheckbox', { name: /People/ }))
    expect(onPatch).toHaveBeenLastCalledWith({ filterTypeIds: ['person'] })
    const exclude = within(pop).getByRole('region', { name: 'Exclude object types' })
    expect(within(exclude).getByRole('menuitemcheckbox', { name: /People/ })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(exclude).getByRole('button', { name: 'Deselect all' }))
    expect(onPatch).toHaveBeenLastCalledWith({ excludeTypeIds: [] })
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
