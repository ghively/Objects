// M29: synced properties in the property panel: the store's value (never the file's), no editor,
// the source line and "Stale".
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ObjectSynced } from '@/api/types'
import { objectSummary, propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { resetLinkIndex } from '@/links/linkIndex'
import { cellValue, PropertyPanel } from './PropertyPanel'

const SOURCE = { source: 'Inventory script', staleAfterDays: 7 }
const fqdn = propertyDef({ id: 'fqdn', name: 'FQDN', type: 'text' })
const diskFree = propertyDef({ id: 'diskFree', name: 'Disk free', type: 'number', synced: SOURCE })
const lastBoot = propertyDef({ id: 'lastBoot', name: 'Last boot', type: 'datetime', synced: SOURCE })
const patch = propertyDef({
  id: 'patchState',
  name: 'Patch state',
  type: 'label',
  visibility: 'hideWhenEmpty',
  synced: SOURCE,
  options: {
    isArray: false,
    set: [
      { id: 'o1', text: 'Current', color: 'green', icon: null },
      { id: 'o2', text: 'Failed', color: 'red', icon: null },
    ],
  },
})
const HOST = typeDef({ id: 'host', name: 'Host', propertyDefinitions: [fqdn, diskFree, lastBoot, patch] })
const summary = objectSummary({ path: 'Hosts/SRV-02.md', title: 'SRV-02', type: 'host' })
const NOW = new Date('2026-11-09T10:00:00.000Z')

const synced = (refreshedAt: string | null, values: Record<string, unknown> = {}): ObjectSynced => ({ refreshedAt, values })
const row = (name: string) => document.querySelector(`[data-property-row="${name}"]`) as HTMLElement | null

beforeEach(() => {
  resetLinkIndex()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('PropertyPanel: M29 synced facts', () => {
  test('a synced row shows the store value, not the front matter', () => {
    // SRV-02's file has a hand-typed lastBoot and diskFree; the store's values win.
    const fm = { fqdn: 'srv-02.example.test', lastBoot: '2020-01-01T00:00:00.000Z', diskFree: 1 }
    const store = synced('2026-11-09T09:55:00.000Z', { diskFree: 42.5, lastBoot: { start: '2026-11-08T06:00:00.000Z', resolution: 'time' } })
    expect(cellValue(diskFree, fm, {}, summary, [], undefined, store)).toBe(42.5)
    expect(cellValue(lastBoot, fm, {}, summary, [], undefined, store)).toEqual({ start: '2026-11-08T06:00:00.000Z', resolution: 'time' })
    // Before the first sync (or with no `synced` block), the file's value never shows.
    expect(cellValue(diskFree, fm, {}, summary, [], undefined, synced(null))).toBeNull()
    expect(cellValue(lastBoot, fm, {}, summary)).toBeNull()
    render(<PropertyPanel type={HOST} frontmatter={fm} summary={summary} synced={store} onChange={() => undefined} />)
    expect((row('Disk free')!.querySelector('input') as HTMLInputElement).value).toBe('42.5')
    expect(row('Last boot')).not.toHaveTextContent('2020')
    expect(row('Last boot')).toHaveTextContent('2026')
  })

  test('it offers no editor', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    const onChange = vi.fn()
    const store = synced('2026-11-09T09:55:00.000Z', { diskFree: 42.5, patchState: ['Current'] })
    render(<PropertyPanel type={HOST} frontmatter={{}} summary={summary} synced={store} onChange={onChange} />)
    // The number is a read-only field; typing into it changes nothing.
    const disk = row('Disk free')!.querySelector('input') as HTMLInputElement
    expect(disk).toHaveAttribute('readonly')
    await user.type(disk, '9{Enter}')
    await new Promise((r) => setTimeout(r, 300)) // past the number cell's save debounce
    // The label shows as a plain pill: clicking it opens no menu.
    await user.click(screen.getByText('Current'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Failed')).not.toBeInTheDocument()
    // The date shows as text: no picker.
    expect(row('Last boot')!.querySelector('button')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    // A non-synced row of the same object is still editable.
    expect(row('FQDN')!.querySelector('input')).not.toHaveAttribute('readonly')
  })

  test('the source line and Stale', () => {
    const { unmount } = render(
      <PropertyPanel type={HOST} frontmatter={{}} summary={summary} synced={synced('2026-11-09T09:55:00.000Z', { diskFree: 40 })} onChange={() => undefined} />,
    )
    expect(row('Disk free')).toHaveTextContent('Inventory script · Refreshed 5 minutes ago')
    expect(row('Disk free')!.querySelector('[data-stale]')).toBeNull()
    expect(row('FQDN')!.querySelector('[data-synced-line]')).toBeNull()
    unmount()

    render(<PropertyPanel type={HOST} frontmatter={{}} summary={summary} synced={synced('2026-11-01T09:00:00.000Z', { diskFree: 40 })} onChange={() => undefined} />)
    expect(row('Disk free')).toHaveTextContent('Inventory script · Refreshed 8 days ago')
    expect(row('Disk free')).toHaveTextContent('Stale')
    expect(row('Disk free')!.querySelector('[data-synced-value]')).toHaveAttribute('data-stale-value')
  })

  test('not refreshed yet', () => {
    render(<PropertyPanel type={HOST} frontmatter={{ diskFree: 3 }} summary={summary} synced={synced(null)} onChange={() => undefined} />)
    expect(row('Disk free')).toHaveTextContent('Inventory script · Not refreshed yet')
    expect(row('Disk free')).not.toHaveTextContent('Stale')
  })

  test('hideWhenEmpty still hides an empty synced row', () => {
    // The file has a value under the key, but the store has none: the row is empty, so hidden.
    const { unmount } = render(
      <PropertyPanel type={HOST} frontmatter={{ patchState: 'Failed' }} summary={summary} synced={synced('2026-11-09T09:55:00.000Z', {})} onChange={() => undefined} />,
    )
    expect(row('Patch state')).toBeNull()
    expect(screen.queryByText('Failed')).not.toBeInTheDocument()
    unmount()
    render(
      <PropertyPanel type={HOST} frontmatter={{}} summary={summary} synced={synced('2026-11-09T09:55:00.000Z', { patchState: ['Failed'] })} onChange={() => undefined} />,
    )
    expect(row('Patch state')).toHaveTextContent('Failed')
  })

  test('a non-synced row is unchanged', () => {
    render(<PropertyPanel type={HOST} frontmatter={{ fqdn: 'srv-02.example.test' }} summary={summary} synced={synced(null)} onChange={() => undefined} />)
    const input = row('FQDN')!.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('srv-02.example.test')
    expect(input).not.toHaveAttribute('readonly')
    expect(row('FQDN')!.querySelector('[data-synced-line]')).toBeNull()
    expect(cellValue(fqdn, { fqdn: 'a' }, {}, summary, [], undefined, synced(null, { fqdn: 'b' }))).toBe('a')
  })
})
