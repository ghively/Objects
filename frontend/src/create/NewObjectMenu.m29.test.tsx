// M29 Task 10: "+ New object" without a type lists the suggested type first (the context, else the
// last type), marked "Suggested"; picking it creates with no templateId.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { collection, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { useTabs } from '@/nav/tabs'
import { useDefs } from '@/types/useDefinitions'
import { setLastTypeSpace, useLastType } from './lastType'
import { NewObjectMenu } from './NewObjectMenu'

const mocked = vi.mocked(api)

const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true })
const HOST = typeDef({ id: 'host', name: 'Host', pluralName: 'Hosts', namePatterns: ['@@@##'] })
const TASK = typeDef({ id: 'task', name: 'Task', pluralName: 'Tasks', basic: true })
const BOARD = typeDef({ id: 'whiteboard', name: 'Whiteboard', pluralName: 'Whiteboards', basic: true })
const TYPES = [PAGE, HOST, TASK, BOARD]

beforeEach(async () => {
  localStorage.clear()
  await setLastTypeSpace(null)
  useTabs.getState().reset()
  resetLinkIndex()
  mocked.createObject.mockClear()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: TYPES })
  mocked.objects.mockResolvedValue([])
  useLinkIndex.setState({ types: TYPES, objects: [], loaded: true })
  useDefs.setState({ collections: [collection({ id: 'c-hosts', typeIds: ['host'] })], queries: [], loaded: true })
})

afterEach(() => {
  useDefs.setState({ collections: [], queries: [], loaded: false })
})

const names = () => screen.getAllByRole('option').map((o) => o.textContent)

describe('NewObjectMenu suggested type (M29)', () => {
  test('on a collection of Hosts, Host is first and marked Suggested', () => {
    useTabs.getState().open({ kind: 'collection', id: 'c-hosts' })
    render(<NewObjectMenu open onOpenChange={() => undefined} />)
    expect(names()).toEqual(['HostSuggested', 'Page', 'Task', 'Whiteboard'])
  })

  test('elsewhere the last type is first', () => {
    useTabs.getState().open({ kind: 'object', path: 'Pages/A.md' })
    useLastType.getState().set('task')
    render(<NewObjectMenu open onOpenChange={() => undefined} />)
    expect(names()).toEqual(['TaskSuggested', 'Host', 'Page', 'Whiteboard'])
  })

  test('no last type keeps the order as before', () => {
    render(<NewObjectMenu open onOpenChange={() => undefined} />)
    expect(names()).toEqual(['Host', 'Page', 'Task', 'Whiteboard'])
  })

  test('typing keeps the filtered order without a suggestion', async () => {
    const user = userEvent.setup()
    useLastType.getState().set('task')
    render(<NewObjectMenu open onOpenChange={() => undefined} />)
    await user.type(screen.getByRole('textbox', { name: 'Search Object Types' }), 'a')
    expect(names()).toEqual(['Page', 'Task', 'Whiteboard'])
  })

  test('picking the suggested type creates with no templateId', async () => {
    const user = userEvent.setup()
    useTabs.getState().open({ kind: 'collection', id: 'c-hosts' })
    render(<NewObjectMenu open onOpenChange={() => undefined} />)
    await user.click(screen.getByRole('option', { name: /Host/ }))
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('host', {}))
    expect(mocked.createObject.mock.calls[0][1]).not.toHaveProperty('templateId')
    expect(useLastType.getState().typeId).toBe('host')
  })
})
