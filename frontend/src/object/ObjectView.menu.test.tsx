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
