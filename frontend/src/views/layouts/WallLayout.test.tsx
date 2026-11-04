import { render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Row, SmallCardViewConfig, ViewState } from '@/api/types'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { resetLinkIndex } from '@/links/linkIndex'
import { DataView } from '../DataView'
import { emptyFilterGroup } from '../model'

const PROJECT = typeDef({
  id: 'project',
  name: 'Project',
  pluralName: 'Projects',
  propertyDefinitions: [
    propertyDef({ id: 'title', type: 'entity_title', name: 'Title' }),
    propertyDef({ id: 'status', type: 'text', name: 'Status' }),
    propertyDef({ id: 'owner', type: 'text', name: 'Owner' }),
    propertyDef({ id: 'budget', type: 'number', name: 'Budget' }),
  ],
})

const CARD: SmallCardViewConfig = {
  entityViewType: 'smallCard',
  properties: [
    { propertyType: 'entity_type', propertyId: 'type' },
    { propertyType: 'entity_title', propertyId: 'title' },
    { propertyType: 'text', propertyId: 'status' },
    { propertyType: 'text', propertyId: 'owner' },
  ],
}

const WITH_DESC = row({
  summary: objectSummary({ path: 'Projects/Apollo.md', type: 'project', title: 'Apollo', description: 'Moon shot' }),
  values: { status: 'Active', budget: 12 },
})
const NO_DESC = row({
  summary: objectSummary({ path: 'Projects/Gemini.md', type: 'project', title: 'Gemini' }),
  values: { status: 'Done', owner: 'Ann' },
})

function Harness({ rows }: { rows: Row[] }) {
  const [state, setState] = useState<ViewState>({
    viewDefinition: { dataViewLayout: 'wall', smallCardViewConfigs: { project: CARD } },
    filterGroup: emptyFilterGroup(),
    sorts: [],
    groupBy: null,
  })
  return <DataView rows={rows} types={[PROJECT]} scope={{ typeIds: ['project'] }} state={state} onState={setState} layouts={['wall']} />
}

const card = (path: string) =>
  screen.getAllByTestId('small-card').find((c) => c.getAttribute('data-path') === path) as HTMLElement

beforeEach(() => resetLinkIndex())

describe('wall cards', () => {
  test('order: type label, icon and title, description, then the property rows', () => {
    render(<Harness rows={[WITH_DESC]} />)
    const c = card('Projects/Apollo.md')
    const parts = Array.from(c.querySelectorAll('[data-testid]')).map((e) => e.getAttribute('data-testid'))
    const order = ['card-type', 'card-title', 'card-description', 'card-prop-row']
    expect(parts.filter((p) => order.includes(p!))).toEqual([
      'card-type',
      'card-title',
      'card-description',
      'card-prop-row',
      'card-prop-row',
    ])
    expect(within(within(c).getByTestId('card-title')).getByTestId('card-title-icon')).toBeInTheDocument()
    expect(within(c).getByTestId('card-title').textContent).toBe('Apollo')
    expect(within(c).getByTestId('card-description').textContent).toBe('Moon shot')
    // The masonry columns stay.
    expect(screen.getAllByTestId('wall-column').length).toBeGreaterThan(0)
  })

  test('a property row shows its name and value', () => {
    render(<Harness rows={[WITH_DESC]} />)
    const rows = within(card('Projects/Apollo.md')).getAllByTestId('card-prop-row')
    const status = rows.find((r) => r.getAttribute('data-prop') === 'status')!
    expect(within(status).getByTestId('card-prop-name').textContent).toBe('Status')
    expect(within(status).getByDisplayValue('Active')).toBeInTheDocument()
    expect(within(status).queryByText('Empty')).toBeNull()
  })

  test('an empty value shows a muted "Empty" placeholder', () => {
    render(<Harness rows={[WITH_DESC]} />)
    const rows = within(card('Projects/Apollo.md')).getAllByTestId('card-prop-row')
    const owner = rows.find((r) => r.getAttribute('data-prop') === 'owner')!
    expect(within(owner).getByTestId('card-prop-name').textContent).toBe('Owner')
    const empty = within(owner).getByText('Empty')
    expect(empty.className).toContain('text-fg-muted')
  })

  test('a property left out of the card view is not shown', () => {
    render(<Harness rows={[WITH_DESC]} />)
    const c = card('Projects/Apollo.md')
    expect(c.querySelector('[data-prop="budget"]')).toBeNull()
    expect(within(c).queryByText('Budget')).toBeNull()
  })

  test('no description means no description element', () => {
    render(<Harness rows={[NO_DESC]} />)
    const c = card('Projects/Gemini.md')
    expect(within(c).queryByTestId('card-description')).toBeNull()
    expect(within(c).getAllByTestId('card-prop-row')).toHaveLength(2)
  })
})
