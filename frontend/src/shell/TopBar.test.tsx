import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { resetSpaceInfo, useSpaceInfo } from '@/settings/useSpaceInfo'
import { TopBar, type TopBarProps } from './TopBar'

const mocked = vi.mocked(api)


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
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
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

  })

  test('test space button falls back to the prop name before the space info loads', () => {
    mocked.space.mockImplementation(() => new Promise(() => undefined))
    bar({ spaceName: 'Loading space' })
    expect(screen.getByTitle('Change space')).toHaveTextContent('Loading space')
  })

  // M31 item 12: Editor "Hide App Menu" hides the top bar's space menu (Object's app menu: the
  // spaces, Space settings, Space history, Create space, Open folder…). Tapping Alt shows it again,
  // as a hidden window menu bar comes back with Alt; tapping Alt again hides it.
  test('Hide App Menu hides the space menu; a lone Alt tap shows it and another hides it', async () => {
    const user = userEvent.setup()
    useSettings.setState({ settings: { ...settingsDefaults, hideAppMenu: true } })
    bar()
    expect(screen.queryByTitle('Change space')).not.toBeInTheDocument()
    // The sidebar toggle stays.
    expect(screen.getByRole('button', { name: 'Toggle sidebar' })).toBeInTheDocument()

    await user.keyboard('{Alt}')
    const shown = await screen.findByTitle('Change space')
    expect(shown).toHaveFocus()
    await user.click(shown)
    expect(await screen.findByRole('list', { name: 'Spaces' })).toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.keyboard('{Alt}')
    await waitFor(() => expect(screen.queryByTitle('Change space')).not.toBeInTheDocument())

    // Alt held with another key (Alt+Left, a shortcut) is not a tap.
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}')
    expect(screen.queryByTitle('Change space')).not.toBeInTheDocument()
  })

  test('a lone Alt tap while typing shows the menu but leaves the caret in the field; the next tap hides it, focus still there (M31 fix)', async () => {
    const user = userEvent.setup()
    useSettings.setState({ settings: { ...settingsDefaults, hideAppMenu: true } })
    bar()
    const field = document.createElement('textarea')
    field.setAttribute('aria-label', 'Typing here')
    document.body.appendChild(field)
    field.focus()
    await user.keyboard('{Alt}')
    expect(await screen.findByTitle('Change space')).toBeInTheDocument()
    expect(field).toHaveFocus()
    await user.keyboard('{Alt}')
    await waitFor(() => expect(screen.queryByTitle('Change space')).not.toBeInTheDocument())
    expect(field).toHaveFocus()
    field.remove()
  })

  test('outside a field Alt focuses the shown menu; hiding it gives focus back where it was, not to the body (M31 fix)', async () => {
    const user = userEvent.setup()
    useSettings.setState({ settings: { ...settingsDefaults, hideAppMenu: true } })
    bar()
    const before = document.createElement('button')
    before.textContent = 'Somewhere'
    document.body.appendChild(before)
    before.focus()
    await user.keyboard('{Alt}')
    expect(await screen.findByTitle('Change space')).toHaveFocus()
    await user.keyboard('{Alt}')
    await waitFor(() => expect(screen.queryByTitle('Change space')).not.toBeInTheDocument())
    expect(before).toHaveFocus()
    before.remove()
  })

  test('with Hide App Menu off, Alt does nothing to the space menu', async () => {
    const user = userEvent.setup()
    bar()
    expect(screen.getByTitle('Change space')).toBeInTheDocument()
    await user.keyboard('{Alt}')
    expect(screen.getByTitle('Change space')).toBeInTheDocument()
  })

  test('turning Hide App Menu on hides the menu at once', async () => {
    bar()
    expect(screen.getByTitle('Change space')).toBeInTheDocument()
    useSettings.setState((s) => ({ settings: { ...s.settings, hideAppMenu: true } }))
    await waitFor(() => expect(screen.queryByTitle('Change space')).not.toBeInTheDocument())
  })
})
