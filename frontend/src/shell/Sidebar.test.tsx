import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { GlobalOverlays } from './GlobalOverlays'
import type { TypeDef } from '@/api/types'
import { typeDef as makeType } from '@/test/mockApi'
import { usePalette } from '@/palette/usePalette'
import { Sidebar } from './Sidebar'
import { resetSettingsModal, useSettingsModal } from '@/settings/useSettingsModal'
import { resetSpaceInfo, useSpaceInfo } from '@/settings/useSpaceInfo'

function typeDef(name: string, pluralName: string, icon: string, color: string): TypeDef {
  const id = name.toLowerCase()
  return makeType({ id, name, pluralName, folder: pluralName, icon: { type: 'iconify', val: icon }, color })
}

const TYPES: TypeDef[] = [
  typeDef('Task', 'Tasks', 'ph-check-circle', 'blue'),
  typeDef('Server', 'Servers', 'ph-hard-drives', 'purple'),
  typeDef('Person', 'People', 'ph-user', 'orange'),
  typeDef('DailyNote', 'DailyNotes', 'ph-calendar-blank', 'green'),
  { ...typeDef('Page', 'Pages', 'ph-file-text', 'pink'), basic: true },
]

describe('Sidebar', () => {
  it('test sidebar "+ New" enabled and type context menu items', async () => {
    const user = userEvent.setup()
    const onNew = vi.fn()
    const onCreateType = vi.fn()
    const onOpenTypeSettings = vi.fn()
    const onDeleteType = vi.fn()
    const onOpenTrash = vi.fn()
    render(
      <Sidebar
        types={TYPES}
        onNew={onNew}
        onCreateType={onCreateType}
        onOpenTypeSettings={onOpenTypeSettings}
        onDeleteType={onDeleteType}
        onOpenTrash={onOpenTrash}
      />,
    )
    const btn = screen.getByRole('button', { name: 'New' })
    expect(btn).toBeEnabled()
    await user.click(btn)
    expect(onNew).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Create object type' }))
    expect(onCreateType).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Trash' }))
    expect(onOpenTrash).toHaveBeenCalledTimes(1)

    // A custom type: the Object menu (TypeContextMenu.test.tsx covers each entry), with delete last.
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Servers' }))
    let menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Open',
      'Create Server',
      'New from Template',
      'New Collection',
      'Pin to Sidebar',
      'Object Type Settings',
      'Import CSV',
      'Delete object type',
    ])
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete object type' }))
    expect(onDeleteType).toHaveBeenCalledWith(expect.objectContaining({ id: 'server' }))

    // A basic type: no delete.
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Pages' }))
    menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).not.toContain('Delete object type')
    await user.click(within(menu).getByRole('menuitem', { name: 'Object Type Settings' }))
    expect(onOpenTypeSettings).toHaveBeenCalledWith(expect.objectContaining({ id: 'page' }))
  })

  it('test sidebar search button opens the search palette with its tooltip', async () => {
    const user = userEvent.setup()
    usePalette.setState({ open: false, mode: 'actions' })
    render(<Sidebar types={TYPES} />)
    const btn = screen.getByRole('button', { name: 'Search this space' })
    expect(btn).toHaveAttribute('title', 'Search this space')
    expect(screen.queryByTitle(/M5/)).toBeNull()
    await user.click(btn)
    expect(usePalette.getState()).toMatchObject({ open: true, mode: 'search' })
  })

  it('test sidebar Graph item opens the graph target and shows active state', async () => {
    const user = userEvent.setup()
    const onOpenTarget = vi.fn()
    const { rerender } = render(<Sidebar types={TYPES} onOpenTarget={onOpenTarget} />)
    const nav = screen.getByRole('navigation', { name: /main/i })
    const graph = within(nav).getByRole('button', { name: 'Graph' })
    expect(graph).toBeEnabled()
    expect(graph.querySelector('[data-icon="ph-graph"]')).not.toBeNull()
    expect(graph).not.toHaveAttribute('aria-current')
    await user.click(graph)
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'graph' }, { newTab: false })
    fireEvent.click(graph, { ctrlKey: true })
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'graph' }, { newTab: true })
    await user.hover(graph)
    expect(screen.queryByText(/arrives in M5/)).toBeNull()
    rerender(<Sidebar types={TYPES} onOpenTarget={onOpenTarget} graphActive />)
    expect(within(nav).getByRole('button', { name: 'Graph' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('button', { name: 'Calendar' })).not.toHaveAttribute('aria-current')
  })

  it('test M3 and M4 sidebar items still present', () => {
    // Regression guard (green from the start).
    render(<Sidebar types={TYPES} />)
    const nav = screen.getByRole('navigation', { name: /main/i })
    for (const name of ['All notes', 'Calendar', 'Tasks']) {
      expect(within(nav).getByRole('button', { name })).toBeEnabled()
    }
    expect(screen.getByRole('button', { name: 'Queries' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Pinned' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trash' })).toBeInTheDocument()
  })

  it('test sidebar Calendar and Tasks items open targets and show active state', async () => {
    const user = userEvent.setup()
    const onOpenTarget = vi.fn()
    const { rerender } = render(<Sidebar types={TYPES} onOpenTarget={onOpenTarget} />)
    const nav = screen.getByRole('navigation', { name: /main/i })
    const calendar = within(nav).getByRole('button', { name: 'Calendar' })
    const tasks = within(nav).getByRole('button', { name: 'Tasks' })
    expect(calendar).toBeEnabled()
    expect(tasks).toBeEnabled()
    expect(calendar).not.toHaveAttribute('aria-current')
    await user.click(calendar)
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'calendar' }, { newTab: false })
    await user.click(tasks)
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'tasks' }, { newTab: false })
    fireEvent.click(calendar, { ctrlKey: true })
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'calendar' }, { newTab: true })
    await user.hover(calendar)
    expect(screen.queryByText(/arrives in M4/)).toBeNull()

    rerender(<Sidebar types={TYPES} onOpenTarget={onOpenTarget} calendarActive />)
    expect(within(nav).getByRole('button', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('button', { name: 'Tasks' })).not.toHaveAttribute('aria-current')
    rerender(<Sidebar types={TYPES} onOpenTarget={onOpenTarget} tasksActive />)
    expect(within(nav).getByRole('button', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page')
  })

  it('test M3 sidebar items still present', () => {
    render(<Sidebar types={TYPES} />)
    const nav = screen.getByRole('navigation', { name: /main/i })
    expect(within(nav).getByRole('button', { name: 'All notes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Queries' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Pinned' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trash' })).toBeInTheDocument()
  })

  it('renders Pinned with an italic empty state', () => {
    render(<Sidebar types={TYPES} />)
    const pinned = screen.getByRole('region', { name: 'Pinned' })
    const empty = within(pinned).getByText('No pinned content')
    expect(empty).toHaveClass('italic')
  })

  it('lists object types alphabetically with coloured icon chips', () => {
    render(<Sidebar types={TYPES} />)
    const section = screen.getByRole('region', { name: 'Object Types' })
    const items = within(section)
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-label') !== 'Create object type')
    expect(items.map((b) => b.textContent?.trim())).toEqual([
      'DailyNotes',
      'Pages',
      'People',
      'Queries',
      'Servers',
      'Tasks',
    ])
    const tasks = items[5]
    const chip = tasks.querySelector('[data-type-chip]') as HTMLElement
    expect(chip).not.toBeNull()
    expect(chip.dataset.color).toBe('blue')
    expect(chip.dataset.icon).toBe('ph-check-circle')
    expect(chip.style.getPropertyValue('--chip-fg')).not.toBe('')
  })
})

