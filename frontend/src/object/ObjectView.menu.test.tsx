import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpaceInfo, TypeDef } from '@/api/types'
import { objectDetail, objectSummary, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/find/FindBar', () => ({ FindBar: () => null }))
vi.mock('@/references/ReferencesSection', () => ({ ReferencesSection: () => null }))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { activeTab, currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { revealMenuLabel } from '@/lib/platformText'
import { ObjectView } from './ObjectView'

const mocked = vi.mocked(api)
const PAGE: TypeDef = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', revision: 'r1' })
const PATH = 'Pages/Notes.md'

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  const detail = objectDetail({
    summary: objectSummary({ path: PATH, type: 'page', title: 'Notes' }),
    frontmatter: { type: 'Page', title: 'Notes' },
    body: 'Hello.\n',
    version: 'v1',
  })
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE] } satisfies SpaceInfo)
  mocked.objects.mockResolvedValue([detail.summary])
  mocked.object.mockResolvedValue(detail)
  mocked.resolve.mockResolvedValue(null)
  mocked.onChange.mockReturnValue(() => undefined)
})

describe('ObjectView … menu', () => {
  test('the rows are in the catalog order and in sentence case', async () => {
    const user = userEvent.setup()
    render(<ObjectView path={PATH} mode="page" />)
    await screen.findByText('Hello.')
    await user.click(screen.getByRole('button', { name: 'More' }))
    const menu = await screen.findByRole('menu')
    // Every row, submenu trigger and checkbox row, without its key hint.
    const labels = [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')].map((el) => {
      const copy = el.cloneNode(true) as HTMLElement
      copy.querySelectorAll('[data-slot="dropdown-menu-shortcut"]').forEach((k) => k.remove())
      return copy.textContent?.trim() ?? ''
    })
    expect(labels).toEqual([
      'Open in new tab',
      'Open in side panel',
      revealMenuLabel(),
      'Find in page',
      'Use template',
      'Pin to sidebar',
      'Pin to...',
      'Change type',
      'Object type settings',
      'Present',
      'Export',
      'Import',
      'Version history',
      'Text stats',
      'Copy',
      'Add to whiteboard',
      'Add tags using AI',
      'Fill empty properties using AI',
      'Edit collections',
      'Duplicate',
      'Merge into object',
      'Wide layout',
      'Raw Markdown',
      'Delete object',
    ])
    // The separators split the menu into its groups.
    const groups: string[][] = [[]]
    for (const el of menu.children) {
      if (el.getAttribute('role') === 'separator') groups.push([])
      else if (/^menuitem/.test(el.getAttribute('role') ?? '')) groups[groups.length - 1].push(el.textContent ?? '')
    }
    expect(groups.map((g) => g.length)).toEqual([12, 6, 3, 2, 1])
  })

  test('test object menu offers Open in side panel', async () => {
    const user = userEvent.setup()
    useTabs.getState().open({ kind: 'object', path: 'Pages/Main.md' })
    const onDismiss = vi.fn()
    render(<ObjectView path={PATH} mode="peek" onDismiss={onDismiss} />)
    await screen.findByText('Hello.')
    await user.click(screen.getByRole('button', { name: 'More' }))
    const menu = await screen.findByRole('menu')
    const names = within(menu)
      .getAllByRole('menuitem')
      .map((i) => i.textContent)
    // Right after "Open in new tab".
    expect(names.slice(0, 2)).toEqual(['Open in new tab', 'Open in side panel'])
    await user.click(within(menu).getByRole('menuitem', { name: 'Open in side panel' }))
    const tab = activeTab(useTabs.getState())!
    expect(tab.sidepanel?.[0]).toMatchObject({ target: { kind: 'object', path: PATH }, isOpen: true, panelArea: 'area1' })
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Pages/Main.md' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  test('test header buttons use the floating chrome tokens', async () => {
    const { container } = render(<ObjectView path={PATH} mode="page" />)
    await screen.findByText('Hello.')
    const toggle = screen.getByRole('button', { name: 'Hide properties' })
    expect(toggle.className).toContain('border-[var(--float-btn-border)]')
    expect(toggle.className).toContain('bg-[var(--float-bg)]')
    expect(container.querySelector('.border-\\[var\\(--float-border\\)\\]')).not.toBeNull()
    expect(container.innerHTML).not.toMatch(/#(29282d|232226|18181b)/)
  })
})
