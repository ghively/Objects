import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ViewState } from '@/api/types'
import { propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ApiError, ConflictError } from '@/api/client'
import { emptyFilterGroup } from './model'
import { RelationPairsPage } from './RelationPairsPage'

const mocked = vi.mocked(api)

const STORY = typeDef({ id: 'story', name: 'Story', revision: 'r3', propertyDefinitions: [propertyDef({ id: 'title', type: 'entity_title' })] })
const WITH_PAIRS = {
  ...STORY,
  revision: 'r4',
  propertyDefinitions: [
    ...STORY.propertyDefinitions,
    propertyDef({ id: 'p1', key: 'parentItem', name: 'Parent item', type: 'entity' }),
    propertyDef({ id: 'p2', key: 'subItems', name: 'Sub-items', type: 'entity' }),
    propertyDef({ id: 'd1', key: 'blockedBy', name: 'Blocked by', type: 'entity' }),
    propertyDef({ id: 'd2', key: 'blocking', name: 'Blocking', type: 'entity' }),
  ],
}

const base: ViewState = { viewDefinition: { dataViewLayout: 'timeline' }, filterGroup: emptyFilterGroup(), sorts: [], groupBy: null }
let last: ViewState | null = null

function Harness({ type, init = base }: { type: typeof STORY; init?: ViewState }) {
  const [state, setState] = useState(init)
  return (
    <RelationPairsPage
      type={type}
      state={state}
      onState={(s) => {
        last = s
        setState(s)
      }}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  last = null
})

describe('RelationPairsPage', () => {
  test('turning on sub-items adds the pair and stores its keys', async () => {
    mocked.createRelationPair.mockResolvedValueOnce({ type: WITH_PAIRS, firstId: 'p1', secondId: 'p2', created: true })
    const { rerender } = render(<Harness type={STORY} />)
    await userEvent.click(screen.getByRole('button', { name: 'Turn on sub-items' }))
    expect(mocked.createRelationPair).toHaveBeenCalledWith('story', 'subItems', 'r3')
    await waitFor(() => expect(last?.viewDefinition.subItemsConfig).toEqual({ parentPropertyId: 'parentItem', childrenPropertyId: 'subItems' }))
    expect(last?.viewDefinition.dependenciesConfig).toBeUndefined()
    // Once the type has the properties, the section reads "On" with "Turn off".
    rerender(<Harness type={WITH_PAIRS} init={last!} />)
    expect(screen.getAllByRole('button', { name: 'Turn off' })).toHaveLength(1)
  })

  test('turning on dependencies stores the dependency keys', async () => {
    mocked.createRelationPair.mockResolvedValueOnce({ type: WITH_PAIRS, firstId: 'd1', secondId: 'd2', created: false })
    render(<Harness type={STORY} />)
    await userEvent.click(screen.getByRole('button', { name: 'Turn on dependencies' }))
    expect(mocked.createRelationPair).toHaveBeenCalledWith('story', 'dependencies', 'r3')
    await waitFor(() => expect(last?.viewDefinition.dependenciesConfig).toEqual({ blockedByPropertyId: 'blockedBy', blockingPropertyId: 'blocking' }))
  })

  test('"Turn off" clears only the view key', async () => {
    const init: ViewState = {
      ...base,
      viewDefinition: {
        ...base.viewDefinition,
        subItemsConfig: { parentPropertyId: 'parentItem', childrenPropertyId: 'subItems' },
        dependenciesConfig: { blockedByPropertyId: 'blockedBy', blockingPropertyId: 'blocking' },
      },
    }
    render(<Harness type={WITH_PAIRS} init={init} />)
    const offs = screen.getAllByRole('button', { name: 'Turn off' })
    expect(offs).toHaveLength(2)
    await userEvent.click(offs[0])
    expect(last?.viewDefinition.subItemsConfig).toBeUndefined()
    expect(last?.viewDefinition.dependenciesConfig).toEqual(init.viewDefinition.dependenciesConfig)
    expect(mocked.createRelationPair).not.toHaveBeenCalled()
    expect(mocked.saveType).not.toHaveBeenCalled()
  })

  test('a stale type or a refusal is shown, and the view is left alone', async () => {
    mocked.createRelationPair.mockRejectedValueOnce(new ConflictError('r9'))
    render(<Harness type={STORY} />)
    await userEvent.click(screen.getByRole('button', { name: 'Turn on sub-items' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The type changed elsewhere. Try again.')
    mocked.createRelationPair.mockRejectedValueOnce(new ApiError(422, 'A property named "Sub-items" already exists'))
    await userEvent.click(screen.getByRole('button', { name: 'Turn on sub-items' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('"Sub-items"'))
    expect(last).toBeNull()
  })

  test('decision AC-1: the basic Task type takes the pairs', async () => {
    const TASK = { ...STORY, id: 'task', name: 'Task', basic: true }
    mocked.createRelationPair.mockResolvedValueOnce({ type: { ...WITH_PAIRS, id: 'task', name: 'Task', basic: true }, firstId: 'd1', secondId: 'd2', created: true })
    render(<Harness type={TASK} />)
    expect(screen.queryByText('The properties of basic types are fixed.')).toBeNull()
    expect((screen.getByRole('button', { name: 'Turn on sub-items' }) as HTMLButtonElement).disabled).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Turn on dependencies' }))
    expect(mocked.createRelationPair).toHaveBeenCalledWith('task', 'dependencies', 'r3')
    await waitFor(() => expect(last?.viewDefinition.dependenciesConfig).toEqual({ blockedByPropertyId: 'blockedBy', blockingPropertyId: 'blocking' }))
  })

  test('a basic type other than Task can not take the pairs', () => {
    render(<Harness type={{ ...STORY, name: 'Page', basic: true }} />)
    expect((screen.getByRole('button', { name: 'Turn on sub-items' }) as HTMLButtonElement).disabled).toBe(true)
    // The one sentence the backend and the Add property menu use for basic types.
    expect(screen.getByText('The properties of basic types are fixed.')).toBeTruthy()
  })
})
