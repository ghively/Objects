import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('./switchSpace', async (orig) => ({
  ...(await orig()),
  switchSpace: vi.fn(async () => true),
}))

import { api, ApiError, ConfirmRequiredError } from '@/api/client'
import { spaceEntry } from '@/test/mockApi'
import { resetSettingsModal } from '@/settings/useSettingsModal'
import { resetSpaceInfo } from '@/settings/useSpaceInfo'
import { DeleteSpaceDialog } from './DeleteSpaceDialog'
import { SpacesMenu } from './SpacesMenu'
import { resetSpaceSwitch, switchSpace } from './switchSpace'

const mocked = vi.mocked(api)


const SPACES = [
  spaceEntry({ path: '/spaces/Work', name: 'Work', current: true }),
  spaceEntry({ path: '/spaces/Home', name: 'Home' }),
  spaceEntry({ path: '/spaces/Gone', name: 'Gone', missing: true }),
]

beforeEach(() => {
  vi.clearAllMocks()
  resetSettingsModal()
  resetSpaceInfo()
  resetSpaceSwitch()
  mocked.spaces.mockResolvedValue(SPACES.map((s) => ({ ...s })))
  mocked.space.mockResolvedValue({
    name: 'Work',
    root: '/spaces/Work',
    types: [],
    icon: null,
    description: null,
    hideTaskManagement: false,
    revision: 'r0',
  })
})

async function openMenu() {
  const user = userEvent.setup()
  render(
    <SpacesMenu>
      <button type="button">Space button</button>
    </SpacesMenu>,
  )
  await user.click(screen.getByRole('button', { name: 'Space button' }))
  const list = await screen.findByRole('list', { name: 'Spaces' })
  await waitFor(() => expect(within(list).getAllByTestId('space-row')).toHaveLength(3))
  return { user, list }
}

function row(list: HTMLElement, name: string): HTMLElement {
  return within(list)
    .getAllByTestId('space-row')
    .find((r) => r.textContent?.includes(name))!
}

describe('DeleteSpaceDialog', () => {
  test('test delete dialog trashes then removes from list', async () => {
    const { user, list } = await openMenu()
    await user.click(within(row(list, 'Home')).getByRole('button', { name: 'More: Home' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete space' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Delete this space?')).toBeInTheDocument()
    expect(within(dialog).getByText('Deletes the space and everything in it.')).toBeInTheDocument()
    expect(within(dialog).queryByText("This can't be undone.")).toBeNull()
    expect(mocked.deleteSpace).not.toHaveBeenCalled()

    mocked.spaces.mockResolvedValue(SPACES.filter((s) => s.name !== 'Home'))
    await user.click(within(dialog).getByRole('button', { name: 'Delete space' }))
    await waitFor(() => expect(mocked.deleteSpace).toHaveBeenCalledWith('/spaces/Home', {}))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await waitFor(() => expect(within(list).getAllByTestId('space-row')).toHaveLength(2))
    expect(within(list).queryByText('Home')).toBeNull()
    expect(switchSpace).not.toHaveBeenCalled()
  })

  test('test permanent delete second step', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onDeleted = vi.fn()
    mocked.deleteSpace
      .mockRejectedValueOnce(new ConfirmRequiredError('The trash is not available', 0, '66:1234'))
      .mockResolvedValueOnce({ trashed: false })
    render(<DeleteSpaceDialog entry={{ path: '/spaces/Home', name: 'Home' }} onClose={onClose} onDeleted={onDeleted} />)
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete space' }))
    expect(await within(dialog).findByText("This can't be undone.")).toBeInTheDocument()
    expect(mocked.deleteSpace).toHaveBeenNthCalledWith(1, '/spaces/Home', {})
    expect(onDeleted).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Delete space' }))
    await waitFor(() =>
      expect(mocked.deleteSpace).toHaveBeenNthCalledWith(2, '/spaces/Home', { permanent: true, folder: '66:1234' }),
    )
    expect(onDeleted).toHaveBeenCalledWith('/spaces/Home', false)
    expect(onClose).toHaveBeenCalled()
  })

  test('test delete error is shown and cancel deletes nothing', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    mocked.deleteSpace.mockRejectedValueOnce(new ApiError(404, 'Not a space folder'))
    render(<DeleteSpaceDialog entry={{ path: '/spaces/Home', name: 'Home' }} onClose={onClose} onDeleted={vi.fn()} />)
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete space' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Not a space folder')
    expect(within(dialog).queryByText("This can't be undone.")).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(mocked.deleteSpace).toHaveBeenCalledTimes(1)
  })

  test('test current and missing spaces offer no delete', async () => {
    const { user, list } = await openMenu()
    await user.click(within(row(list, 'Work')).getByRole('button', { name: 'More: Work' }))
    expect(screen.queryByRole('menuitem', { name: 'Delete space' })).toBeNull()
    await user.keyboard('{Escape}')
    await user.click(within(row(list, 'Gone')).getByRole('button', { name: 'More: Gone' }))
    expect(await screen.findByRole('menuitem', { name: 'Remove' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Delete space' })).toBeNull()
  })
})
