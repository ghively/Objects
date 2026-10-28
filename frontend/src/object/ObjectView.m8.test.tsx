// M8 Task 3: the object's `…` menu items, the focus-mode button and the Task Stats mount.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ObjectDetail, SpaceInfo, TypeDef } from '@/api/types'
import { objectDetail, objectSummary, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/find/FindBar', () => ({ FindBar: () => null }))
vi.mock('@/references/ReferencesSection', () => ({ ReferencesSection: () => null }))
vi.mock('@/tasks/TaskStatsSection', () => ({
  TaskStatsSection: ({ path, version }: { path: string; version: string }) => (
    <div data-testid="task-stats">
      {path} {version}
    </div>
  ),
}))

import { api } from '@/api/client'
import { useFocusMode } from '@/focus/useFocusMode'
import { useVersionHistory } from '@/history/useVersionHistory'
import { resetLinkIndex } from '@/links/linkIndex'
import { useMerge } from '@/merge/useMerge'
import { usePeek, useTabs } from '@/nav/tabs'
import { usePresentation } from '@/present/usePresentation'
import { useAddToWhiteboard } from '@/whiteboard/AddToWhiteboardDialog'
import { ObjectView } from './ObjectView'

const mocked = vi.mocked(api)
const PAGE: TypeDef = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', revision: 'r1' })
const TAG: TypeDef = typeDef({ id: 'tag', name: 'Tag', pluralName: 'Tags', basic: true, revision: 'r1' })
const TASK: TypeDef = typeDef({ id: 'task', name: 'Task', pluralName: 'Tasks', basic: true, revision: 'r1' })

function detailFor(path: string, type: string, title: string): ObjectDetail {
  return objectDetail({
    summary: objectSummary({ path, type, title }),
    frontmatter: { type, title },
    body: 'Hello.\n',
    version: 'v1',
  })
}

function serve(detail: ObjectDetail) {
  mocked.objects.mockResolvedValue([detail.summary])
  mocked.object.mockResolvedValue(detail)
}

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  useVersionHistory.getState().close()
  useMerge.getState().close()
  usePresentation.getState().stop()
  useAddToWhiteboard.getState().close()
  useFocusMode.setState({ on: false })
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE, TAG, TASK] } satisfies SpaceInfo)
  mocked.resolve.mockResolvedValue(null)
  mocked.onChange.mockReturnValue(() => undefined)
})

async function openMenu() {
  const user = userEvent.setup()
  await screen.findByText('Hello.')
  await user.click(screen.getByRole('button', { name: 'More' }))
  return { user, menu: await screen.findByRole('menu') }
}

