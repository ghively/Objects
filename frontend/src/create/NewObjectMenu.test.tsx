import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { objectSummary, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { whiteboardApi } from '@/api/whiteboardClient'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { TypePage } from '@/types/TypePage'
import { createAndOpen } from './createAndOpen'
import { NewObjectMenu } from './NewObjectMenu'

const mocked = vi.mocked(api)

const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true })
const PROJECT = typeDef({
  id: 'project',
  name: 'Project',
  pluralName: 'Projects',
  templates: { ids: ['tpl-b', 'tpl-a'], defaultTemplateId: null },
})
const TASK = typeDef({ id: 'task', name: 'Task', pluralName: 'Tasks', basic: true })

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE, PROJECT, TASK] })
  mocked.objects.mockResolvedValue([])
  useLinkIndex.setState({
    types: [PAGE, PROJECT, TASK],
    objects: [objectSummary({ path: 'Projects/Apollo.md', type: 'project', title: 'Apollo' })],
    loaded: true,
  })
})

async function pickType(user: ReturnType<typeof userEvent.setup>, name: string) {
  expect(screen.getByRole('textbox', { name: 'Search Object Types' })).toBeInTheDocument()
  await user.click(screen.getByRole('option', { name: name }))
  return screen.getByRole('textbox', { name: 'Search or Create' })
}

describe('NewObjectMenu', () => {
  test(`test NewObjectMenu type step then "New 'Foo'" calls createObject(typeId,{title:'Foo'}) and opens it`, async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<NewObjectMenu open onOpenChange={onOpenChange} />)
    const search = await pickType(user, 'Project')
    expect(screen.getByRole('option', { name: 'New Untitled' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Apollo' })).toBeInTheDocument()
    await user.type(search, 'Foo')
    await user.click(screen.getByRole('option', { name: "New 'Foo'" }))
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('project', { title: 'Foo' }))
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'project/Foo.md' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('test ctrl-click opens new tab', async () => {
    const user = userEvent.setup()
    useTabs.getState().open({ kind: 'type', typeId: 'project' })
    render(<NewObjectMenu open onOpenChange={() => undefined} typeId="project" />)
    await user.keyboard('{Control>}')
    await user.click(screen.getByRole('option', { name: 'New Untitled' }))
    await user.keyboard('{/Control}')
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('project', {}))
    await waitFor(() => expect(useTabs.getState().tabs).toHaveLength(2))
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'project/Untitled.md' })
    expect(useTabs.getState().tabs[0].history).toEqual([{ kind: 'type', typeId: 'project' }])
  })

  // Regression (2026-10-27): a click on a type option moved focus off the search box, so
  // typing a title and pressing Enter in step 2 did nothing. These type with the keyboard only,
  // never clicking the box (user.type would click it first and hide the bug).
  test('after clicking a type, the "Search or Create" box has focus and Enter creates with the typed title', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<NewObjectMenu open onOpenChange={onOpenChange} />)
    expect(screen.getByRole('textbox', { name: 'Search Object Types' })).toHaveFocus()
    await user.click(screen.getByRole('option', { name: 'Page' }))
    expect(screen.getByRole('textbox', { name: 'Search or Create' })).toHaveFocus()
    await user.keyboard('  Network map  {Enter}')
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('page', { title: 'Network map' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  test('New → Whiteboard (clicked) → typed title → Enter creates the whiteboard with that title', async () => {
    const user = userEvent.setup()
    const create = vi
      .spyOn(whiteboardApi, 'createWhiteboard')
      .mockResolvedValue({ path: 'Whiteboards/Network map.md' } as Awaited<ReturnType<typeof whiteboardApi.createWhiteboard>>)
    try {
      render(<NewObjectMenu open onOpenChange={() => undefined} />)
      await user.click(screen.getByRole('option', { name: 'Whiteboard' }))
      expect(screen.getByRole('textbox', { name: 'Search or Create' })).toHaveFocus()
      await user.keyboard('Network map{Enter}')
      await waitFor(() => expect(create).toHaveBeenCalledWith('Network map'))
      expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Whiteboards/Network map.md' })
    } finally {
      create.mockRestore()
    }
  })

  test('clicking an option keeps focus in the box; empty Enter is "New Untitled"; arrows + Enter open a match', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<NewObjectMenu open onOpenChange={() => undefined} typeId="project" />)
    const search = screen.getByRole('textbox', { name: 'Search or Create' })
    expect(search).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: 'Apollo' })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Projects/Apollo.md' })
    expect(mocked.createObject).not.toHaveBeenCalled()
    unmount()

    render(<NewObjectMenu open onOpenChange={() => undefined} typeId="project" />)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('project', {}))
  })

  test('picking an existing object opens it; a Task opens in the peek', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<NewObjectMenu open onOpenChange={() => undefined} typeId="project" />)
    await user.click(screen.getByRole('option', { name: 'Apollo' }))
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Projects/Apollo.md' })
    expect(mocked.createObject).not.toHaveBeenCalled()
    unmount()

    render(<NewObjectMenu open onOpenChange={() => undefined} typeId="task" />)
    await user.click(screen.getByRole('option', { name: 'New Untitled' }))
    await waitFor(() => expect(usePeek.getState().path).toBe('task/Untitled.md'))
  })
})

describe('TypePage', () => {
  test('test TypePage split button lists templates', async () => {
    const user = userEvent.setup()
    mocked.objects.mockResolvedValue([])
    mocked.templates.mockResolvedValue([
      objectSummary({ path: 'Templates/Projects/A.md', id: 'tpl-a', type: 'project', template: 'Kickoff' }),
      objectSummary({ path: 'Templates/Projects/B.md', id: 'tpl-b', type: 'project', template: 'Retro' }),
    ])
    render(<TypePage type={PROJECT} />)
    await user.click(await screen.findByRole('button', { name: 'New from template' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(["New 'Retro'", "New 'Kickoff'"])
    await user.click(within(menu).getByRole('menuitem', { name: "New 'Kickoff'" }))
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('project', { templateId: 'tpl-a' }))

    await user.click(screen.getByRole('button', { name: 'New Project' }))
    await waitFor(() => expect(mocked.createObject).toHaveBeenLastCalledWith('project', {}))
  })
})

describe('createAndOpen', () => {
  test('test createAndOpen passes values through to createObject and omits empty ones', async () => {
    await createAndOpen('project', { title: 'Foo', values: { done: true } })
    expect(mocked.createObject).toHaveBeenLastCalledWith('project', { title: 'Foo', values: { done: true } })
    await createAndOpen('project', { values: {} })
    expect(mocked.createObject).toHaveBeenLastCalledWith('project', {})
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'project/Untitled.md' })
  })
})
