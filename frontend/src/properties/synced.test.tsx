// M29: the synced mark's helpers and the line under a synced value.
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { propertyDef } from '@/test/mockApi'
import { isStale, isSynced, SYNCED_TEXT, SyncedLine } from './synced'

const DAY = 86_400_000
const NOW = new Date('2026-11-09T10:00:00.000Z')
const before = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const lastBoot = propertyDef({ id: 'lastBoot', name: 'Last boot', type: 'datetime', synced: { source: 'Inventory script', staleAfterDays: 7 } })

describe('synced facts', () => {
  test('isStale: 7 days exactly is fresh, a second more is stale, never refreshed is not stale', () => {
    expect(isStale(before(7 * DAY), 7, NOW)).toBe(false)
    expect(isStale(before(7 * DAY + 1000), 7, NOW)).toBe(true)
    expect(isStale(null, 7, NOW)).toBe(false)
    expect(isStale(undefined, 7, NOW)).toBe(false)
    expect(isStale('not a time', 7, NOW)).toBe(false)
    expect(isStale(before(DAY + 1000), 1, NOW)).toBe(true)
  })

  test('isSynced reads the synced mark', () => {
    expect(isSynced(lastBoot)).toBe(true)
    expect(isSynced(propertyDef({ id: 'fqdn' }))).toBe(false)
    expect(isSynced(propertyDef({ id: 'x', synced: null }))).toBe(false)
    expect(isSynced(undefined)).toBe(false)
  })

  test('SyncedLine reads "Refreshed 5 minutes ago" with the source', () => {
    render(<SyncedLine def={lastBoot} refreshedAt={before(5 * 60_000)} now={NOW} />)
    expect(screen.getByText('Inventory script · Refreshed 5 minutes ago')).toBeInTheDocument()
    expect(screen.queryByText('Stale')).not.toBeInTheDocument()
  })

  test('SyncedLine without a time reads "Not refreshed yet"', () => {
    render(<SyncedLine def={lastBoot} refreshedAt={null} now={NOW} />)
    expect(screen.getByText('Inventory script · Not refreshed yet')).toBeInTheDocument()
    expect(screen.queryByText('Stale')).not.toBeInTheDocument()
  })

  test('SyncedLine shows Stale, muted, after 8 days', () => {
    render(<SyncedLine def={lastBoot} refreshedAt={before(8 * DAY)} now={NOW} />)
    expect(screen.getByText('Inventory script · Refreshed 8 days ago')).toBeInTheDocument()
    const stale = screen.getByText('Stale')
    expect(stale).toHaveAttribute('data-stale')
    expect(stale.className).toContain('text-fg-muted')
  })

  test('the read-only message names the property and its source', () => {
    expect(SYNCED_TEXT.readOnly('Disk free', 'Inventory script')).toBe(`"Disk free" is filled by Inventory script and can't be edited.`)
  })
})
