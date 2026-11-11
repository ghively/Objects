import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { TypeDef } from '@/api/types'
import { propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { CardViewSettings } from './CardViewSettings'

const mocked = vi.mocked(api)

const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
const NOTE = propertyDef({ id: 'p-note', key: 'note', name: 'Note', type: 'text' })
const TAGS = propertyDef({ id: 'tags', key: 'tags', name: 'Tags', type: 'entity_tags' })
const PROJECT = typeDef({ id: 'project', name: 'Project', revision: 'r1', propertyDefinitions: [TITLE, TAGS, NOTE] })

const saved = (n = 0): TypeDef => mocked.saveType.mock.calls[n][0]

beforeEach(() => {
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  useLinkIndex.setState({ types: [PROJECT], objects: [], loaded: true })
})

describe('CardViewSettings', () => {
  test('test CardViewSettings writes defaultViewType and smallCardViewConfig', async () => {
    const user = userEvent.setup()
    render(<CardViewSettings typeId="project" />)
    expect(screen.getByText('The view used when a note of this type is linked or added as a block in your content.')).toBeInTheDocument()
    expect(screen.getByText('The properties a small card of this type shows by default.')).toBeInTheDocument()

    const group = screen.getByRole('radiogroup', { name: 'Default link view' })
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Link block', 'Small card', 'Wide card', 'Embed', 'Page'])
    expect(within(group).getByRole('radio', { name: 'Link block' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(group).getByRole('radio', { name: 'Wide card' }))
    await waitFor(() => expect(mocked.saveType).toHaveBeenCalledTimes(1))
    expect(saved(0).defaultViewType).toBe('wideCard')

    // The default card shows type, title, tags and the preview; add one, then remove another.
    expect(screen.getAllByTestId('type-card-prop').map((e) => e.textContent)).toEqual(['Type', 'Title', 'Tags', 'Preview'])
    await user.click(screen.getByRole('button', { name: 'Add Properties' }))
    await user.click(await screen.findByRole('button', { name: 'Note' }))
    await waitFor(() => expect(mocked.saveType).toHaveBeenCalledTimes(2))
    expect(saved(1).smallCardViewConfig).toEqual({
      entityViewType: 'smallCard',
      properties: [
        { propertyType: 'entity_type', propertyId: 'type' },
        { propertyType: 'entity_title', propertyId: 'title' },
        { propertyType: 'entity_tags', propertyId: 'tags' },
        { propertyType: 'computed', propertyId: 'computed_preview' },
        { propertyType: 'text', propertyId: 'note' },
      ],
    })
  })

  test('Selected Properties lists the saved config, removing one saves it, and a live preview shows the card', async () => {
    const user = userEvent.setup()
    const type = typeDef({
      ...PROJECT,
      smallCardViewConfig: {
        entityViewType: 'smallCard',
        properties: [
          { propertyType: 'entity_title', propertyId: 'title' },
          { propertyType: 'text', propertyId: 'note' },
        ],
      },
    })
    useLinkIndex.setState({ types: [type] })
    render(<CardViewSettings typeId="project" />)
    expect(screen.getByText('Selected Properties')).toBeInTheDocument()
    expect(screen.getAllByTestId('type-card-prop').map((e) => e.textContent)).toEqual(['Title', 'Note'])
    expect(await screen.findByTestId('small-card')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove Note' }))
    await waitFor(() => expect(mocked.saveType).toHaveBeenCalled())
    expect(saved(0).smallCardViewConfig?.properties).toEqual([{ propertyType: 'entity_title', propertyId: 'title' }])
  })

  test('M31: "Page" saves the page link view and checks it', async () => {
    const user = userEvent.setup()
    render(<CardViewSettings typeId="project" />)
    const group = screen.getByRole('radiogroup', { name: 'Default link view' })
    await user.click(within(group).getByRole('radio', { name: 'Page' }))
    await waitFor(() => expect(mocked.saveType).toHaveBeenCalledTimes(1))
    expect(saved(0).defaultViewType).toBe('page')
    useLinkIndex.setState({ types: [typeDef({ ...PROJECT, defaultViewType: 'page' })] })
    await waitFor(() => expect(within(group).getByRole('radio', { name: 'Page' })).toHaveAttribute('aria-checked', 'true'))
  })
})
