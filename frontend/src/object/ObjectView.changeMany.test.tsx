// M4 Task 8: a cell that writes several keys (the Task date with repeat and remind) goes through
// PropertyPanel's onChangeMany and reaches the server as one updateProperties call.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ObjectDetail, SpaceInfo, TypeDef, UpdateResult } from '@/api/types'
import { objectDetail, objectSummary, propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('./PropertyPanel', async (orig) => {
  const real = await orig<typeof import('./PropertyPanel')>()
  return {
    ...real,
    PropertyPanel: (p: { onChangeMany?(u: Record<string, unknown>, r?: string[]): void }) => (
      <button type="button" onClick={() => p.onChangeMany?.({ date: '2026-10-30', repeat: 'every week' }, ['remind'])}>
        write many
      </button>
    ),
  }
})

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { ObjectPage } from './ObjectPage'

const mocked = vi.mocked(api)
// A property of its own, as the real Task type has: its pane starts open (M32).
const TASK: TypeDef = typeDef({
  id: 'task',
  name: 'Task',
  pluralName: 'Tasks',
  revision: 'r1',
  propertyDefinitions: [propertyDef({ id: 'status', key: 'status', name: 'Status', type: 'label' })],
})
const PATH = 'Tasks/Call.md'
const DETAIL: ObjectDetail = objectDetail({
  summary: objectSummary({ path: PATH, type: 'task', title: 'Call' }),
  frontmatter: { type: 'Task', title: 'Call', repeat: 'every day', remind: 'on the day at 09:00' },
  body: 'Body.\n',
  version: 'v1',
})

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [TASK] } satisfies SpaceInfo)
  mocked.objects.mockResolvedValue([DETAIL.summary])
  mocked.object.mockResolvedValue(DETAIL)
  mocked.resolve.mockResolvedValue(null)
  mocked.onChange.mockReturnValue(() => {})
  mocked.updateProperties.mockImplementation(
    async (_p: string, updates: Record<string, unknown>): Promise<UpdateResult> => ({
      version: 'v2',
      frontmatter: { ...updates },
      links: {},
      synced: [],
      skipped: [],
    }),
  )
})

describe('ObjectView onChangeMany', () => {
  test('test ObjectView writes several keys in one updateProperties call', async () => {
    render(<ObjectPage path={PATH} />)
    fireEvent.click(await screen.findByRole('button', { name: 'write many' }))
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledTimes(1))
    expect(mocked.updateProperties).toHaveBeenCalledWith(PATH, { date: '2026-10-30', repeat: 'every week' }, 'v1', ['remind'])
  })
})
