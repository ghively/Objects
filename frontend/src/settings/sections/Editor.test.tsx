import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { objectSummary, spaceEntry } from '@/test/mockApi'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { resetSpaceInfo, useSpaceInfo } from '@/settings/useSpaceInfo'
import { EditorSection } from './Editor'

const mocked = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  resetSpaceInfo()
  resetLinkIndex()
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
})

describe('EditorSection', () => {
  test('test editor controls patch device settings; show icons switch is inverted', async () => {
    const user = userEvent.setup()
    render(<EditorSection />)
    expect(screen.getByRole('heading', { level: 2, name: 'Editor' })).toBeInTheDocument()

    const toggle = screen.getByRole('radiogroup', { name: 'Toggle style' })
    expect(within(toggle).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Toggle', 'Bullet'])
    await user.click(within(toggle).getByRole('radio', { name: 'Bullet' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ toggleStyle: 'bullet' }, expect.anything())

    for (const [label, key] of [
      ['Disable automatic detection of numbered lists', 'disableNumberedListTransformation'],
      ['Disable spellcheck', 'disableSpellcheck'],
      ['Always open as full page', 'alwaysOpenAsFullPage'],
      ['Hide outliner lines', 'hideOutlinerLines'],
    ] as const) {
      const sw = screen.getByRole('switch', { name: label })
      expect(sw).toHaveAttribute('aria-checked', 'false')
      await user.click(sw)
      expect(mocked.patchSettings).toHaveBeenLastCalledWith({ [key]: true }, expect.anything())
    }

    // "Show object type icon…" is on while the icons are not hidden; turning it off hides them.
    const icons = screen.getByRole('switch', { name: 'Show object type icon for inline object links' })
    expect(icons).toHaveAttribute('aria-checked', 'true')
    await user.click(icons)
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ hideEntityIconsOnInlineLinks: true }, expect.anything())
    expect(icons).toHaveAttribute('aria-checked', 'false')
  })

  test('test when this space opens is stored per space root, with a specific object', async () => {
    const user = userEvent.setup()
    useLinkIndex.setState({ objects: [objectSummary({ path: 'Pages/Runbook.md', title: 'Runbook' })], loaded: true })
    render(<EditorSection />)
    const group = screen.getByRole('radiogroup', { name: 'When this space opens' })
    expect(within(group).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Where I left off',
      'Calendar today',
      'Calendar',
      'Specific object',
    ])
    await waitFor(() => expect(useSpaceInfo.getState().space?.root).toBe('/space'))
    // The mock space's root is "/space".
    await waitFor(() => expect(within(group).getByRole('radio', { name: 'Where I left off' })).toHaveAttribute('aria-checked', 'true'))
    await user.click(within(group).getByRole('radio', { name: 'Calendar today' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ openOnStart: { '/space': { mode: 'today' } } }, expect.anything())

    await user.click(within(group).getByRole('radio', { name: 'Specific object' }))
    await user.click(screen.getByRole('button', { name: 'Select object' }))
    await user.click(await screen.findByRole('option', { name: 'Runbook' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith(
      { openOnStart: { '/space': { mode: 'specificObject', path: 'Pages/Runbook.md' } } },
      expect.anything(),
    )
  })

  test('test space on this device picks a specific space', async () => {
    const user = userEvent.setup()
    mocked.spaces.mockResolvedValue([
      spaceEntry({ path: '/space', name: 'space', current: true }),
      spaceEntry({ path: '/other/Work', name: 'Work' }),
    ])
    render(<EditorSection />)
    expect(screen.getByRole('heading', { name: 'When Object starts' })).toBeInTheDocument()
    const group = screen.getByRole('radiogroup', { name: 'Space on this device' })
    await waitFor(() => expect(useSpaceInfo.getState().space?.root).toBe('/space'))
    await waitFor(() => expect(mocked.spaces).toHaveBeenCalled())
    await user.click(within(group).getByRole('radio', { name: 'Specific space' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ startupSpace: 'specific', startupSpacePath: '/space' }, expect.anything())
    await user.selectOptions(screen.getByRole('combobox', { name: 'Specific space' }), 'Work')
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ startupSpacePath: '/other/Work' }, expect.anything())
  })
})
