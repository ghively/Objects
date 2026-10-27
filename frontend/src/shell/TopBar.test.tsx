import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { api } from '@/api/client'
import { resetSpaceInfo, useSpaceInfo } from '@/settings/useSpaceInfo'
import { TOP_BAR_TEXT, TopBar, type TopBarProps } from './TopBar'

const mocked = vi.mocked(api)

const STRINGS = readFileSync(
  path.resolve(import.meta.dirname, '../../../docs/strings.txt'),
  'utf8',
)

function bar(props: Partial<TopBarProps> = {}) {
  const all: TopBarProps = {
    spaceName: 'space',
    onToggleSidebar: vi.fn(),
    onToggleRightPanel: vi.fn(),
    rightPanelOpen: false,
    onNewTab: vi.fn(),
    ...props,
  }
  return { ...render(<TopBar {...all} />), props: all }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetSpaceInfo()
})

describe('TopBar', () => {
  test('test top bar space button, create new tab label and sidepanel tooltips', async () => {
    const user = userEvent.setup()
    mocked.space.mockResolvedValue({
      name: 'Work',
      root: '/spaces/Work',
      types: [],
      icon: '🚀',
      description: null,
      hideTaskManagement: false,
      revision: '',
    })
    const { props, rerender } = bar()

    // The space button: "Change space", the stored name and icon once loaded.
    const spaceButton = screen.getByTitle('Change space')
    await waitFor(() => expect(spaceButton).toHaveTextContent('🚀Work'))
    await user.click(spaceButton)
    expect(await screen.findByRole('list', { name: 'Spaces' })).toBeInTheDocument()
    await waitFor(() => expect(mocked.spaces).toHaveBeenCalled())
    await user.keyboard('{Escape}')

    // A rename elsewhere shows at once.
    useSpaceInfo.setState((s) => ({ space: s.space && { ...s.space, name: 'Work notes', icon: null } }))
    await waitFor(() => expect(spaceButton).toHaveTextContent('Work notes'))

    const newTab = screen.getByRole('button', { name: 'Create new tab' })
    await user.click(newTab)
    expect(props.onNewTab).toHaveBeenCalledTimes(1)

    const toggle = screen.getByRole('button', { name: 'Show sidepanel' })
    expect(toggle).toHaveAttribute('title', 'Show sidepanel')
    await user.click(toggle)
    expect(props.onToggleRightPanel).toHaveBeenCalledTimes(1)
    rerender(<TopBar {...props} rightPanelOpen />)
    expect(screen.getByRole('button', { name: 'Hide sidepanel' })).toHaveAttribute('aria-pressed', 'true')

    for (const s of Object.values(TOP_BAR_TEXT)) expect(STRINGS.includes(`s:\`${s}\``), s).toBe(true)
  })

  test('test space button falls back to the prop name before the space info loads', () => {
    mocked.space.mockImplementation(() => new Promise(() => undefined))
    bar({ spaceName: 'Loading space' })
    expect(screen.getByTitle('Change space')).toHaveTextContent('Loading space')
  })
})
