import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ApiError } from '@/api/client'
import { AddAgentFolderDialog } from './AddAgentFolderDialog'
import { resetAgents } from './useAgents'

const mocked = vi.mocked(api)

describe('AddAgentFolderDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAgents()
  })

  test('test Add folder needs a path, then registers it and closes', async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<AddAgentFolderDialog open onOpenChange={onOpenChange} />)
    const dialog = screen.getByRole('dialog', { name: 'Add agent folder' })
    expect(within(dialog).getByRole('button', { name: 'Add folder' })).toBeDisabled()
    await user.type(within(dialog).getByRole('textbox', { name: 'Folder path' }), '  D:/Shared/Helper ')
    await user.click(within(dialog).getByRole('button', { name: 'Add folder' }))
    expect(mocked.addAgentFolder).toHaveBeenCalledWith('D:/Shared/Helper')
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(mocked.agents).toHaveBeenCalled()
  })

  test('test a 409 shows the server message', async () => {
    mocked.addAgentFolder.mockRejectedValueOnce(new ApiError(409, 'An agent with this id is already listed.'))
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<AddAgentFolderDialog open onOpenChange={onOpenChange} />)
    const dialog = screen.getByRole('dialog', { name: 'Add agent folder' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Folder path' }), 'D:/Copy')
    await user.click(within(dialog).getByRole('button', { name: 'Add folder' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('An agent with this id is already listed.')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
