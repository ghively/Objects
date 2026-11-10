// M29 Task 1: the contract of synced facts and type suggestion on the front end: the syncable
// kinds, the stale default, the API shapes and the parity fixture T2 and T8 both run.
import { describe, expect, test } from 'vitest'
import {
  SYNCABLE_KINDS,
  SYNCED_STALE_DEFAULT,
  type ApiTokenScope,
  type ChangeKind,
  type ObjectSynced,
  type PropertyDef,
  type SyncedSpec,
  type TypeDef,
} from '@/api/types'
import { objectDetail, objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'
import fixture from './__fixtures__/suggest-cases.json'

interface Fixture {
  types: { id: string; namePatterns: unknown[] }[]
  cases: { name: string; ctx: { allowed?: string[]; scope?: string[]; last?: string | null }; expect: string[] }[]
  patterns: { pattern: unknown; valid: boolean; matches: string[]; misses: string[] }[]
}

describe('M29 contract', () => {
  test('syncable kinds and the stale default', () => {
    expect(SYNCABLE_KINDS.has('label') && !SYNCABLE_KINDS.has('entity')).toBe(true)
    expect([...SYNCABLE_KINDS].sort()).toEqual(
      ['boolean', 'datetime', 'datetimeSimple', 'label', 'number', 'text', 'url'],
    )
    expect(SYNCED_STALE_DEFAULT).toBe(7)
  })

  test('the API shapes carry the synced mark, name patterns and synced values', () => {
    const spec: SyncedSpec = { source: 'Inventory script', staleAfterDays: 7 }
    const def: PropertyDef = propertyDef({ id: 'diskFree', type: 'number', synced: spec })
    const host: TypeDef = typeDef({ id: 'host', namePatterns: ['{ip}'], propertyDefinitions: [def] })
    expect(host.namePatterns).toEqual(['{ip}'])
    expect(host.propertyDefinitions[0].synced).toEqual(spec)
    const synced: ObjectSynced = { refreshedAt: null, values: {} }
    const detail = objectDetail({ summary: objectSummary({ path: 'Hosts/APP01.md' }), synced })
    expect(detail.synced).toBe(synced)
    expect(row({ path: 'Hosts/APP01.md', syncedAt: '2026-11-09T08:00:00.000Z' }).syncedAt).toBe(
      '2026-11-09T08:00:00.000Z',
    )
    const scope: ApiTokenScope = 'sync'
    const kind: ChangeKind = 'synced'
    expect([scope, kind]).toEqual(['sync', 'synced'])
  })

  test('the parity fixture parses and has at least 40 cases', () => {
    const data = fixture as Fixture
    expect(data.types.length).toBeGreaterThan(0)
    expect(data.cases.length).toBeGreaterThanOrEqual(40)
    expect(data.patterns.length).toBeGreaterThan(0)
    const ids = new Set(data.types.map((t) => t.id))
    for (const c of data.cases) {
      expect(typeof c.name).toBe('string')
      for (const id of c.expect) expect(ids.has(id)).toBe(true)
    }
    for (const p of data.patterns) {
      expect(typeof p.valid).toBe('boolean')
      if (!p.valid) expect(p.matches).toEqual([])
    }
  })
})