describe('Sidebar theme button (M7)', () => {
  it('test sidebar sun button toggles the mode with reference tooltips', async () => {
    useSettings.setState({ settings: settingsDefaults, revision: '', loaded: true })
    vi.mocked(api.patchSettings).mockClear()
    const user = userEvent.setup()
    render(<Sidebar types={TYPES} />)
    // Dark now: the button offers light mode (SpaceOverview.setLightMode).
    const btn = screen.getByRole('button', { name: 'Light mode' })
    expect(btn).toBeEnabled()
    expect(btn).toHaveAttribute('title', 'Light mode')
    await user.click(btn)
    expect(useSettings.getState().settings.themeMode).toBe('light')
    expect(api.patchSettings).toHaveBeenCalledWith({ themeMode: 'light' }, expect.anything())
    // Light now: it offers dark mode (SpaceOverview.setDarkMode).
    await user.click(screen.getByRole('button', { name: 'Dark mode' }))
    expect(useSettings.getState().settings.themeMode).toBe('dark')
    expect(screen.getByRole('button', { name: 'Light mode' })).toBeInTheDocument()
  })

  it('test toggle dark mode shortcut', async () => {
    useSettings.setState({ settings: settingsDefaults, revision: '', loaded: true })
    const ui = render(<GlobalOverlays />)
    // Loaded settings are applied to <html>.
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    // Mod-Shift-l (Ctrl on Windows/Linux): Toggle dark mode (Object's key).
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', code: 'KeyL', ctrlKey: true, shiftKey: true, bubbles: true }))
    })
    expect(useSettings.getState().settings.themeMode).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', code: 'KeyL', ctrlKey: true, shiftKey: true, bubbles: true }))
    })
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    ui.unmount()
    localStorage.clear()
  })

  it('test overlays leave the cached first-paint theme until settings load', () => {
    document.documentElement.setAttribute('data-theme', 'lightDimmed')
    useSettings.setState({ settings: settingsDefaults, revision: '', loaded: false })
    const ui = render(<GlobalOverlays />)
    expect(document.documentElement.getAttribute('data-theme')).toBe('lightDimmed')
    act(() => useSettings.setState({ settings: { ...settingsDefaults, themeMode: 'light' }, loaded: true }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    ui.unmount()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.classList.add('dark')
    localStorage.clear()
  })

  it('test hide task management hides the Tasks sidebar item', async () => {
    resetSpaceInfo()
    vi.mocked(api.space).mockResolvedValueOnce({
      name: 'space',
      root: '/space',
      types: [],
      icon: null,
      description: null,
      hideTaskManagement: true,
      revision: 's1',
    })
    render(<Sidebar types={TYPES} />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    await waitFor(() => expect(within(nav).queryByRole('button', { name: 'Tasks' })).toBeNull())
    expect(within(nav).getByRole('button', { name: 'Calendar' })).toBeInTheDocument()
    // Showing it again (the Settings modal's switch) brings the entry back.
    act(() => useSpaceInfo.setState((st) => ({ space: st.space && { ...st.space, hideTaskManagement: false } })))
    expect(within(nav).getByRole('button', { name: 'Tasks' })).toBeInTheDocument()
    resetSpaceInfo()
  })

  it('test sidebar gear opens the settings modal', async () => {
    resetSettingsModal()
    render(<Sidebar types={TYPES} />)
    const gear = screen.getByRole('button', { name: 'Settings' })
    expect(gear).toBeEnabled()
    expect(gear).toHaveAttribute('title', 'Settings')
    await userEvent.click(gear)
    expect(useSettingsModal.getState().isOpen).toBe(true)
    resetSettingsModal()
  })
})
