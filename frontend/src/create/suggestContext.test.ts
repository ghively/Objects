// M29 Task 8: the create row's context: the active tab's types and the last type.
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { QueryDefinition } from '@/api/types'
import { useTabs } from '@/nav/tabs'
import { collection, query, typeDef } from '@/test/mockApi'
import { useDefs } from '@/types/useDefinitions'
import { setLastTypeSpace, useLastType } from './lastType'
import { scopeTypesOfActiveTab, suggestFor } from './suggestContext'

const HOST = ['{ip}', '{fqdn}', 'SRV-*', '@@##', '@@@##', '@@@@##', '@*-##']
const types = [
  typeDef({ id: 'page' }),
  typeDef({ id: 'host', namePatterns: HOST }),
  typeDef({ id: 'application' }),
  typeDef({ id: 'software', namePatterns: ['{version}'] }),
  typeDef({ id: 'runbook' }),
]

beforeEach(async () => {
  localStorage.clear()
  await setLastTypeSpace(null)
  useTabs.getState().reset()
  const q1 = query({ id: 'q1' })
  const definition = { ...q1.definition, types: [{ id: 'software' }, { id: 'host' }] } as QueryDefinition
  useDefs.setState({
    collections: [collection({ id: 'c1', typeIds: ['host', 'application'] })],
    queries: [{ ...q1, definition }],
    loaded: true,
  })
})

afterEach(() => {
  useTabs.getState().reset()
  useDefs.setState({ collections: [], queries: [], loaded: false })
})

describe('suggest context', () => {
  test('a collection tab gives its typeIds', () => {
    useTabs.getState().open({ kind: 'collection', id: 'c1' })
    expect(scopeTypesOfActiveTab()).toEqual(['host', 'application'])
  })

  test("a query tab gives its definition's type ids", () => {
    useTabs.getState().open({ kind: 'query', id: 'q1' })
    expect(scopeTypesOfActiveTab()).toEqual(['software', 'host'])
  })

  test('a type page gives [id]', () => {
    useTabs.getState().open({ kind: 'type', typeId: 'runbook' })
    expect(scopeTypesOfActiveTab()).toEqual(['runbook'])
  })

  test('an object tab gives []', () => {
    useTabs.getState().open({ kind: 'object', path: 'Pages/A.md' })
    expect(scopeTypesOfActiveTab()).toEqual([])
    useTabs.getState().reset()
    expect(scopeTypesOfActiveTab()).toEqual([])
  })

  test("suggestFor('APP01') with last runbook gives host then runbook; allowed wins", () => {
    useTabs.getState().open({ kind: 'object', path: 'Pages/A.md' })
    useLastType.getState().set('runbook')
    expect(suggestFor('APP01', types)).toEqual(['host', 'runbook'])
    expect(suggestFor('APP01', types, { allowed: ['software'] })).toEqual(['software'])
  })

  test('the active collection is the context unless a scope is given', () => {
    useTabs.getState().open({ kind: 'collection', id: 'c1' })
    useLastType.getState().set('runbook')
    expect(suggestFor('Payroll', types)).toEqual(['host', 'application'])
    expect(suggestFor('Payroll', types, { scope: [] })).toEqual(['runbook'])
  })
})
