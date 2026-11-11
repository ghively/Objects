import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { resetLinkIndex } from '@/links/linkIndex'
import { currentTarget, useTabs } from '@/nav/tabs'
import { TabMenu, useTabMenu } from './TabMenu'

const s = useTabs.getState

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  useTabMenu.getState().setOpen(false)
  resetLinkIndex()
})

describe('TabMenu', () => {
  test('test tab menu searches and activates; empty shows No tabs found', async () => {
    s().open({ kind: 'calendar' })
    s().open({ kind: 'trash' }, { newTab: true })
    s().open({ kind: 'allNotes' }, { newTab: true })
    render(<TabMenu space={null} />)

    await userEvent.click(screen.getByRole('button', { name: 'Tab menu' }))
    const search = await screen.findByRole('textbox', { name: 'Search tabs' })
    expect(search).toHaveAttribute('placeholder', 'Search tabs')
    const list = screen.getByRole('listbox', { name: 'Tabs' })
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Calendar', 'Trash', 'All notes'])

    await userEvent.type(search, 'tr')
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Trash'])
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(currentTarget(s())).toEqual({ kind: 'trash' })
    expect(useTabMenu.getState().open).toBe(false)

    useTabMenu.getState().setOpen(true)
    const again = await screen.findByRole('textbox', { name: 'Search tabs' })
    await userEvent.type(again, 'zzz')
    expect(screen.getByText('No tabs found')).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  test('arrow keys move the highlight; click activates', async () => {
    s().open({ kind: 'calendar' })
    s().open({ kind: 'trash' }, { newTab: true })
    useTabMenu.getState().setOpen(true)
    render(<TabMenu space={null} />)
    const search = await screen.findByRole('textbox', { name: 'Search tabs' })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(currentTarget(s())).toEqual({ kind: 'calendar' })

    useTabMenu.getState().setOpen(true)
    await userEvent.click((await screen.findAllByRole('option'))[1])
    expect(currentTarget(s())).toEqual({ kind: 'trash' })
  })
})
