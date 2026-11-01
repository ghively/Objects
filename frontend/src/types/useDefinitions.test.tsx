import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'
import { collection } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { useDefinitions, useDefs } from './useDefinitions'

const mocked = vi.mocked(api)

function Label({ tag }: { tag: string }) {
  const { collections, loaded } = useDefinitions()
  return <span>{`${tag}:${loaded ? collections.map((c) => c.name).join(',') : 'loading'}`}</span>
}

let swap: () => void = () => undefined
function Switcher() {
  const [which, setWhich] = useState<'a' | 'b'>('a')
  swap = () => setWhich('b')
  // Different component positions so `a` unmounts and `b` mounts in the same commit.
  return which === 'a' ? <Label key="a" tag="a" /> : <p><Label key="b" tag="b" /></p>
}

beforeEach(() => {
  mocked.collections.mockReset()
  mocked.queries.mockReset()
  mocked.collections.mockResolvedValue([collection({ id: 'c1', name: 'Tooling' })])
  mocked.queries.mockResolvedValue([])
})

test('an unmount and a mount in the same commit keep the loaded definitions', async () => {
  const { unmount } = render(<Switcher />)
  expect(await screen.findByText('a:Tooling')).toBeTruthy()
  expect(mocked.collections).toHaveBeenCalledTimes(1)

  act(() => swap())
  // No flash back to "loading" and no second fetch.
  expect(screen.getByText('b:Tooling')).toBeTruthy()
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
  expect(screen.getByText('b:Tooling')).toBeTruthy()
  expect(mocked.collections).toHaveBeenCalledTimes(1)
  expect(useDefs.getState().loaded).toBe(true)

  unmount()
  // With nobody left, the store resets once the deferred release runs.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
  expect(useDefs.getState().loaded).toBe(false)
})

test('a state write that changes nothing does not re-render consumers', async () => {
  let renders = 0
  function Counter() {
    useDefinitions()
    renders += 1
    return null
  }
  const { unmount } = render(<Counter />)
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
  const before = renders
  act(() => useDefs.setState({ loaded: true }))
  act(() => useDefs.setState((s) => ({ ...s })))
  expect(renders).toBe(before)
  unmount()
})
