import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { SpaceInfo } from '@/api/types'
import { resetLinkIndex } from '@/links/linkIndex'
import { currentTarget, useTabs } from '@/nav/tabs'
import { typeDef } from '@/test/mockApi'
import { resetSettingsModal, useSettingsModal } from '@/settings/useSettingsModal'
import { resetSpaceInfo, useSpaceInfo } from '@/settings/useSpaceInfo'
import { TaskManagementSection } from './TaskManagement'

const mocked = vi.mocked(api)
const TASK = typeDef({ id: 'task', name: 'Task', pluralName: 'Tasks', basic: true })
const SPACE: SpaceInfo = { name: 'Lab', root: '/Lab', types: [TASK], icon: null, description: null, hideTaskManagement: false, revision: 's1' }

beforeEach(() => {
  vi.clearAllMocks()
  resetSpaceInfo()
  resetLinkIndex()
  resetSettingsModal()
  mocked.space.mockResolvedValue(SPACE)
  mocked.patchSpace.mockImplementation(async (patch) => ({ ...SPACE, ...patch, revision: 's2' }))
})

describe('TaskManagementSection', () => {
  test('test hide task management patches space.json and task customization opens the Task type', async () => {
    const user = userEvent.setup()
    useSettingsModal.getState().open('taskManagement')
    render(<TaskManagementSection />)
    expect(screen.getByRole('heading', { level: 2, name: 'Task management' })).toBeInTheDocument()
    expect(screen.getByText(/delete the Task type from this space/)).toBeInTheDocument()
    await waitFor(() => expect(useSpaceInfo.getState().space).not.toBeNull())
    const sw = screen.getByRole('switch', { name: 'Hide Task Management' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await user.click(sw)
    await waitFor(() => expect(mocked.patchSpace).toHaveBeenCalledWith({ hideTaskManagement: true }, { baseRevision: 's1' }))
    expect(useSpaceInfo.getState().space?.hideTaskManagement).toBe(true)

    expect(screen.getByRole('heading', { name: 'Task type settings' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open settings' }))
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'typeSettings', typeId: 'task' })
    expect(useSettingsModal.getState().isOpen).toBe(false)
  })
})
