// The Calendar sections' toolbar: layout picker and a settings menu with only
// Calculations; no Filter, Sort or Group by; the count only outside the list layout.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, test, vi } from 'vitest'
import type { Layout, ViewState } from '@/api/types'
import { objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { DataView } from './DataView'
import { emptyFilterGroup } from './model'

const TITLE = propertyDef({ id: 'title', type: 'entity_title', name: 'Title' })
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', propertyDefinitions: [TITLE] })
const ROWS = [row({ summary: objectSummary({ path: 'Pages/A.md', type: 'page', title: 'A' }), version: 'v1' })]

function Harness({ compact, layout = 'list' }: { compact?: boolean; layout?: Layout }) {
  const [state, setState] = useState<ViewState>({
    viewDefinition: { dataViewLayout: layout },
    filterGroup: emptyFilterGroup(),
    sorts: [],
    groupBy: null,
  })
  return (
    <DataView
      rows={ROWS}
      types={[PAGE]}
      scope={{ typeIds: ['page'] }}
      state={state}
      onState={setState}
      layouts={['list', 'grid', 'table']}
      toolbarCompact={compact}
      heading={<h2>Section</h2>}
    />
  )
}

describe('Toolbar compact mode', () => {
  test('the full toolbar keeps Filter, Sort, Group by, the layout picker and Customize', () => {
    render(<Harness />)
    const bar = screen.getByTestId('toolbar')
    for (const name of ['Filter', 'Sort', 'Group by', 'Layout', 'Customize view']) {
      expect(within(bar).getByRole('button', { name })).toBeInTheDocument()
    }
    expect(bar).toHaveTextContent('1')
  })

  test('the compact toolbar has the layout picker and settings only, and no count for a list', () => {
    render(<Harness compact />)
    const bar = screen.getByTestId('toolbar')
    for (const name of ['Filter', 'Sort', 'Group by']) {
      expect(within(bar).queryByRole('button', { name })).toBeNull()
    }
    expect(within(bar).getByRole('button', { name: 'Layout' })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'Customize view' })).toBeInTheDocument()
    expect(bar).not.toHaveTextContent('1')
  })

  test('the compact toolbar shows the count once the layout is not a list', () => {
    render(<Harness compact layout="grid" />)
    expect(screen.getByTestId('toolbar')).toHaveTextContent('1')
  })

  test('the compact settings menu offers only Calculations, which opens its page', async () => {
    const user = userEvent.setup()
    render(<Harness compact />)
    await user.click(screen.getByRole('button', { name: 'Customize view' }))
    expect(await screen.findByRole('button', { name: 'Calculations' })).toBeInTheDocument()
    for (const name of ['Groups', 'Show details', 'Hide details']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    await user.click(screen.getByRole('button', { name: 'Calculations' }))
    // The page has its back row, titled as the menu item.
    expect(await screen.findAllByRole('button', { name: 'Calculations' })).not.toHaveLength(0)
  })

  test('the full settings menu is unchanged: groups, calculations, details', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Customize view' }))
    for (const name of ['Groups', 'Calculations', 'Show details']) {
      expect(await screen.findByRole('button', { name })).toBeInTheDocument()
    }
  })
})
