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
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { TypePage } from '@/types/TypePage'
import { createAndOpen } from './createAndOpen'
import { setLastTypeSpace } from './lastType'
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

beforeEach(async () => {
  localStorage.clear()
  // M29: no last type, so step 1 keeps its order.
  await setLastTypeSpace(null)
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

describe('NewObjectMenu', () => {
  // Seen in the live app (v1.72.7): the New menu is a popover under the New button with a "Search"
  // field and the types; picking a type creates and opens an object of it at once (no second step).
  test('picking a type creates an untitled object of it and closes the menu', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<NewObjectMenu open onOpenChange={onOpenChange} />)
    await user.click(screen.getByRole('option', { name: 'Project' }))
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('project', {}))
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'project/Untitled.md' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('typing filters the types; Enter creates the first match', async () => {
    const user = userEvent.setup()
    render(<NewObjectMenu open onOpenChange={() => undefined} />)
    expect(screen.getByRole('textbox', { name: 'Search types' })).toHaveAttribute('placeholder', 'Search')
    await user.keyboard('proj')
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Project'])
    await user.keyboard('{Enter}')
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('project', {}))
  })

  test('the types follow the sidebar order and the menu opens under the New button', () => {
    const btn = document.createElement('button')
    btn.setAttribute('data-new-button', '')
    document.body.appendChild(btn)
    try {
      render(<NewObjectMenu open onOpenChange={() => undefined} />)
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Note', 'Project', 'Task', 'Whiteboard'])
      expect(screen.getByRole('dialog')).toHaveAttribute('data-slot', 'popover-content')
    } finally {
      btn.remove()
    }
  })

  test('shows the keyboard hints under the list', () => {
    render(<NewObjectMenu open onOpenChange={() => {}} />)
    expect(screen.getByRole('note', { name: 'Keyboard hints' })).toHaveTextContent('↑↓ to navigate')
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
  test('the search box has focus on open; arrows and Enter pick a type without the mouse', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<NewObjectMenu open onOpenChange={onOpenChange} />)
    expect(screen.getByRole('textbox', { name: 'Search types' })).toHaveFocus()
    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(mocked.createObject).toHaveBeenCalledWith('project', {}))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  test('New → Whiteboard creates a whiteboard at once', async () => {
    const user = userEvent.setup()
    const create = vi
      .spyOn(whiteboardApi, 'createWhiteboard')
      .mockResolvedValue({ path: 'Whiteboards/Network map.md' } as Awaited<ReturnType<typeof whiteboardApi.createWhiteboard>>)
    try {
      render(<NewObjectMenu open onOpenChange={() => undefined} />)
      await user.click(screen.getByRole('option', { name: 'Whiteboard' }))
      await waitFor(() => expect(create).toHaveBeenCalledWith(undefined))
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

    // The Task rule, with "Open objects as a full page" off (M32: it starts on, and then a task
    // opens as a page like the rest; `createAndOpen.test.ts` covers both).
    useSettings.setState({ settings: { ...settingsDefaults, alwaysOpenAsFullPage: false } })
    try {
      render(<NewObjectMenu open onOpenChange={() => undefined} typeId="task" />)
      await user.click(screen.getByRole('option', { name: 'New Untitled' }))
      await waitFor(() => expect(usePeek.getState().path).toBe('task/Untitled.md'))
    } finally {
      useSettings.setState({ settings: settingsDefaults })
    }
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
