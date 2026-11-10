// M28 Task 9: a counterpart ("Runs" on a Host, the other side of Application "Runs on") is an
// ordinary relation in views: offered as a property, filtered, sorted and grouped by its linked
// objects, on rows shaped as the server sends them (values[key] = EntityRefs, links[key] = paths).
import { describe, expect, test } from 'vitest'
import type { Row, TypeDef } from '@/api/types'
import { counterpartDef, objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'
import { applyFilters, type FilterCtx } from './filter'
import { canDropRow, groupRows, valueForGroup } from './group'
import { propertyChoices } from './properties'
import { applySorts } from './sort'
import { normalizeTableConfig, tableDefs } from './table/tableConfig'

const runs = counterpartDef({
  key: 'runs',
  name: 'Runs',
  options: { allowedTypes: ['application', 'container'], counterpartOf: [{ typeId: 'application', key: 'runsOn' }, { typeId: 'container', key: 'runsOn' }] },
})
const host: TypeDef = typeDef({
  id: 'host',
  name: 'Host',
  propertyDefinitions: [propertyDef({ id: 'title', type: 'entity_title' }), propertyDef({ id: 'fqdn', type: 'text' })],
  counterparts: [runs],
})

const INVENTORY = 'Applications/Inventory app.md'
const PAYROLL = 'Applications/Payroll.md'
const titles: Record<string, string> = { [INVENTORY]: 'Inventory app', [PAYROLL]: 'Payroll' }

/** A Host row as `POST /api/rows` sends it with its "Runs" counterpart. */
function hostRow(title: string, paths: string[], createdAt: string): Row {
  return row({
    summary: objectSummary({ path: `Hosts/${title}.md`, title, type: 'host', createdAt }),
    values: { fqdn: null, runs: paths.map((p) => ({ target: titles[p], path: p })) },
    links: { runs: paths },
  })
}

const rows = [
  hostRow('APP-TEST-01', [INVENTORY], '2026-01-01T00:00:00Z'),
  hostRow('DB-TEST-01', [], '2026-02-01T00:00:00Z'),
  hostRow('WEB-TEST-01', [PAYROLL, INVENTORY], '2026-03-01T00:00:00Z'),
]
const ctx: FilterCtx = {
  types: [host],
  collections: [],
  tagIdsToTitles: {},
  now: new Date(2026, 10, 9, 12),
  pathsById: { inv: INVENTORY, pay: PAYROLL },
  entityTitles: titles,
  viewTypeIds: ['host'],
}
const order = (rs: Row[]) => rs.map((r) => r.summary.title)

describe('test M28 counterparts in views', () => {
  test('test propertyChoices offers the counterpart after the type own properties', () => {
    const choices = propertyChoices([host])
    const keys = choices.map((c) => c.key)
    expect(keys.slice(0, 3)).toEqual(['title', 'fqdn', 'runs'])
    const choice = choices.find((c) => c.key === 'runs')
    expect(choice).toMatchObject({ key: 'runs', name: 'Runs', kind: 'entity' })
  })

  test('test a contains filter on the counterpart keeps the linked rows', () => {
    const kept = applyFilters(
      rows,
      { type: 'filterGroup', operator: 'and', elements: [{ type: 'filter', propertyId: 'runs', option: 'contains', referenceValue: ['inv'] }] },
      ctx,
    )
    expect(order(kept)).toEqual(['APP-TEST-01', 'WEB-TEST-01'])
    const empty = applyFilters(rows, { type: 'filterGroup', operator: 'and', elements: [{ type: 'filter', propertyId: 'runs', option: 'isEmpty' }] }, ctx)
    expect(order(empty)).toEqual(['DB-TEST-01'])
  })

  test('test sorting by the counterpart reads the linked titles', () => {
    expect(order(applySorts(rows, [{ propertyId: 'runs', option: 'ascending' }], ctx))).toEqual([
      'APP-TEST-01',
      'WEB-TEST-01',
      'DB-TEST-01',
    ])
  })

  test('test grouping by the counterpart puts a row in each linked object group', () => {
    const { groups } = groupRows(rows, { groups: [{ propertyId: 'runs', option: 'default' }] }, undefined, ctx)
    const byLabel = Object.fromEntries(groups.map((g) => [g.label, order(g.rows)]))
    expect(byLabel['Inventory app']).toEqual(['APP-TEST-01', 'WEB-TEST-01'])
    expect(byLabel['Payroll']).toEqual(['WEB-TEST-01'])
    expect(groups.find((g) => g.isOther)?.rows.map((r) => r.summary.title)).toEqual(['DB-TEST-01'])
    // A board grouped by it never writes the counterpart on the dropped row.
    expect(canDropRow(rows[1], { propertyId: 'runs', option: 'default' }, runs, [host])).toBe(false)
    // Nor does a column's "+" or a drop get a value for it (review #2: the server refuses it).
    const by = { groups: [{ propertyId: 'runs', option: 'default' as const }] }
    const inv = groups.find((g) => g.label === 'Inventory app')!
    expect(valueForGroup(by, inv, runs)).toBeNull()
    expect(valueForGroup(by, inv, runs, { row: rows[1], from: groups.find((g) => g.isOther) })).toBeNull()
  })

  test('test the table offers the counterpart as a read-only column', () => {
    const defs = tableDefs(host)
    expect(defs.map((d) => d.key)).toEqual(['title', 'fqdn', 'runs'])
    const col = defs.find((d) => d.key === 'runs')!
    // A read-only relation cell (the chips of the linked objects): never written on this row.
    expect(col.type).toBe('entity_backlinks')
    expect(col.name).toBe('Runs')
    expect(normalizeTableConfig(host).properties.map((c) => c.id)).toEqual(['title', 'fqdn', 'runs'])
  })
})
