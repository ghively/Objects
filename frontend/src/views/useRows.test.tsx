// `useRows` with `backlinks` (the Tasks dashboard): a change to an object outside the rows refreshes
// only the rows its `linked` names; without `linked` (an older server, an index that couldn't say)
// everything reloads as before.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeEvent, Row } from '@/api/types'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { objectSummary, row } from '@/test/mockApi'
import { useRows } from './useRows'

const mocked = vi.mocked(api)
let listeners: ((e: ChangeEvent) => void)[] = []
const fire = (e: ChangeEvent) => {
  for (const l of listeners) l(e)
}
const SCOPE = { typeIds: ['task'] }
const TASKS: Row[] = ['Tasks/A.md', 'Tasks/B.md'].map((path) =>
  row({ summary: objectSummary({ path, type: 'task', title: path }) }),
)

beforeEach(() => {
  vi.useFakeTimers()
  listeners = []
  mocked.rows.mockReset()
  mocked.rows.mockImplementation(async (scope) => {
    const paths = (scope as { paths?: string[] }).paths
    return paths ? TASKS.filter((r) => paths.includes(r.summary.path)) : TASKS
  })
  mocked.onChange.mockImplementation((cb) => {
    listeners.push(cb)
    return () => {
      listeners = listeners.filter((l) => l !== cb)
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
})

const settle = async () => {
  await act(async () => {
    await Promise.resolve()
  })
}

async function mount() {
  const hook = renderHook(() => useRows(SCOPE, { backlinks: true }))
  await settle()
  expect(hook.result.current.rows).toHaveLength(2)
  mocked.rows.mockClear()
  return hook
}

const window = async () => {
  await act(async () => {
    vi.advanceTimersByTime(150)
    await Promise.resolve()
  })
}

describe('useRows with backlinks', () => {
  test('a change elsewhere naming a row refreshes that row only', async () => {
    await mount()
    act(() => {
      fire({ kind: 'changed', path: 'DailyNotes/2026-11-09.md', version: 'v', linked: ['Tasks/B.md', 'People/X.md'] })
    })
    await window()
    expect(mocked.rows).toHaveBeenCalledTimes(1)
    expect(mocked.rows).toHaveBeenCalledWith({ ...SCOPE, paths: ['Tasks/B.md'], preview: false })
  })

  test('a change elsewhere with no linked targets asks for nothing', async () => {
    await mount()
    act(() => {
      fire({ kind: 'changed', path: 'DailyNotes/2026-11-09.md', version: 'v', linked: [] })
    })
    await window()
    expect(mocked.rows).not.toHaveBeenCalled()
  })

  test('a change elsewhere without linked reloads everything, as before', async () => {
    await mount()
    act(() => {
      fire({ kind: 'changed', path: 'DailyNotes/2026-11-09.md', version: 'v' })
    })
    await window()
    expect(mocked.rows).toHaveBeenCalledTimes(1)
    expect(mocked.rows).toHaveBeenCalledWith({ ...SCOPE, preview: false })
  })

  test('one unknown change in the window reloads everything', async () => {
    await mount()
    act(() => {
      fire({ kind: 'changed', path: 'DailyNotes/2026-11-09.md', version: 'v', linked: ['Tasks/B.md'] })
      fire({ kind: 'changed', path: 'Pages/P.md', version: 'v', linked: null })
    })
    await window()
    expect(mocked.rows).toHaveBeenCalledTimes(1)
    expect(mocked.rows).toHaveBeenCalledWith({ ...SCOPE, preview: false })
  })

  test('changed rows and linked rows are fetched in one call', async () => {
    await mount()
    act(() => {
      fire({ kind: 'changed', path: 'Tasks/A.md', version: 'v', linked: [] })
      fire({ kind: 'changed', path: 'DailyNotes/2026-11-09.md', version: 'v', linked: ['Tasks/B.md'] })
    })
    await window()
    expect(mocked.rows).toHaveBeenCalledTimes(1)
    const call = mocked.rows.mock.calls[0][0] as { paths?: string[] }
    expect([...(call.paths ?? [])].sort()).toEqual(['Tasks/A.md', 'Tasks/B.md'])
  })
})
