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

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { api, ApiError } from '@/api/client'
import { spaceEntry } from '@/test/mockApi'
import { resetSettingsModal, useSettingsModal } from '@/settings/useSettingsModal'
import { resetSpaceInfo, useSpaceInfo } from '@/settings/useSpaceInfo'
import { useCreateSpaceDialog } from './CreateSpaceDialog'
import { SPACES_MENU_TEXT, SpacesMenu, SpaceSwitchOverlay } from './SpacesMenu'
import { resetSpaceSwitch, SWITCH_TEXT, switchSpace, useSpaceSwitch } from './switchSpace'

const mocked = vi.mocked(api)

const STRINGS = readFileSync(
  path.resolve(import.meta.dirname, '../../../docs/strings.txt'),
  'utf8',
)
const inReference = (text: string) => STRINGS.includes(`s:\`${text}\``)

const SPACES = [
  spaceEntry({ path: '/spaces/Work', name: 'Work', icon: 'ph-briefcase', current: true }),
  spaceEntry({ path: '/spaces/Home', name: 'Home', icon: '🏠' }),
  spaceEntry({ path: '/spaces/Gone', name: 'Gone', missing: true }),
]

beforeEach(() => {
  vi.clearAllMocks()
  resetSettingsModal()
  resetSpaceInfo()
  resetSpaceSwitch()
  useCreateSpaceDialog.setState({ isOpen: false })
  mocked.spaces.mockResolvedValue(SPACES.map((s) => ({ ...s })))
  mocked.space.mockResolvedValue({
    name: 'Work',
    root: '/spaces/Work',
    types: [],
    icon: 'ph-briefcase',
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

describe('SpacesMenu', () => {
  test('test spaces menu lists spaces, marks current and missing', async () => {
    const { user, list } = await openMenu()
    // Seen in the live app: a Search field heads the list, in place of a heading.
    expect(screen.getByRole('textbox', { name: 'Search spaces' })).toHaveAttribute('placeholder', 'Search')
    const rows = within(list).getAllByTestId('space-row')
    expect(rows.map((r) => r.textContent)).toEqual(['Work', '🏠Home', 'Gone'])
    expect(row(list, 'Work')).toHaveAttribute('data-current', 'true')
    expect(within(row(list, 'Work')).getByRole('button', { name: 'Work', current: true })).toBeInTheDocument()
    expect(row(list, 'Gone')).toHaveAttribute('data-missing', 'true')
    expect(within(row(list, 'Gone')).getByRole('button', { name: 'Gone' })).toBeDisabled()

    // Clicking another space switches to it; the current one does nothing.
    await user.click(within(row(list, 'Work')).getByRole('button', { name: 'Work', current: true }))
    expect(switchSpace).not.toHaveBeenCalled()
    await user.click(within(row(list, 'Home')).getByRole('button', { name: 'Home' }))
    expect(switchSpace).toHaveBeenCalledWith('/spaces/Home')

    for (const s of [
      SPACES_MENU_TEXT.heading,
      SPACES_MENU_TEXT.rename,
      SPACES_MENU_TEXT.remove,
      SPACES_MENU_TEXT.spaceSettings,
      SPACES_MENU_TEXT.addSpace,
      SPACES_MENU_TEXT.cancel,
      SPACES_MENU_TEXT.open,
      SPACES_MENU_TEXT.more,
    ]) {
      expect(inReference(s), s).toBe(true)
    }
  })

  test('typing in the Search field filters the spaces by name', async () => {
    const { user, list } = await openMenu()
    await user.type(screen.getByRole('textbox', { name: 'Search spaces' }), 'ho')
    expect(within(list).getAllByTestId('space-row').map((r) => r.textContent)).toEqual(['🏠Home'])
    await user.clear(screen.getByRole('textbox', { name: 'Search spaces' }))
    await user.type(screen.getByRole('textbox', { name: 'Search spaces' }), 'zzz')
    expect(within(list).queryAllByTestId('space-row')).toHaveLength(0)
  })

  test('test rename current space patches space.json', async () => {
    const { user, list } = await openMenu()
    await user.click(within(row(list, 'Work')).getByRole('button', { name: 'More: Work' }))
    expect(screen.queryByRole('menuitem', { name: 'Remove' })).toBeNull()
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = await screen.findByRole('textbox', { name: 'Rename' })
    expect(input).toHaveValue('Work')
    await user.clear(input)
    await user.type(input, 'Work notes{Enter}')
    await waitFor(() => expect(mocked.patchSpace).toHaveBeenCalledWith({ name: 'Work notes' }, { baseRevision: 'r0' }))
    expect(useSpaceInfo.getState().space?.name).toBe('Work notes')
    // Escape cancels without writing.
    mocked.patchSpace.mockClear()
    await user.click(within(row(list, 'Work')).getByRole('button', { name: /^More: / }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    await user.type(await screen.findByRole('textbox', { name: 'Rename' }), ' x{Escape}')
    expect(mocked.patchSpace).not.toHaveBeenCalled()
  })

  test('test remove asks, removes from the list only and is not offered for the current space', async () => {
    const { user, list } = await openMenu()
    await user.click(within(row(list, 'Home')).getByRole('button', { name: 'More: Home' }))
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull()
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(SPACES_MENU_TEXT.removeConfirm)).toBeInTheDocument()
    expect(SPACES_MENU_TEXT.removeConfirm).toBe('Object forgets this space. Its folder and files stay where they are.')
    expect(mocked.removeSpace).not.toHaveBeenCalled()

    mocked.spaces.mockResolvedValue(SPACES.filter((s) => s.name !== 'Home'))
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(mocked.removeSpace).toHaveBeenCalledWith('/spaces/Home'))
    await waitFor(() => expect(within(list).getAllByTestId('space-row')).toHaveLength(2))
    expect(switchSpace).not.toHaveBeenCalled()
  })

  test('test open folder registers an existing folder', async () => {
    const { user, list } = await openMenu()
    await user.click(screen.getByRole('button', { name: 'Open folder…' }))
    const field = screen.getByRole('textbox', { name: 'Folder path' })
    mocked.spaces.mockResolvedValue([...SPACES, spaceEntry({ path: '/data/Archive', name: 'Archive' })])
    await user.type(field, '/data/Archive{Enter}')
    await waitFor(() => expect(mocked.openSpace).toHaveBeenCalledWith('/data/Archive'))
    await waitFor(() => expect(within(list).getAllByTestId('space-row')).toHaveLength(4))
    expect(switchSpace).not.toHaveBeenCalled()

    // A folder that isn't there shows the server's message.
    mocked.openSpace.mockRejectedValueOnce(new ApiError(404, 'Not a folder'))
    await user.click(screen.getByRole('button', { name: 'Open folder…' }))
    await user.type(screen.getByRole('textbox', { name: 'Folder path' }), '/nope{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Not a folder')
  })

  test('test space settings and add space open their dialogs', async () => {
    const { user } = await openMenu()
    await user.click(screen.getByRole('button', { name: 'Space settings' }))
    expect(useSettingsModal.getState()).toMatchObject({ isOpen: true, section: 'space' })

    await user.click(screen.getByRole('button', { name: 'Space button' }))
    await user.click(await screen.findByRole('button', { name: 'Add space' }))
    expect(useCreateSpaceDialog.getState().isOpen).toBe(true)
  })

  test('test switch overlay shows switching and the stop reason', async () => {
    const user = userEvent.setup()
    const { container } = render(<SpaceSwitchOverlay />)
    expect(container).toBeEmptyDOMElement()
    useSpaceSwitch.setState({ phase: 'switching', path: '/spaces/Home', error: null })
    expect(await screen.findByRole('status')).toHaveTextContent(SWITCH_TEXT.switching)
    useSpaceSwitch.setState({ phase: 'error', error: SWITCH_TEXT.timeout })
    expect(await screen.findByRole('alert')).toHaveTextContent("The space didn't open. Try again.")
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(container).toBeEmptyDOMElement()
  })
})
