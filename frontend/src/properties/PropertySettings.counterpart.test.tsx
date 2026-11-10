// M28 Task 10: naming a relation's other side ("Show on the other side as") in property settings.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { PropertyDef, TypeDef } from '@/api/types'
import { propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ApiError } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { counterpartKey } from './counterpartKey'
import { PropertySettings } from './PropertySettings'

const RUNS_ON = propertyDef({
  id: 'p-runs-on',
  key: 'runsOn',
  name: 'Runs on',
  type: 'entity',
  options: { isArray: true, allowedTypes: ['host'], hasFixedSet: false, fixedSet: [] },
})
const SYNCED = propertyDef({
  id: 'p-team',
  key: 'team',
  name: 'Team',
  type: 'entity',
  options: { isArray: true, allowedTypes: ['host'], hasFixedSet: false, fixedSet: [], propertySyncing: { propertyIds: ['p-apps'] } },
})
const HOST = typeDef({
  id: 'host',
  name: 'Host',
  pluralName: 'Hosts',
  revision: 'rh',
  propertyDefinitions: [
    propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' }),
    propertyDef({ id: 'p-category', key: 'category', name: 'Category', type: 'label' }),
    propertyDef({ id: 'p-apps', key: 'apps', name: 'Apps', type: 'entity', options: { allowedTypes: ['application'] } }),
  ],
})
const APPLICATION = typeDef({
  id: 'application',
  name: 'Application',
  pluralName: 'Applications',
  revision: 'ra',
  propertyDefinitions: [propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' }), RUNS_ON, SYNCED],
})

function savedDef(id: string, call = 0): PropertyDef | undefined {
  return (vi.mocked(api.saveType).mock.calls[call][0] as TypeDef).propertyDefinitions.find((d) => d.id === id)
}

function open(propertyId: string) {
  render(<PropertySettings typeId="application" propertyId={propertyId} open onOpenChange={vi.fn()} />)
}

function withRunsOn(options: PropertyDef['options']) {
  const def = { ...RUNS_ON, options: { ...RUNS_ON.options, ...options } }
  const app = { ...APPLICATION, propertyDefinitions: APPLICATION.propertyDefinitions.map((d) => (d.id === def.id ? def : d)) }
  useLinkIndex.setState({ types: [app, HOST], objects: [], loaded: true })
}

beforeEach(() => {
  vi.mocked(api.saveType).mockReset()
  vi.mocked(api.saveType).mockImplementation(async (t: TypeDef) => ({ type: t, rewritten: [], skipped: [] }))
  resetLinkIndex()
  useLinkIndex.setState({ types: [APPLICATION, HOST], objects: [], loaded: true })
})

describe('test M28 counterpartKey', () => {
  test('test keys are camel case, unique and fall back to otherSide', () => {
    expect(counterpartKey('Runs', new Set())).toBe('runs')
    expect(counterpartKey('Used by', new Set())).toBe('usedBy')
    expect(counterpartKey('Documented in', new Set(['documentedIn']))).toBe('documentedIn2')
    expect(counterpartKey('Été', new Set())).toBe('ete')
    expect(counterpartKey('日本', new Set())).toBe('otherSide')
    // A system key is never used.
    expect(counterpartKey('Title', new Set())).toBe('title2')
  })
})

describe('test M28 Show on the other side as', () => {
  test('test typing a name saves the counterpart with a new key', async () => {
    const user = userEvent.setup()
    open('p-runs-on')
    const field = screen.getByRole('textbox', { name: 'Show on the other side as' })
    expect(field).toHaveAttribute('placeholder', 'No other side')
    await user.type(field, 'Runs{Enter}')
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(savedDef('p-runs-on')?.options.counterpart).toEqual({ name: 'Runs', key: 'runs' })
  })

  test('test the key avoids the target type stored keys', async () => {
    const user = userEvent.setup()
    open('p-runs-on')
    await user.type(screen.getByRole('textbox', { name: 'Show on the other side as' }), 'Category{Enter}')
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(savedDef('p-runs-on')?.options.counterpart).toEqual({ name: 'Category', key: 'category2' })
  })

  test('test renaming keeps the key', async () => {
    const user = userEvent.setup()
    withRunsOn({ counterpart: { name: 'Runs', key: 'runs' } })
    open('p-runs-on')
    const field = screen.getByRole('textbox', { name: 'Show on the other side as' })
    expect(field).toHaveValue('Runs')
    await user.clear(field)
    await user.type(field, 'Hosts it{Enter}')
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(savedDef('p-runs-on')?.options.counterpart).toEqual({ name: 'Hosts it', key: 'runs' })
  })

  test('test clearing saves null', async () => {
    const user = userEvent.setup()
    withRunsOn({ counterpart: { name: 'Runs', key: 'runs' } })
    open('p-runs-on')
    const field = screen.getByRole('textbox', { name: 'Show on the other side as' })
    await user.clear(field)
    await user.tab()
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(savedDef('p-runs-on')?.options.counterpart).toBeNull()
  })

  test('test an unchanged name saves nothing', async () => {
    const user = userEvent.setup()
    withRunsOn({ counterpart: { name: 'Runs', key: 'runs' } })
    open('p-runs-on')
    await user.click(screen.getByRole('textbox', { name: 'Show on the other side as' }))
    await user.tab()
    expect(api.saveType).not.toHaveBeenCalled()
  })

  test('test a synced relation shows the note and no field', () => {
    open('p-team')
    expect(screen.getByText('This relation already syncs both ways.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Show on the other side as' })).toBeNull()
  })

  test('test a 422 from the save is shown', async () => {
    const user = userEvent.setup()
    vi.mocked(api.saveType).mockRejectedValueOnce(new ApiError(422, 'Host already has a property with the key "category".'))
    open('p-runs-on')
    await user.type(screen.getByRole('textbox', { name: 'Show on the other side as' }), 'Runs{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Host already has a property with the key "category".')
  })
})
