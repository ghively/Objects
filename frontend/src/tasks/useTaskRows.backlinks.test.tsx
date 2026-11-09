// Fix pass H (M5#5): the Tasks dashboard's rows carry backlinks (the Context grouping), so a change
// to an object that isn't a Task row (a page that gained `[[Loose task]]`) reloads the Task rows.
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { ChangeEvent } from '@/api/types'
import { objectSummary, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { resetTaskRows, useTaskRows, useTaskRowsFeed } from './useTaskRows'

const mocked = vi.mocked(api)
let listeners: ((e: ChangeEvent) => void)[] = []
const emit = (e: ChangeEvent) => act(() => listeners.forEach((l) => l(e)))

const TASK = typeDef({ id: 'task', name: 'Task', pluralName: 'Tasks', basic: true })
const loose = (backlinks: { target: string; path: string | null }[]) =>
  row({ summary: objectSummary({ path: 'Tasks/Loose task.md', type: 'task', title: 'Loose task' }), values: { backlinks }, version: 'v1' })

function Feed() {
  useTaskRowsFeed()
  return null
}

beforeEach(() => {
  listeners = []
  resetTaskRows()
  resetLinkIndex()
  useLinkIndex.setState({ types: [TASK], loaded: true })
  mocked.rows.mockReset()
  mocked.onChange.mockImplementation((cb: (e: ChangeEvent) => void) => {
    listeners.push(cb)
    return () => {
      listeners = listeners.filter((l) => l !== cb)
    }
  })
})

test('a change to an object outside the Task rows reloads them (backlinks may have changed)', async () => {
  mocked.rows.mockResolvedValue([loose([])])
  render(<Feed />)
  await waitFor(() => expect(useTaskRows.getState().rows).toHaveLength(1))
  mocked.rows.mockClear()
  mocked.rows.mockResolvedValue([loose([{ target: 'Draft outline', path: 'Pages/Draft outline.md' }])])
  emit({ kind: 'changed', path: 'Pages/Draft outline.md', version: 'p2' })
  await waitFor(() => expect(useTaskRows.getState().rows[0]?.values.backlinks).toHaveLength(1))
  expect(mocked.rows).toHaveBeenCalledWith({ typeIds: ['task'], preview: false })
})

test("a Task row's own change still refetches only that row", async () => {
  mocked.rows.mockResolvedValue([loose([])])
  render(<Feed />)
  await waitFor(() => expect(useTaskRows.getState().rows).toHaveLength(1))
  mocked.rows.mockClear()
  emit({ kind: 'changed', path: 'Tasks/Loose task.md', version: 'v2' })
  await waitFor(() => expect(mocked.rows).toHaveBeenCalledTimes(1))
  expect(mocked.rows).toHaveBeenCalledWith({ typeIds: ['task'], paths: ['Tasks/Loose task.md'], preview: false })
})
