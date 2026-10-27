import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { currentTarget, useTabs } from '@/nav/tabs'
import { typeDef } from '@/test/mockApi'
import { resetSettingsModal, useSettingsModal } from '@/settings/useSettingsModal'
import { resetSpaceInfo } from '@/settings/useSpaceInfo'
import { ObjectTypesSection } from './ObjectTypes'

beforeEach(() => {
  vi.clearAllMocks()
  resetSpaceInfo()
  resetLinkIndex()
  resetSettingsModal()
  useLinkIndex.setState({
    types: [
      typeDef({ id: 'server', name: 'Server', pluralName: 'Servers', basic: false }),
      typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true }),
      typeDef({ id: 'task', name: 'Task', pluralName: 'Tasks', basic: true }),
    ],
    loaded: true,
  })
})

describe('ObjectTypesSection', () => {
  test('test object types rows open type settings', async () => {
    const user = userEvent.setup()
    useSettingsModal.getState().open('objectTypes')
    render(<ObjectTypesSection />)
    expect(screen.getByRole('heading', { level: 2, name: 'Object Types' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your object types' })).toBeInTheDocument()
    const basic = screen.getByRole('group', { name: 'Basic object types' })
    expect(within(basic).getAllByRole('button').map((b) => b.textContent)).toEqual(['Pages', 'Tasks'])
    const custom = screen.getByRole('group', { name: 'Custom object types' })
    expect(within(custom).getAllByRole('button').map((b) => b.textContent)).toEqual(['Servers'])

    await user.click(within(custom).getByRole('button', { name: 'Servers' }))
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'typeSettings', typeId: 'server' })
    expect(useSettingsModal.getState().isOpen).toBe(false)
  })
})
