// M29: the object page shows its type's synced facts (the store's values, never the file's) and
// reads only its `synced` block again on a `synced` event for its type.
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent, ObjectDetail, SpaceInfo } from '@/api/types'
import { objectDetail, objectSummary, propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/find/FindBar', () => ({ FindBar: () => null }))
vi.mock('@/references/ReferencesSection', () => ({ ReferencesSection: () => null }))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { useFind } from '@/find/useFind'
import { usePeek, useTabs } from '@/nav/tabs'
import { ObjectPage } from './ObjectPage'

const mocked = vi.mocked(api)
const SOURCE = { source: 'Inventory script', staleAfterDays: 7 }
const HOST = typeDef({
  id: 'host',
  name: 'Host',
  pluralName: 'Hosts',
  revision: 'r1',
  propertyDefinitions: [
    propertyDef({ id: 'fqdn', name: 'FQDN', type: 'text' }),
    propertyDef({ id: 'diskFree', name: 'Disk free', type: 'number', synced: SOURCE }),
  ],
})
const PATH = 'Hosts/SRV-02.md'
let listeners: ((e: ChangeEvent) => void)[] = []
let onDisk: ObjectDetail

const detail = (diskFree: number, body = 'Notes.\n'): ObjectDetail =>
  objectDetail({
    summary: objectSummary({ path: PATH, type: 'host', title: 'SRV-02' }),
    // The file's own hand-typed value never shows.
    frontmatter: { type: 'Host', title: 'SRV-02', fqdn: 'srv-02.example.test', diskFree: 1 },
    body,
    version: 'v1',
    synced: { refreshedAt: new Date(Date.now() - 5 * 60_000).toISOString(), values: { diskFree } },
  })

const row = () => document.querySelector('[data-property-row="Disk free"]') as HTMLElement

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  useFind.getState().close()
  listeners = []
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [HOST] } satisfies SpaceInfo)
  onDisk = detail(42)
  mocked.objects.mockResolvedValue([onDisk.summary])
  mocked.object.mockImplementation(async () => onDisk)
  mocked.resolve.mockResolvedValue(null)
  mocked.onChange.mockImplementation((cb: (e: ChangeEvent) => void) => {
    listeners.push(cb)
    return () => {
      listeners = listeners.filter((l) => l !== cb)
    }
  })
})

const emit = (e: ChangeEvent) => act(() => listeners.forEach((l) => l(e)))

describe('ObjectView: M29 synced facts', () => {
  test('the page shows the synced value and its source line', async () => {
    render(<ObjectPage path={PATH} />)
    await screen.findByRole('heading', { level: 1, name: 'SRV-02' })
    await waitFor(() => expect((row().querySelector('input') as HTMLInputElement).value).toBe('42'))
    expect(row()).toHaveTextContent('Inventory script · Refreshed 5 minutes ago')
    expect(row().querySelector('input')).toHaveAttribute('readonly')
  })

  test("a synced event for the object's type reads only its synced block again", async () => {
    render(<ObjectPage path={PATH} />)
    await screen.findByRole('heading', { level: 1, name: 'SRV-02' })
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0))
    await waitFor(() => expect((row().querySelector('input') as HTMLInputElement).value).toBe('42'))
    mocked.object.mockClear()

    // Another type's sync reads nothing.
    emit({ kind: 'synced', path: 'network', version: 'r1' })
    expect(mocked.object).not.toHaveBeenCalled()

    // Host's sync: the new value shows; the body the read brought along is not taken.
    onDisk = detail(17, 'Not taken.\n')
    emit({ kind: 'synced', path: 'host', version: 'r2' })
    await waitFor(() => expect((row().querySelector('input') as HTMLInputElement).value).toBe('17'))
    expect(mocked.object).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Not taken.')).not.toBeInTheDocument()
  })
})
