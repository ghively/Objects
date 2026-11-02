// The heading row of a data view that has a heading (a Calendar day's sections): in a narrow
// column the toolbar wraps below the heading instead of being laid over it.
import { render } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, test, vi } from 'vitest'
import type { ViewState } from '@/api/types'
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

function Harness({ heading }: { heading?: string }) {
  const [state, setState] = useState<ViewState>({
    viewDefinition: { dataViewLayout: 'list' },
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
      heading={heading ? <h2>{heading}</h2> : undefined}
    />
  )
}

describe('DataView heading row', () => {
  test('wraps, with the heading sized to its text, so a narrow column never overprints it', () => {
    const { container } = render(<Harness heading="Created Yesterday" />)
    const rowEl = container.querySelector('[data-toolbar-row]') as HTMLElement
    expect(rowEl.className).toContain('flex-wrap')
    const headingBox = rowEl.firstElementChild as HTMLElement
    expect(headingBox).toHaveTextContent('Created Yesterday')
    // `flex-auto` (basis: the text's own width) is what makes the toolbar wrap when there is no room;
    // `min-w-0` keeps a very long heading from pushing the row wider than its column.
    expect(headingBox.className).toContain('flex-auto')
    expect(headingBox.className).toContain('min-w-0')
    // The toolbar sits right-aligned in the same row, on its own line when wrapped.
    expect(rowEl.querySelector('[data-testid="toolbar"]')?.className).toContain('ml-auto')
  })
})
