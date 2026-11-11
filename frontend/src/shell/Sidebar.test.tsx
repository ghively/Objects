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
    expect(screen.getByRole('button', { name: 'Search this space' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New type' }))
    expect(onCreateType).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Trash' }))
    expect(onOpenTrash).toHaveBeenCalledTimes(1)

    // A custom type: the type menu (TypeContextMenu.test.tsx covers each entry), with delete last.
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Servers' }))
    let menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Open',
      'Create Server',
      'New from template',
      'New collection',
      'Pin to sidebar',
      'Type settings',
      'Import CSV',
      'Delete type',
    ])
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete type' }))
    expect(onDeleteType).toHaveBeenCalledWith(expect.objectContaining({ id: 'server' }))

    // A basic type: no delete.
    fireEvent.contextMenu(within(screen.getByRole('region', { name: 'Types' })).getByRole('button', { name: 'Notes' }))
    menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).not.toContain('Delete type')
    await user.click(within(menu).getByRole('menuitem', { name: 'Type settings' }))
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
    const bottom = screen.getByRole('navigation', { name: 'Space' })
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
    // Graph sits in the top navigation; Trash is alone in its own group at the very bottom.
    expect(within(bottom).queryByRole('button', { name: 'Graph' })).toBeNull()
    expect(within(bottom).getByRole('button', { name: 'Trash' })).toBeInTheDocument()
    expect(nav.compareDocumentPosition(bottom) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(nav).getByRole('button', { name: 'Calendar' })).not.toHaveAttribute('aria-current')
  })

  it('test M3 and M4 sidebar items still present', () => {
    // Regression guard (green from the start).
    render(<Sidebar types={TYPES} />)
    const nav = screen.getByRole('navigation', { name: /main/i })
    for (const name of ['Notes', 'Calendar', 'Tasks', 'Graph']) {
      expect(within(nav).getByRole('button', { name })).toBeEnabled()
    }
    // M32: "Notes" (the all-notes view) is back, first; "Queries" reads "Saved searches".
    expect(screen.queryByRole('button', { name: 'All notes' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Queries' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Saved searches' })).toBeInTheDocument()
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
    // M32: Tasks opens the plain Tasks page (the dashboard is the Work page).
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
    expect(within(nav).getByRole('button', { name: 'Calendar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'All notes' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Saved searches' })).toBeInTheDocument()
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
    const section = screen.getByRole('region', { name: 'Types' })
    const items = within(section)
      .getAllByRole('button')
      .filter((b) => !['New type', 'Types options'].includes(b.getAttribute('aria-label') ?? ''))
    // M32: the built-in Page and DailyNote read "Notes" and "Daily notes" and sort by that name.
    expect(items.map((b) => b.textContent?.trim())).toEqual([
      'Daily notes',
      'Notes',
      'People',
      'Saved searches',
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
    // Dark now: the button offers light mode.
    const btn = screen.getByRole('button', { name: 'Light mode' })
    expect(btn).toBeEnabled()
    expect(btn).toHaveAttribute('title', 'Light mode')
    await user.click(btn)
    expect(useSettings.getState().settings.themeMode).toBe('light')
    expect(api.patchSettings).toHaveBeenCalledWith({ themeMode: 'light' }, expect.anything())
    // Light now: it offers dark mode.
    await user.click(screen.getByRole('button', { name: 'Dark mode' }))
    expect(useSettings.getState().settings.themeMode).toBe('dark')
    expect(screen.getByRole('button', { name: 'Light mode' })).toBeInTheDocument()
  })

  it('test toggle dark mode shortcut', async () => {
    useSettings.setState({ settings: settingsDefaults, revision: '', loaded: true })
    const ui = render(<GlobalOverlays />)
    // Loaded settings are applied to <html>.
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    // Mod-Shift-l (Ctrl on Windows/Linux): Toggle dark mode.
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

  it('test hide tasks takes the Tasks sidebar item away, and the switch brings it back (M32)', async () => {
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
    await waitFor(() => expect(useSpaceInfo.getState().space?.hideTaskManagement).toBe(true))
    // M32: "Hide Tasks in this space" does what it says; nothing else leaves the sidebar.
    expect(within(nav).queryByRole('button', { name: 'Tasks' })).toBeNull()
    expect(within(nav).getByRole('button', { name: 'Calendar' })).toBeInTheDocument()
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

  it('test sidebar footer has a Shortcuts icon and no dead Profile or Share buttons', async () => {
    resetSettingsModal()
    render(<Sidebar types={TYPES} />)
    expect(screen.queryByRole('button', { name: 'Profile' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
    const shortcuts = screen.getByRole('button', { name: 'Shortcuts' })
    expect(shortcuts).toBeEnabled()
    expect(shortcuts).toHaveAttribute('title', 'Shortcuts')
    await userEvent.click(shortcuts)
    expect(useSettingsModal.getState().shortcutsOpen).toBe(true)
    expect(useSettingsModal.getState().isOpen).toBe(false)
    resetSettingsModal()
  })
})

// M32: "Notes" leads the main navigation, and the sidebar speaks the glossary's words.
describe('Sidebar (M32: notes first)', () => {
  it('test Notes is the first main entry, above Calendar, and opens the all-notes view', async () => {
    const user = userEvent.setup()
    const onOpenTarget = vi.fn()
    const { rerender } = render(<Sidebar types={TYPES} onOpenTarget={onOpenTarget} />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const names = within(nav)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim())
    expect(names.slice(0, 3)).toEqual(['Notes', 'Calendar', 'Tasks'])
    const notes = within(nav).getByRole('button', { name: 'Notes' })
    expect(notes).not.toHaveAttribute('aria-current')
    await user.click(notes)
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'allNotes' }, { newTab: false })
    fireEvent.click(notes, { ctrlKey: true })
    expect(onOpenTarget).toHaveBeenLastCalledWith({ kind: 'allNotes' }, { newTab: true })
    rerender(<Sidebar types={TYPES} onOpenTarget={onOpenTarget} notesActive />)
    expect(within(nav).getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-current', 'page')
  })

  it('test the type list is headed Types, its plus is New type, and no default text says object', () => {
    render(<Sidebar types={TYPES} />)
    expect(screen.getByRole('region', { name: 'Types' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New type' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Types options' })).toBeInTheDocument()
    expect(screen.queryByText('Object Types')).toBeNull()
    expect(screen.queryByRole('button', { name: /object type/i })).toBeNull()
  })

  it('test a renamed built-in type keeps the name the user gave it', () => {
    const journal = { ...typeDef('Page', 'Pages', 'ph-file-text', 'pink'), basic: true, name: 'Journal', pluralName: 'Journals' }
    render(<Sidebar types={[journal]} />)
    const section = screen.getByRole('region', { name: 'Types' })
    expect(within(section).getByRole('button', { name: 'Journals' })).toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: 'Notes' })).toBeNull()
  })

  it('test New makes a note at once and the arrow beside it opens the type list', async () => {
    const user = userEvent.setup()
    const onNew = vi.fn()
    const onNewMenu = vi.fn()
    render(<Sidebar types={TYPES} onNew={onNew} onNewMenu={onNewMenu} />)
    await user.click(screen.getByRole('button', { name: 'New' }))
    expect(onNew).toHaveBeenCalledTimes(1)
    expect(onNewMenu).not.toHaveBeenCalled()
    const arrow = screen.getByRole('button', { name: 'Choose a type' })
    expect(arrow).toHaveAttribute('title', 'Choose a type')
    await user.click(arrow)
    expect(onNewMenu).toHaveBeenCalledTimes(1)
    expect(onNew).toHaveBeenCalledTimes(1)
    // The two sit in the one control the New menu opens under.
    expect(arrow.closest('[data-new-button]')).toBe(screen.getByRole('button', { name: 'New' }).closest('[data-new-button]'))
  })
})
