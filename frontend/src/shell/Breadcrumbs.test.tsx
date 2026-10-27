import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { resetLinkIndex } from '@/links/linkIndex'
import { activeTab, currentTarget, useTabs, type Target } from '@/nav/tabs'
import { Breadcrumbs } from './Breadcrumbs'

const objT = (path: string): Target => ({ kind: 'object', path })
const s = useTabs.getState

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  resetLinkIndex()
})

function row() {
  return screen.getByRole('navigation', { name: 'Breadcrumbs' })
}

function walk(...paths: string[]) {
  s().open(objT(`${paths[0]}.md`))
  for (const p of paths.slice(1)) s().open(objT(`${p}.md`), { via: 'link' })
}

describe('Breadcrumbs', () => {
  test('test nothing renders without a trail', () => {
    s().open(objT('A.md'))
    render(<Breadcrumbs space={null} />)
    expect(screen.queryByRole('navigation', { name: 'Breadcrumbs' })).toBeNull()
  })

  test('test the trail shows each crumb and the current page last, not clickable', () => {
    walk('Alpha', 'Beta', 'Gamma')
    render(<Breadcrumbs space={null} />)
    const crumbs = within(row()).getAllByRole('button')
    expect(crumbs.map((b) => b.textContent)).toEqual(['Alpha', 'Beta'])
    const current = within(row()).getByText('Gamma').closest('[aria-current="page"]')
    expect(current).not.toBeNull()
    expect(current!.tagName).not.toBe('BUTTON')
  })

  test('test clicking a crumb goes back to it', async () => {
    const user = userEvent.setup()
    walk('Alpha', 'Beta', 'Gamma')
    render(<Breadcrumbs space={null} />)
    await user.click(within(row()).getByRole('button', { name: 'Beta' }))
    expect(currentTarget(s())).toEqual(objT('Beta.md'))
    expect(activeTab(s())!.history).toHaveLength(3)
    expect(activeTab(s())!.index).toBe(1)
    // The row now shows Beta's own trail.
    expect(within(row()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Alpha'])
  })

  test('test long trails collapse the middle', async () => {
    const user = userEvent.setup()
    walk('A1', 'A2', 'A3', 'A4', 'A5', 'A6')
    render(<Breadcrumbs space={null} />)
    const more = within(row()).getByRole('button', { name: 'Show hidden breadcrumbs' })
    expect(more).toHaveTextContent('…')
    const visible = within(row())
      .getAllByRole('button')
      .filter((b) => b !== more)
      .map((b) => b.textContent)
    expect(visible).toEqual(['A1', 'A4', 'A5'])
    await user.click(more)
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['A2', 'A3'])
    await user.click(within(menu).getByRole('menuitem', { name: 'A3' }))
    expect(currentTarget(s())).toEqual(objT('A3.md'))
    expect(activeTab(s())!.index).toBe(2)
  })
})
