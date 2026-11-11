// The walk's W11 (decision): a task's own page had no tick; the only way to finish it there was
// Status > Done. The page shows the circle the task rows have, beside the title, for the Task type.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ObjectDetail, SpaceInfo, TypeDef, UpdateResult } from '@/api/types'
import { objectDetail, objectSummary, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/find/FindBar', () => ({ FindBar: () => null }))
vi.mock('@/references/ReferencesSection', () => ({ ReferencesSection: () => null }))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { ADD_DONE_TEXT } from '@/tasks/TaskCheckbox'
import { TASK_TYPE } from '@/tasks/taskFixtures'
import { ObjectView } from './ObjectView'

const mocked = vi.mocked(api)
const TASK: TypeDef = { ...TASK_TYPE, revision: 'r1' }
const PAGE: TypeDef = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', revision: 'r1', basic: true })
/** A type of the user's own that has a status: not a task. */
const PROJECT: TypeDef = { ...TASK_TYPE, id: 'project', name: 'Project', pluralName: 'Projects', basic: false, revision: 'r1' }
const NO_DONE: TypeDef = {
  ...TASK,
  propertyDefinitions: TASK.propertyDefinitions.map((d) =>
    d.key === 'status' ? { ...d, options: { ...d.options, set: (d.options.set ?? []).filter((o) => o.statusCategory !== 'done') } } : d,
  ),
}
const PATH = 'Tasks/Call Pat.md'

let onDisk: ObjectDetail

function task(frontmatter: Record<string, unknown>, version: string, type = 'task'): ObjectDetail {
  return objectDetail({
    summary: objectSummary({ id: 'id-1', path: PATH, type, title: 'Call Pat' }),
    frontmatter: { type: 'Task', title: 'Call Pat', ...frontmatter },
    body: 'Ask about the car.\n',
    version,
  })
}

const answer = (frontmatter: Record<string, unknown>, version: string, t?: UpdateResult['task']): UpdateResult => ({
  version,
  frontmatter,
  links: {},
  synced: [],
  skipped: [],
  task: t,
})

function space(types: TypeDef[]) {
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types } satisfies SpaceInfo)
}

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  document.querySelector('[data-editor-toasts]')?.remove()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  space([TASK, PAGE, PROJECT])
  onDisk = task({ status: ['Next Up'] }, 'v1')
  mocked.objects.mockImplementation(async () => [onDisk.summary])
  mocked.object.mockImplementation(async () => onDisk)
  mocked.resolve.mockResolvedValue(null)
  mocked.onChange.mockReturnValue(() => undefined)
})

/** The circle beside the title (the pane's own Status row is another control). */
const circle = (container: HTMLElement) => within(container.querySelector('[data-page-title]') as HTMLElement).queryByRole('checkbox')

describe.each(['page', 'peek'] as const)("a task's own %s has the tick", (mode) => {
  test('test the circle is beside the title; ticking sets the done status through the note\'s own write, and unticking reopens it', async () => {
    const user = userEvent.setup()
    mocked.updateProperties.mockImplementation(async (_p, updates) => {
      const done = (updates.status as string[])[0] === 'Done'
      return answer({ ...updates, completed: done ? '2026-11-11T10:00:00Z' : null }, done ? 'v2' : 'v3', { completed: done, advanced: false })
    })
    const { container } = render(<ObjectView path={PATH} mode={mode} />)
    await screen.findByRole('textbox', { name: 'Title' })
    const box = await waitFor(() => {
      const el = circle(container)
      expect(el).not.toBeNull()
      return el!
    })
    expect(box).toHaveAttribute('aria-checked', 'false')
    // On the title's row, before the title.
    const title = screen.getByRole('textbox', { name: 'Title' })
    expect(box.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.click(box)
    // The same call the task rows make (the first done option), on the note's version.
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenCalledWith(PATH, { status: ['Done'] }, 'v1', undefined))
    await waitFor(() => expect(circle(container)).toHaveAttribute('aria-checked', 'true'))
    expect(mocked.updateProperties).toHaveBeenCalledTimes(1)
    // No row to reload: the page shows the note itself.
    expect(mocked.rows).not.toHaveBeenCalled()

    // Unticking as in the rows: the first not-started option, on the version the tick answered.
    await user.click(circle(container)!)
    await waitFor(() => expect(mocked.updateProperties).toHaveBeenLastCalledWith(PATH, { status: ['Not Started'] }, 'v2', undefined))
    await waitFor(() => expect(circle(container)).toHaveAttribute('aria-checked', 'false'))
  }, 20000)
})

describe("a task's own page", () => {
  test('test a done task opens ticked', async () => {
    onDisk = task({ status: ['Done'] }, 'v1')
    const { container } = render(<ObjectView path={PATH} mode="page" />)
    await waitFor(() => expect(circle(container)).toHaveAttribute('aria-checked', 'true'))
  }, 20000)

  test('test a recurring task that moved on says so, as the rows do', async () => {
    const user = userEvent.setup()
    onDisk = task({ status: ['Next Up'], repeat: 'every week', date: '2026-11-11' }, 'v1')
    mocked.overdue.mockRejectedValue(new Error('not by due date'))
    mocked.updateProperties.mockResolvedValue(
      answer({ status: ['Next Up'], date: '2026-11-18' }, 'v2', { completed: true, advanced: true, date: { start: '2026-11-18', resolution: 'day' } }),
    )
    const { container } = render(<ObjectView path={PATH} mode="page" />)
    await user.click(await waitFor(() => circle(container)!))
    await waitFor(() => expect(document.querySelector('.editor-toast')?.textContent).toMatch(/^Moved to /))
    expect(circle(container)).toHaveAttribute('aria-checked', 'false')
  }, 20000)

  test('test on a Task type with no done status the tick offers to add one, as in the rows', async () => {
    const user = userEvent.setup()
    space([NO_DONE, PAGE])
    const { container } = render(<ObjectView path={PATH} mode="page" />)
    await user.click(await waitFor(() => circle(container)!))
    expect(await screen.findByRole('button', { name: ADD_DONE_TEXT.button })).toBeInTheDocument()
    expect(mocked.updateProperties).not.toHaveBeenCalled()
  }, 20000)

  test('test a read-only task shows the circle disabled', async () => {
    onDisk = { ...onDisk, summary: { ...onDisk.summary, readOnly: true, readOnlyReason: 'locked' } }
    const { container } = render(<ObjectView path={PATH} mode="page" />)
    await waitFor(() => expect(circle(container)).toBeDisabled())
  }, 20000)

  test.each([
    ['a note', 'page', 'Page'],
    ['a note of another type with a status', 'project', 'Project'],
  ])('test %s has no tick: it is for tasks', async (_name, typeId, typeName) => {
    onDisk = objectDetail({
      summary: objectSummary({ id: 'id-2', path: 'Pages/Plans.md', type: typeId, title: 'Plans' }),
      frontmatter: { type: typeName, title: 'Plans', status: ['Next Up'] },
      body: 'Hello.\n',
      version: 'v1',
    })
    const { container } = render(<ObjectView path="Pages/Plans.md" mode="page" />)
    await screen.findByRole('textbox', { name: 'Title' })
    await screen.findByText('Hello.')
    expect(circle(container)).toBeNull()
  }, 20000)
})
