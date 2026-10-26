import { render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Layout, Row, ViewState } from '@/api/types'
import { objectDetail, objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/editor/Editor', () => ({
  Editor: ({ body }: { body: string }) => <div data-testid="editor">{body}</div>,
}))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { DataView } from '../DataView'
import { emptyFilterGroup } from '../model'

const mocked = vi.mocked(api)

const NOTE = typeDef({
  id: 'note',
  name: 'Note',
  pluralName: 'Notes',
  propertyDefinitions: [propertyDef({ id: 'title', type: 'entity_title', name: 'Title' })],
})

const mk = (n: number, extra: Partial<Row> = {}): Row =>
  row({ summary: objectSummary({ path: `Notes/N${n}.md`, type: 'note', tags: n === 1 ? ['alpha'] : [] }), ...extra })

const ROWS = [1, 2, 3, 4, 5].map((n) => mk(n, { preview: n === 1 ? 'A short body preview' : '' }))

const view = (layout: Layout): ViewState => ({
  viewDefinition: { dataViewLayout: layout },
  filterGroup: emptyFilterGroup(),
  sorts: [],
  groupBy: null,
})

function Harness({ layout, rows = ROWS }: { layout: Layout; rows?: Row[] }) {
  const [state, setState] = useState(view(layout))
  return (
    <DataView
      rows={rows}
      types={[NOTE]}
      scope={{ typeIds: ['note'] }}
      state={state}
      onState={setState}
      layouts={['list', 'grid', 'wall', 'embed']}
    />
  )
}

function width(px: number) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => px })
}

beforeEach(() => {
  resetLinkIndex()
  vi.clearAllMocks()
})
afterEach(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
  vi.unstubAllGlobals()
})

describe('card layouts', () => {
  test('test small card shows type label, title, tags and preview', () => {
    render(<Harness layout="grid" />)
    const card = screen.getAllByTestId('small-card')[0]
    expect(within(card).getByTestId('card-type').textContent).toBe('Note')
    expect(within(card).getByTestId('card-title').textContent).toBe('N1')
    expect(within(card).getByTestId('card-tags').textContent).toBe('alpha')
    expect(within(card).getByTestId('card-preview').textContent).toBe('A short body preview')
    // Empty tags show the placeholder.
    expect(within(screen.getAllByTestId('small-card')[1]).getByTestId('card-tags').textContent).toBe('Tags')
  })

  test('test grid uses columnCount columns', () => {
    width(1000)
    render(<Harness layout="grid" />)
    const grid = screen.getByTestId('grid')
    expect(grid.getAttribute('data-columns')).toBe('4')
    expect(grid.style.gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))')
  })

  test('test wall deals cards round-robin into columns', () => {
    width(500)
    render(<Harness layout="wall" />)
    const cols = screen.getAllByTestId('wall-column')
    expect(cols).toHaveLength(2)
    const paths = (c: HTMLElement) => within(c).getAllByTestId('small-card').map((x) => x.getAttribute('data-path'))
    expect(paths(cols[0])).toEqual(['Notes/N1.md', 'Notes/N3.md', 'Notes/N5.md'])
    expect(paths(cols[1])).toEqual(['Notes/N2.md', 'Notes/N4.md'])
  })

  test('test gallery is single horizontal strip', () => {
    render(<Harness layout="gallery" />)
    const strip = screen.getByTestId('gallery')
    expect(strip.className).toContain('overflow-x-auto')
    expect(strip.className).not.toContain('grid')
    expect(screen.getAllByTestId('gallery-item')).toHaveLength(5)
    expect(screen.getAllByTestId('gallery-item')[0].className).toContain('w-[208px]')
  })

  test('test embed card loads body when visible', async () => {
    let fire: (visible: boolean) => void = () => {}
    class IO {
      constructor(cb: (e: { isIntersecting: boolean }[]) => void) {
        fire = (v) => cb([{ isIntersecting: v }])
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', IO)
    mocked.object.mockResolvedValue(objectDetail({ summary: ROWS[0].summary, body: '# N1\n\nHello' }))
    render(<Harness layout="embed" rows={[ROWS[0]]} />)
    expect(screen.getByTestId('embed-card')).toBeTruthy()
    expect(mocked.object).not.toHaveBeenCalled()
    fire(true)
    await waitFor(() => expect(mocked.object).toHaveBeenCalledWith('Notes/N1.md'))
    expect((await screen.findByTestId('editor')).textContent).toContain('Hello')
  })
})
