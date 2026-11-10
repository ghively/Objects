// M31: the app's query evaluation and its server port (`backend/objectapp/queryeval.py`, which
// `POST /api/v1/queries/{id}/run` and MCP's `run_saved_query` use) answer the same shared cases;
// `backend/tests/test_m31_query_parity.py` runs this file's fixture too. `matches` is this
// engine's answer, in its order.
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Collection, QueryDefinition, Row, RowsScope, TypeDef } from '@/api/types'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import type { GroupCtx } from '@/views/group'
import cases from './__fixtures__/query-cases.json'
import { isQueryReady, queryScope, runQuery } from './runQuery'

interface Case {
  name: string
  definition: QueryDefinition
  scope: RowsScope
  matches: string[]
}

const rows = cases.rows as unknown as Row[]
const types = cases.types as unknown as TypeDef[]

/** The rows `POST /api/rows` returns for the scope's types (search terms are the server's). */
function fetched(scope: RowsScope): Row[] {
  return scope.typeIds ? rows.filter((r) => scope.typeIds?.includes(r.summary.type)) : rows
}

/** `DataView`'s context: the view's types are the scope's, else its rows', else every type. */
function ctxFor(scope: RowsScope, inScope: Row[]): GroupCtx {
  const ids = scope.typeIds?.length ? scope.typeIds : [...new Set(inScope.map((r) => r.summary.type))]
  const found = ids.filter((id) => types.some((t) => t.id === id))
  return {
    types,
    viewTypeIds: found.length ? found : types.map((t) => t.id),
    collections: cases.collections as unknown as Collection[],
    tagIdsToTitles: cases.tagIdsToTitles,
    pathsById: cases.pathsById,
    entityTitles: cases.entityTitles,
    now: new Date(cases.now),
  }
}

/** A query that isn't ready asks for no type (`QueryPage`). */
const scopeOf = (def: QueryDefinition): RowsScope => (isQueryReady(def) ? queryScope(def, cases.allTypeIds) : { typeIds: [] })

function answer(def: QueryDefinition): { scope: RowsScope; matches: string[] } {
  const scope = scopeOf(def)
  const inScope = fetched(scope)
  let i = 0
  const rng = () => cases.rng[i++ % cases.rng.length]
  const out = runQuery(def, inScope, ctxFor(scope, inScope), rng)
  return { scope, matches: out.rows.map((r) => r.summary.path) }
}

describe('saved-query parity with the server', () => {
  beforeEach(() => useSettings.setState({ settings: { ...settingsDefaults, timeZone: cases.timeZone } }))
  afterEach(() => useSettings.setState({ settings: settingsDefaults }))

  test.each((cases.cases as unknown as Case[]).map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(answer(c.definition)).toEqual({ scope: c.scope, matches: c.matches })
  })
})
