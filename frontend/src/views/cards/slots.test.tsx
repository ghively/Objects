import { render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import type { Row, ViewState } from '@/api/types'
import { resetLinkIndex } from '@/links/linkIndex'
import { objectSummary, row, typeDef } from '@/test/mockApi'
import { DataView } from '../DataView'
import { emptyFilterGroup } from '../model'
import { InlineToken } from './InlineToken'
import { SmallCard } from './SmallCard'

const PAGE = typeDef({ id: 'page', name: 'Page' })
const R = row({ summary: objectSummary({ path: 'Pages/A.md', title: 'Alpha' }) })
const PROPS = [{ propertyType: 'entity_title', propertyId: 'title' }]

beforeEach(() => resetLinkIndex())

describe('card slots', () => {
  test('InlineToken renders leading and trailing; unchanged without them', () => {
    const plain = render(<InlineToken row={R} type={PAGE} />).container.innerHTML
    const undef = render(<InlineToken row={R} type={PAGE} leading={undefined} trailing={undefined} />).container.innerHTML
    expect(undef).toBe(plain)
    expect(plain).not.toContain('data-slot')
    render(<InlineToken row={R} type={PAGE} leading={<i>L</i>} trailing={<i>T</i>} />)
    expect(screen.getByText('L').closest('[data-slot="leading"]')).not.toBeNull()
    expect(screen.getByText('T').closest('[data-slot="trailing"]')).not.toBeNull()
  })

  test('SmallCard renders leading and trailing; unchanged without them', () => {
    const plain = render(<SmallCard row={R} type={PAGE} props={PROPS} />).container.innerHTML
    const undef = render(<SmallCard row={R} type={PAGE} props={PROPS} leading={undefined} trailing={undefined} />).container.innerHTML
    expect(undef).toBe(plain)
    expect(plain).not.toContain('data-slot')
    render(<SmallCard row={R} type={PAGE} props={PROPS} leading={<i>L2</i>} trailing={<i>T2</i>} />)
    expect(screen.getByText('L2').closest('[data-testid="small-card"]')).not.toBeNull()
    expect(screen.getByText('T2').closest('[data-slot="trailing"]')).not.toBeNull()
  })

  test('test card slots: DataView rowExtras reach list rows (outside the row button) and cards', () => {
    const rows: Row[] = [R]
    function Harness({ layout }: { layout: 'list' | 'grid' }) {
      const [state, setState] = useState<ViewState>({
        viewDefinition: { dataViewLayout: layout },
        filterGroup: emptyFilterGroup(),
        sorts: [],
        groupBy: null,
      })
      return (
        <DataView
          rows={rows}
          types={[PAGE]}
          state={state}
          onState={setState}
          layouts={['list', 'grid']}
          rowExtras={(r) => ({ leading: <b>{`lead ${r.summary.title}`}</b>, trailing: <b>trail</b> })}
        />
      )
    }
    const list = render(<Harness layout="list" />)
    const lead = screen.getByText('lead Alpha')
    expect(lead.closest('button')).toBeNull()
    expect(lead.closest('li')).not.toBeNull()
    expect(screen.getByText('trail').closest('button')).toBeNull()
    list.unmount()
    render(<Harness layout="grid" />)
    const card = screen.getByTestId('small-card')
    expect(within(card).getByText('lead Alpha')).toBeInTheDocument()
    expect(within(card).getByText('trail')).toBeInTheDocument()
  })
})