describe('ObjectView M8', () => {
  test('test object menu offers version history, merge, present and add to whiteboard', async () => {
    serve(detailFor('Pages/Notes.md', 'page', 'Notes'))
    render(<ObjectView path="Pages/Notes.md" mode="page" />)
    let { user, menu } = await openMenu()
    const names = within(menu)
      .getAllByRole('menuitem')
      .map((i) => i.textContent)
    for (const n of ['Version History', 'Merge into object', 'Present', 'Add to whiteboard']) expect(names).toContain(n)
    expect(names).not.toContain('Merge into tag')

    await user.click(within(menu).getByRole('menuitem', { name: 'Version History' }))
    expect(useVersionHistory.getState().path).toBe('Pages/Notes.md')
    ;({ user, menu } = await openMenu())
    await user.click(within(menu).getByRole('menuitem', { name: 'Merge into object' }))
    expect(useMerge.getState().source).toBe('Pages/Notes.md')
    ;({ user, menu } = await openMenu())
    await user.click(within(menu).getByRole('menuitem', { name: 'Present' }))
    expect(usePresentation.getState().path).toBe('Pages/Notes.md')
    ;({ user, menu } = await openMenu())
    await user.click(within(menu).getByRole('menuitem', { name: 'Add to whiteboard' }))
    expect(useAddToWhiteboard.getState().objectPath).toBe('Pages/Notes.md')
  })

  test('test object menu offers merge into tag for a tag', async () => {
    serve(detailFor('Tags/Old tag.md', 'tag', 'Old tag'))
    render(<ObjectView path="Tags/Old tag.md" mode="page" />)
    const { user, menu } = await openMenu()
    const names = within(menu)
      .getAllByRole('menuitem')
      .map((i) => i.textContent)
    expect(names).toContain('Merge into tag')
    expect(names).not.toContain('Merge into object')
    await user.click(within(menu).getByRole('menuitem', { name: 'Merge into tag' }))
    expect(useMerge.getState().source).toBe('Tags/Old tag.md')
  })

  test('test focus mode button toggles the store', async () => {
    const user = userEvent.setup()
    serve(detailFor('Pages/Notes.md', 'page', 'Notes'))
    render(<ObjectView path="Pages/Notes.md" mode="page" />)
    await screen.findByText('Hello.')
    await user.click(screen.getByRole('button', { name: 'Enter Focus Mode' }))
    expect(useFocusMode.getState().on).toBe(true)
    const leave = await screen.findByRole('button', { name: 'Leave Focus Mode' })
    expect(leave.getAttribute('aria-pressed')).toBe('true')
    await user.click(leave)
    expect(useFocusMode.getState().on).toBe(false)
    expect(await screen.findByRole('button', { name: 'Enter Focus Mode' })).toBeTruthy()
  })

  test('test focus mode button is only on the page view', async () => {
    serve(detailFor('Pages/Notes.md', 'page', 'Notes'))
    render(<ObjectView path="Pages/Notes.md" mode="peek" />)
    await screen.findByText('Hello.')
    expect(screen.queryByRole('button', { name: 'Enter Focus Mode' })).toBeNull()
  })

  test('test task stats section mounts only for recurring task objects', async () => {
    const recurring = detailFor('Tasks/Water plants.md', 'task', 'Water plants')
    recurring.frontmatter.repeat = 'every day'
    serve(recurring)
    const { unmount } = render(<ObjectView path="Tasks/Water plants.md" mode="page" />)
    await screen.findByText('Hello.')
    expect((await screen.findByTestId('task-stats')).textContent).toContain('Tasks/Water plants.md')
    unmount()

    // A task without a recurrence has no stats (the route would answer 422).
    serve(detailFor('Tasks/Submit report.md', 'task', 'Submit report'))
    const second = render(<ObjectView path="Tasks/Submit report.md" mode="page" />)
    await screen.findByText('Hello.')
    expect(screen.queryByTestId('task-stats')).toBeNull()
    second.unmount()

    serve(detailFor('Pages/Notes.md', 'page', 'Notes'))
    render(<ObjectView path="Pages/Notes.md" mode="page" />)
    await screen.findByText('Hello.')
    expect(screen.queryByTestId('task-stats')).toBeNull()
  })

  test('test completion log delete writes only the occurrence log', async () => {
    const user = userEvent.setup()
    const recurring = detailFor('Tasks/Water plants.md', 'task', 'Water plants')
    recurring.frontmatter.repeat = 'every day'
    recurring.frontmatter.occurrenceLog =
      '2026-10-21 completed 2026-10-21T07:55:10Z\n2026-10-22 skipped 2026-10-23T06:30:00Z'
    serve(recurring)
    mocked.updateProperties.mockResolvedValue({ version: 'v2', frontmatter: recurring.frontmatter, links: {} } as never)
    render(<ObjectView path="Tasks/Water plants.md" mode="page" />)
    const log = await screen.findByRole('region', { name: 'Completion Log' })
    const newest = within(log).getAllByRole('listitem')[0]
    expect(newest).toHaveTextContent('Skipped')
    await user.click(within(newest).getByRole('button'))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
    await vi.waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledTimes(1))
    expect(mocked.updateProperties).toHaveBeenCalledWith(
      'Tasks/Water plants.md',
      { occurrenceLog: '2026-10-21 completed 2026-10-21T07:55:10Z' },
      'v1',
      undefined,
    )
  })
})
