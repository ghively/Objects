import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { objectSummary, spaceEntry, typeDef } from '@/test/mockApi'
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
      ['Turn off automatic numbered lists', 'disableNumberedListTransformation'],
      ['Disable spellcheck', 'disableSpellcheck'],
      ['Open objects as a full page', 'alwaysOpenAsFullPage'],
      ['Hide outliner lines', 'hideOutlinerLines'],
    ] as const) {
      const sw = screen.getByRole('switch', { name: label })
      expect(sw).toHaveAttribute('aria-checked', 'false')
      await user.click(sw)
      expect(mocked.patchSettings).toHaveBeenLastCalledWith({ [key]: true }, expect.anything())
    }

    // "Show object type icon…" is on while the icons are not hidden; turning it off hides them.
    const icons = screen.getByRole('switch', { name: 'Type icons on inline links' })
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

  test('test backlink defaults save each section', async () => {
    const user = userEvent.setup()
    useLinkIndex.setState({
      types: [typeDef({ id: 'Person', name: 'Person', pluralName: 'People' }), typeDef({ id: 'Book', name: 'Book', pluralName: 'Books' })],
      loaded: true,
    })
    render(<EditorSection />)
    expect(screen.getByRole('heading', { name: 'Backlink sections start as' })).toBeInTheDocument()
    expect(
      screen.getByText('Whether each section is expanded or collapsed when an object page opens. Each object can still override it.'),
    ).toBeInTheDocument()
    for (const name of ['Backlinks', 'Related Content', 'Unlinked Mentions']) {
      const g = screen.getByRole('radiogroup', { name })
      expect(within(g).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Open', 'Closed', 'Hidden'])
      expect(within(g).getByRole('radio', { name: 'Open' })).toHaveAttribute('aria-checked', 'true')
    }
    await user.click(within(screen.getByRole('radiogroup', { name: 'Related Content' })).getByRole('radio', { name: 'Closed' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith(
      { backlinkSectionsDefault: { backlinks: 'open', relatedContent: 'closed', unlinkedMentions: 'open' } },
      expect.anything(),
    )
    await user.click(within(screen.getByRole('radiogroup', { name: 'Unlinked Mentions' })).getByRole('radio', { name: 'Hidden' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith(
      { backlinkSectionsDefault: { backlinks: 'open', relatedContent: 'closed', unlinkedMentions: 'hidden' } },
      expect.anything(),
    )

    const view = screen.getByRole('radiogroup', { name: 'Backlink content view' })
    expect(within(view).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Link block',
      'Small card',
      'Wide card',
      'Embed',
    ])
    expect(within(view).getByRole('radio', { name: 'Embed' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(view).getByRole('radio', { name: 'Small card' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ backlinkContentView: 'smallCard' }, expect.anything())

    const hidden = screen.getByRole('group', { name: 'Hide related content for object types' })
    const clear = screen.getByRole('button', { name: 'Clear all' })
    expect(clear).toBeDisabled()
    await user.click(within(hidden).getByRole('checkbox', { name: 'Books' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ relatedContentHiddenTypes: ['Book'] }, expect.anything())
    await user.click(within(hidden).getByRole('checkbox', { name: 'People' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ relatedContentHiddenTypes: ['Book', 'Person'] }, expect.anything())
    expect(within(hidden).getByRole('checkbox', { name: 'Books' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ relatedContentHiddenTypes: [] }, expect.anything())
  })

  test('test nested backlink mode saves', async () => {
    const user = userEvent.setup()
    render(<EditorSection />)
    expect(screen.getByRole('heading', { name: 'Default display of nested backlinks' })).toBeInTheDocument()
    const g = screen.getByRole('radiogroup', { name: 'Default display of nested backlinks' })
    expect(within(g).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Only block with backlink', 'Full path above'])
    expect(within(g).getByRole('radio', { name: 'Only block with backlink' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(g).getByRole('radio', { name: 'Full path above' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ nestedBacklinkView: 'showFullPathAbove' }, expect.anything())
  })

  test('test always create inline links and hide object type settings switches patch settings', async () => {
    const user = userEvent.setup()
    render(<EditorSection />)
    for (const [label, key] of [
      ['Insert links inline by default', 'alwaysCreateInlineLinks'],
      ['Hide object type settings outside of settings', 'hideStructureSettings'],
    ] as const) {
      const sw = screen.getByRole('switch', { name: label })
      expect(sw).toHaveAttribute('aria-checked', 'false')
      await user.click(sw)
      expect(mocked.patchSettings).toHaveBeenLastCalledWith({ [key]: true }, expect.anything())
    }
    expect(
      screen.getByText('Linking to an object always makes an inline link, even at the start of an empty block.'),
    ).toBeInTheDocument()
  })

  test('test highlight style offers default and minimal', async () => {
    const user = userEvent.setup()
    render(<EditorSection />)
    const g = screen.getByRole('radiogroup', { name: 'Highlight Style' })
    expect(within(g).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Default', 'Minimal'])
    expect(within(g).getByRole('radio', { name: 'Default' })).toHaveAttribute('aria-checked', 'true')
    expect(within(g).getByText('No rail; the highlight reads as ordinary text.')).toBeInTheDocument()
    await user.click(within(g).getByRole('radio', { name: 'Minimal' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ highlightStyle: 'minimal' }, expect.anything())
  })

  test('test spellcheck language saves a normalised tag and refuses a bad one', async () => {
    const user = userEvent.setup()
    render(<EditorSection />)
    const input = screen.getByRole('textbox', { name: 'Spellcheck language' })
    expect(input).toHaveAttribute('placeholder', 'e.g. "en-GB"...')
    await user.type(input, 'english{Enter}')
    expect(screen.getByText('Invalid language tag...')).toBeInTheDocument()
    expect(mocked.patchSettings).not.toHaveBeenCalled()
    await user.clear(input)
    await user.type(input, 'de_ch{Enter}')
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ spellCheckLang: 'de-CH' }, expect.anything())
    expect(input).toHaveValue('de-CH')
    expect(screen.queryByText('Invalid language tag...')).not.toBeInTheDocument()
    await user.clear(input)
    await user.tab()
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ spellCheckLang: null }, expect.anything())
  })
})