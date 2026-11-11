import { act, render, screen, waitFor } from '@testing-library/react'
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

import { api, ApiError } from '@/api/client'
import { resetImportDialog, useImportDialog } from '@/import/useImportDialog'
import { resetSpaceInfo } from '@/settings/useSpaceInfo'
import { CREATE_SPACE_TEXT, CreateSpaceDialog, NEW_SPACE_SETUP, parentFolder, SETUPS, useCreateSpaceDialog } from './CreateSpaceDialog'
import { switchSpace } from './switchSpace'

const mocked = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  resetSpaceInfo()
  useCreateSpaceDialog.setState({ isOpen: false })
  resetImportDialog()
  mocked.space.mockResolvedValue({
    name: 'Work',
    root: '/home/gene/Spaces/Work',
    types: [],
    icon: null,
    description: null,
    hideTaskManagement: false,
    revision: '',
  })
})

async function openDialog() {
  const user = userEvent.setup()
  render(<CreateSpaceDialog />)
  act(() => useCreateSpaceDialog.getState().open())
  await screen.findByRole('dialog', { name: 'Create new space' })
  return user
}

describe('CreateSpaceDialog', () => {
  test('test create dialog validates, creates and offers to switch; 409 message', async () => {
    const user = await openDialog()
    expect(screen.getByText('Name your space')).toBeInTheDocument()
    expect(screen.getByText('Do I need a new space?')).toBeInTheDocument()
    expect(screen.getByText(CREATE_SPACE_TEXT.explainText)).toBeInTheDocument()
    const name = screen.getByPlaceholderText('Name')
    const location = screen.getByRole('textbox', { name: 'Location' })
    // The location defaults to the folder that holds the current space.
    await waitFor(() => expect(location).toHaveValue('/home/gene/Spaces'))

    const create = screen.getByRole('button', { name: 'Create space' })
    expect(create).toBeDisabled()
    await user.type(name, '   ')
    expect(create).toBeDisabled()

    // An existing folder: the server's 409 becomes our message, and nothing is switched.
    mocked.createSpace.mockRejectedValueOnce(new ApiError(409, 'exists'))
    await user.clear(name)
    await user.type(name, 'Research')
    expect(create).toBeEnabled()
    await user.click(create)
    expect(await screen.findByRole('alert')).toHaveTextContent('A folder with that name already exists here.')
    expect(mocked.createSpace).toHaveBeenCalledWith('Research', '/home/gene/Spaces', 'blank')

    // A free name: created, then offered a switch.
    await user.clear(name)
    await user.type(name, '  Reading list ')
    await user.click(create)
    await waitFor(() => expect(mocked.createSpace).toHaveBeenLastCalledWith('Reading list', '/home/gene/Spaces', 'blank'))
    expect(await screen.findByText(CREATE_SPACE_TEXT.created)).toBeInTheDocument()
    expect(switchSpace).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Switch space' }))
    expect(switchSpace).toHaveBeenCalledWith('/home/gene/Spaces/Reading list')
    expect(useCreateSpaceDialog.getState().isOpen).toBe(false)

  })

  test('test later closes without switching and cancel creates nothing', async () => {
    const user = await openDialog()
    await user.type(screen.getByPlaceholderText('Name'), 'Side project')
    await user.click(screen.getByRole('button', { name: 'Create space' }))
    await user.click(await screen.findByRole('button', { name: 'Later' }))
    expect(switchSpace).not.toHaveBeenCalled()
    expect(useCreateSpaceDialog.getState().isOpen).toBe(false)

    act(() => useCreateSpaceDialog.getState().open())
    const name = await screen.findByPlaceholderText('Name')
    expect(name).toHaveValue('')
    await user.type(name, 'Nope')
    mocked.createSpace.mockClear()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mocked.createSpace).not.toHaveBeenCalled()
    expect(useCreateSpaceDialog.getState().isOpen).toBe(false)
  })

  // M32: a new space just starts. The dialog asks for a name and a folder, nothing else.
  test('test create dialog asks for a name and a folder only and makes the plain start', async () => {
    const user = await openDialog()
    expect(screen.queryByText('Pick a starting point')).toBeNull()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    for (const gone of ['Start with basic setup', 'IT operations', 'Empty space']) expect(screen.queryByText(gone)).toBeNull()
    expect(screen.getAllByRole('textbox').map((t) => t.getAttribute('aria-label') ?? t.closest('label')?.textContent)).toEqual(['Name', 'Location'])
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Location' })).toHaveValue('/home/gene/Spaces'))
    await user.type(screen.getByPlaceholderText('Name'), 'Journal')
    await user.click(screen.getByRole('button', { name: 'Create space' }))
    await waitFor(() => expect(mocked.createSpace).toHaveBeenCalledWith('Journal', '/home/gene/Spaces', 'blank'))
    expect(NEW_SPACE_SETUP).toBe('blank')
    expect(await screen.findByText(CREATE_SPACE_TEXT.created)).toBeInTheDocument()
    // The starter sets stay in the client for the type gallery.
    expect(SETUPS.map((o) => o.value)).toEqual(['basic', 'itops', 'blank'])
    expect(typeof api.spaceSetup).toBe('function')
  })

  test('test import from closes the dialog and opens the import dialog with the name and location (M15)', async () => {
    const user = await openDialog()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Location' })).toHaveValue('/home/gene/Spaces'))
    await user.type(screen.getByPlaceholderText('Name'), 'Vault')
    expect(screen.getByText(CREATE_SPACE_TEXT.importDescription)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: CREATE_SPACE_TEXT.importFrom }))
    expect(useCreateSpaceDialog.getState().isOpen).toBe(false)
    expect(useImportDialog.getState()).toMatchObject({ isOpen: true, preset: { name: 'Vault', location: '/home/gene/Spaces' } })
    expect(mocked.createSpace).not.toHaveBeenCalled()
  })

  test('test parent folder of posix and windows roots', () => {
    expect(parentFolder('/home/gene/Spaces/Work')).toBe('/home/gene/Spaces')
    expect(parentFolder('/home/gene/Spaces/Work/')).toBe('/home/gene/Spaces')
    expect(parentFolder('/Work')).toBe('/')
    expect(parentFolder('C:\\Users\\gene\\Work')).toBe('C:\\Users\\gene')
    expect(parentFolder('C:\\Work')).toBe('C:\\')
  })
})
