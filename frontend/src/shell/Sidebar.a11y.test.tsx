// Every button in the sidebar, the tab bar and the top bar has an accessible name, the icon-only
// ones included, so a screen reader (and a test) can tell them apart; an icon-only button also
// shows a tooltip (`title`), and in the sidebar no two icon-only buttons share a name.
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { TypeDef } from '@/api/types'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useTabs } from '@/nav/tabs'
import { collection, typeDef as makeType } from '@/test/mockApi'
import { Sidebar } from './Sidebar'
import { TabStrip } from './TabStrip'
import { TopBar } from './TopBar'
import { resetPinned } from './usePinned'

const mocked = vi.mocked(api)

const typeOf = (name: string, plural: string): TypeDef =>
  makeType({ id: name.toLowerCase(), name, pluralName: plural, folder: plural })
const TYPES = [typeOf('Page', 'Pages'), typeOf('Server', 'Servers'), typeOf('Task', 'Tasks')]

/** The accessible name the way a screen reader reads a plain button (aria-label, else its text). */
function nameOf(b: HTMLElement): string {
  const label = b.getAttribute('aria-label')?.trim()
  if (label) return label
  const by = b.getAttribute('aria-labelledby')
  if (by) return by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim()
  return (b.textContent ?? '').trim() || (b.getAttribute('title') ?? '').trim()
}

const iconOnly = (b: HTMLElement) => !(b.textContent ?? '').trim()

function buttonsIn(root: HTMLElement): HTMLElement[] {
  return within(root).queryAllByRole('button')
}

function checkNamed(root: HTMLElement) {
  const buttons = buttonsIn(root)
  expect(buttons.length).toBeGreaterThan(0)
  const unnamed = buttons.filter((b) => !nameOf(b)).map((b) => b.outerHTML.slice(0, 160))
  expect(unnamed).toEqual([])
  const untitled = buttons.filter((b) => iconOnly(b) && !b.getAttribute('title')).map(nameOf)
  expect(untitled).toEqual([])
}

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  resetPinned()
  mocked.collections = vi.fn(async () => [
    collection({ id: 'todo', name: 'To Do', typeIds: ['task'], revision: 'r1' }),
    collection({ id: 'patch-1', name: 'Patch group 1', typeIds: ['server', 'task'], revision: 'r1' }),
  ])
})

describe('button names', () => {
  it('names every sidebar button, with a tooltip on the icon-only ones', async () => {
    const { container } = render(
      <TooltipProvider>
        <Sidebar types={TYPES} />
      </TooltipProvider>,
    )
    await screen.findByRole('list', { name: 'Tasks collections' })
    checkNamed(container)
  })

  it("gives the sidebar's icon-only buttons distinct names (each fold says which type it folds)", async () => {
    const { container } = render(
      <TooltipProvider>
        <Sidebar types={TYPES} />
      </TooltipProvider>,
    )
    await screen.findByRole('list', { name: 'Tasks collections' })
    const names = buttonsIn(container).filter(iconOnly).map(nameOf)
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([])
    expect(screen.getByRole('button', { name: 'Hide Tasks collections' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Hide Servers collections' })).toBeInTheDocument()
  })

  it('names every button of the top bar and the tab bar, with a tooltip on the icon-only ones', () => {
    useTabs.getState().open({ kind: 'type', typeId: 'task' })
    useTabs.getState().open({ kind: 'type', typeId: 'server' }, { newTab: true })
    const { container } = render(
      <TooltipProvider>
        <TopBar
          spaceName="space"
          onToggleSidebar={() => {}}
          onToggleRightPanel={() => {}}
          rightPanelOpen={false}
          onNewTab={() => {}}
          tabs={<TabStrip space={null} />}
        />
      </TooltipProvider>,
    )
    expect(screen.getAllByRole('tab').length).toBe(2)
    checkNamed(container)
  })
})
