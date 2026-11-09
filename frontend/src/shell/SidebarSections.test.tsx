import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { UiState } from '@/api/types'
import { collection, objectSummary, query, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { useDefs } from '@/types/useDefinitions'
import { PinMenuItems } from './PinToMenu'
import { Sidebar } from './Sidebar'
import { resetPinned } from './usePinned'

const mocked = vi.mocked(api)
const SERVER = typeDef({ id: 'server', name: 'Server', pluralName: 'Servers', revision: 'r1' })

let stored: UiState
let rev = 0

function Harness() {
  return (
    <>
      <Sidebar types={[SERVER]} />
      <DropdownMenu>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <PinMenuItems pin={{ kind: 'query', id: 'open' }} />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

beforeEach(() => {
  resetLinkIndex()
  resetPinned()
  rev = 0
  stored = {
    pinned: [{ kind: 'collection', id: 'tooling' }],
    sections: [{ id: 'S1', name: 'In Progress', icon: null, items: [{ kind: 'query', id: 'open' }] }],
    allNotesLayout: 'list',
  }
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.ui.mockImplementation(async () => ({ ui: stored, revision: `u${rev}` }))
  mocked.patchUi.mockImplementation(async (patch) => {
    stored = { ...stored, ...patch }
    rev += 1
    return { ui: stored, revision: `u${rev}` }
  })
  mocked.ensureId.mockResolvedValue({ id: 'NEWID', version: 'v2' })
  useLinkIndex.setState({
    types: [SERVER],
    objects: [objectSummary({ path: 'Servers/Atlas.md', id: 'OBJ1', title: 'Atlas', type: 'server' })],
    loaded: true,
  })
  const collections = [collection({ id: 'tooling', name: 'Tooling', typeIds: ['server'] })]
  const queries = [query({ id: 'open', name: 'Open servers' })]
  mocked.collections.mockResolvedValue(collections)
  mocked.queries.mockResolvedValue(queries)
  useDefs.setState({ collections, queries, loaded: true })
})

describe('SidebarSections', () => {
  test('test a section without items and malformed pins in ui.json still render', async () => {
    stored = {
      pinned: 'x',
      sections: [{ id: 'x', name: 'Broken' }, { id: 'y', name: 'Mixed', items: [{ kind: 'query' }, { kind: 'query', id: 'open' }] }],
      allNotesLayout: 'list',
    } as unknown as UiState
    render(<Sidebar types={[SERVER]} />)
    await screen.findByText('Open servers')
    expect(screen.getByRole('heading', { name: 'Broken' })).toBeInTheDocument()
  })

  test('test custom sections render above Pinned with No pinned content when empty', async () => {
    stored.sections.push({ id: 'S2', name: 'Later', icon: null, items: [] })
    render(<Sidebar types={[SERVER]} />)
    await screen.findByText('Open servers')
    // M17's Agents section sits above the main navigation, outside the workspace blocks.
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent).filter((h) => h !== 'Agents')
    expect(headings.slice(0, 3)).toEqual(['In Progress', 'Later', 'Pinned'])
    const later = screen.getByRole('region', { name: 'Later' })
    expect(within(later).getByText('No pinned content')).toBeInTheDocument()
  })

  test('test Add section then Pin to... adds the item to that section; Unpin from {section} removes it only there', async () => {
    const user = userEvent.setup()
    stored.sections = []
    render(<Harness />)
    await user.click(await screen.findByRole('button', { name: 'Add section' }))
    await user.type(screen.getByRole('textbox', { name: 'Section Name' }), 'Hot')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(stored.sections.map((s) => s.name)).toEqual(['Hot']))
    expect(stored.sections[0].id).toMatch(/^[0-9A-Z]{26}$/)
    const id = stored.sections[0].id

    await user.click(screen.getByText('menu'))
    await user.click(await screen.findByRole('menuitem', { name: 'Pin to...' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Hot' }))
    await waitFor(() => expect(stored.sections[0].items).toEqual([{ kind: 'query', id: 'open' }]))
    expect(stored.pinned).toEqual([{ kind: 'collection', id: 'tooling' }])
    await user.keyboard('{Escape}{Escape}')

    fireEvent.contextMenu(within(await screen.findByRole('region', { name: 'Hot' })).getByText('Open servers'))
    await user.click(await screen.findByRole('menuitem', { name: 'Unpin from Hot' }))
    await waitFor(() => expect(stored.sections.find((s) => s.id === id)?.items).toEqual([]))
    expect(stored.pinned).toEqual([{ kind: 'collection', id: 'tooling' }])
  })

  test('test Edit section renames and Delete section keeps the items pinned elsewhere', async () => {
    const user = userEvent.setup()
    stored.pinned.push({ kind: 'query', id: 'open' })
    render(<Sidebar types={[SERVER]} />)
    fireEvent.contextMenu(await screen.findByRole('heading', { name: 'In Progress' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Edit section' }))
    const input = await screen.findByRole('textbox', { name: 'Section Name' })
    await user.clear(input)
    await user.type(input, 'Doing')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(stored.sections[0].name).toBe('Doing'))

    fireEvent.contextMenu(await screen.findByRole('heading', { name: 'Doing' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete section' }))
    await waitFor(() => expect(stored.sections).toEqual([]))
    expect(stored.pinned).toContainEqual({ kind: 'query', id: 'open' })
    expect(await screen.findAllByText('Open servers')).toHaveLength(1)
  })

  test('test pinning object without id calls ensureId first', async () => {
    const user = userEvent.setup()
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <PinMenuItems pin={{ kind: 'object', path: 'Servers/Atlas.md', id: null }} />
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    await user.click(screen.getByText('menu'))
    await user.click(await screen.findByRole('menuitem', { name: 'Pin to sidebar' }))
    await waitFor(() => expect(mocked.patchUi).toHaveBeenCalled())
    expect(mocked.ensureId).toHaveBeenCalledWith('Servers/Atlas.md')
    expect(mocked.ensureId.mock.invocationCallOrder[0]).toBeLessThan(mocked.patchUi.mock.invocationCallOrder[0])
    expect(stored.pinned).toContainEqual({ kind: 'object', id: 'NEWID' })
  })

  test('test M2 sidebar items still present (+ New, Trash, type context menu) and the Queries item from Task 14', async () => {
    const user = userEvent.setup()
    const onOpenTarget = vi.fn()
    const onOpenTypeSettings = vi.fn()
    render(
      <Sidebar
        types={[SERVER]}
        onNew={() => undefined}
        onOpenTrash={() => undefined}
        onOpenTarget={onOpenTarget}
        onOpenTypeSettings={onOpenTypeSettings}
      />,
    )
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trash' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create object type' })).toBeInTheDocument()
    fireEvent.contextMenu(screen.getByText('Servers'))
    await user.click(await screen.findByRole('menuitem', { name: 'Object type settings' }))
    expect(onOpenTypeSettings).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Queries' }))
    expect(onOpenTarget).toHaveBeenCalledWith({ kind: 'queries' }, { newTab: false })
    await user.click(screen.getByRole('button', { name: 'All notes' }))
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'allNotes' }, { newTab: false })
    const main = screen.getByRole('navigation', { name: 'Main' })
    const names = within(main)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent)
    expect(names.slice(0, 2)).toEqual(['All notes', 'Calendar'])
  })
})
