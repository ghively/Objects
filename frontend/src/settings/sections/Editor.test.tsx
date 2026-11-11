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
import { EDITOR_SEARCH, EDITOR_TEXT, EditorSection } from './Editor'

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

    // Each switch starts at its default and a click saves the other value. M32: "Open notes as a
    // full page" starts on.
    for (const [label, key, start] of [
      ['Turn off automatic numbered lists', 'disableNumberedListTransformation', false],
      ['Disable spellcheck', 'disableSpellcheck', false],
      ['Open notes as a full page', 'alwaysOpenAsFullPage', true],
      ['Hide outliner lines', 'hideOutlinerLines', false],
    ] as const) {
      const sw = screen.getByRole('switch', { name: label })
      expect(sw).toHaveAttribute('aria-checked', String(start))
      await user.click(sw)
      expect(mocked.patchSettings).toHaveBeenLastCalledWith({ [key]: !start }, expect.anything())
    }

    // "Show object type icon…" is on while the icons are not hidden; turning it off hides them.
    const icons = screen.getByRole('switch', { name: 'Type icons on inline links' })
    expect(icons).toHaveAttribute('aria-checked', 'true')
    await user.click(icons)
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ hideEntityIconsOnInlineLinks: true }, expect.anything())
    expect(icons).toHaveAttribute('aria-checked', 'false')
  })

  test('test when this space opens is stored per space root, with a specific note', async () => {
    const user = userEvent.setup()
    useLinkIndex.setState({ objects: [objectSummary({ path: 'Pages/Runbook.md', title: 'Runbook' })], loaded: true })
    render(<EditorSection />)
    const group = screen.getByRole('radiogroup', { name: 'When this space opens' })
    expect(within(group).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Where I left off',
      'Home',
      'Calendar',
      'Calendar today',
      'Specific note',
    ])
    await waitFor(() => expect(useSpaceInfo.getState().space?.root).toBe('/space'))
    // The mock space's root is "/space".
    await waitFor(() => expect(within(group).getByRole('radio', { name: 'Where I left off' })).toHaveAttribute('aria-checked', 'true'))
    await user.click(within(group).getByRole('radio', { name: 'Calendar today' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ openOnStart: { '/space': { mode: 'today' } } }, expect.anything())

    // M32: Home (the Home tab) is a choice of its own.
    await user.click(within(group).getByRole('radio', { name: 'Home' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ openOnStart: { '/space': { mode: 'home' } } }, expect.anything())
    expect(within(group).getByRole('radio', { name: 'Home' })).toHaveAttribute('aria-checked', 'true')
    expect(EDITOR_SEARCH).toContain('Home')

    await user.click(within(group).getByRole('radio', { name: 'Specific note' }))
    expect(screen.getByText('The note shown when the app starts or you switch to this space.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Select a note' }))
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

  test('a Backlinks or Related section stored as "hidden" shows "Closed" checked (no Hidden there any more)', async () => {
    const user = userEvent.setup()
    useSettings.setState({
      settings: { ...settingsDefaults, backlinkSectionsDefault: { backlinks: 'hidden', relatedContent: 'hidden', unlinkedMentions: 'hidden' } },
      revision: 'r0',
      loaded: true,
    })
    render(<EditorSection />)
    for (const name of ['Backlinks', 'Related']) {
      const g = screen.getByRole('radiogroup', { name })
      expect(within(g).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Open', 'Closed'])
      expect(within(g).getByRole('radio', { name: 'Closed' })).toHaveAttribute('aria-checked', 'true')
    }
    expect(within(screen.getByRole('radiogroup', { name: 'Unlinked Mentions' })).getByRole('radio', { name: 'Hidden' })).toHaveAttribute('aria-checked', 'true')
    // The next change writes the read values, so the stored "hidden" is gone for those two.
    await user.click(within(screen.getByRole('radiogroup', { name: 'Backlinks' })).getByRole('radio', { name: 'Open' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith(
      { backlinkSectionsDefault: { backlinks: 'open', relatedContent: 'closed', unlinkedMentions: 'hidden' } },
      expect.anything(),
    )
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
      screen.getByText('Whether each section is expanded or collapsed when a note opens. Each note can still override it.'),
    ).toBeInTheDocument()
    // Only Unlinked Mentions can be hidden from here (catalog: Backlinks Open | Closed; Unlinked Mentions Open | Closed | Hidden).
    for (const name of ['Backlinks', 'Related']) {
      const g = screen.getByRole('radiogroup', { name })
      expect(within(g).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Open', 'Closed'])
      expect(within(g).getByRole('radio', { name: 'Open' })).toHaveAttribute('aria-checked', 'true')
    }
    const unlinked = screen.getByRole('radiogroup', { name: 'Unlinked Mentions' })
    expect(within(unlinked).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Open', 'Closed', 'Hidden'])
    expect(within(unlinked).getByRole('radio', { name: 'Open' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(screen.getByRole('radiogroup', { name: 'Related' })).getByRole('radio', { name: 'Closed' }))
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

    const hidden = screen.getByRole('group', { name: 'Types without related content' })
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
    expect(screen.getByRole('heading', { name: 'How nested backlinks show at first' })).toBeInTheDocument()
    const g = screen.getByRole('radiogroup', { name: 'How nested backlinks show at first' })
    expect(within(g).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Just the linking block', 'Full path above'])
    expect(within(g).getByRole('radio', { name: 'Just the linking block' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(g).getByRole('radio', { name: 'Full path above' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ nestedBacklinkView: 'showFullPathAbove' }, expect.anything())
  })

  test('test always create inline links and hide object type settings switches patch settings', async () => {
    const user = userEvent.setup()
    render(<EditorSection />)
    for (const [label, key] of [
      ['Insert links inline by default', 'alwaysCreateInlineLinks'],
      ['Keep type settings inside Settings only', 'hideTypeSettings'],
    ] as const) {
      const sw = screen.getByRole('switch', { name: label })
      expect(sw).toHaveAttribute('aria-checked', 'false')
      await user.click(sw)
      expect(mocked.patchSettings).toHaveBeenLastCalledWith({ [key]: true }, expect.anything())
    }
    expect(
      screen.getByText('Linking to a note always makes an inline link, even at the start of an empty block.'),
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

  test('M31: "Hide App Menu" sits after "Hide outliner lines" and before "When this space opens", and patches hideAppMenu', async () => {
    const user = userEvent.setup()
    render(<EditorSection />)
    const sw = screen.getByRole('switch', { name: 'Hide App Menu' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    const outliner = screen.getByRole('switch', { name: 'Hide outliner lines' })
    const opens = screen.getByRole('radiogroup', { name: 'When this space opens' })
    expect(outliner.compareDocumentPosition(sw) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(sw.compareDocumentPosition(opens) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText(EDITOR_TEXT.hideAppMenuDescription)).toBeInTheDocument()
    await user.click(sw)
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ hideAppMenu: true }, expect.anything())
    expect(EDITOR_SEARCH).toContain('Hide App Menu')
  })

  test('test the note switches say what they do in notes-first words (M32)', () => {
    const { container } = render(<EditorSection />)
    const full = screen.getByRole('region', { name: 'Open notes as a full page' })
    expect(full).toHaveTextContent('Clicking a note opens it as a full page.')
    const props = screen.getByRole('region', { name: 'Show properties by default' })
    // It applies to types with properties of their own; a plain note starts with the panel closed.
    expect(props).toHaveTextContent(
      'Notes of a type that has properties of its own open with the properties panel showing. A plain Note or Daily note has none, so its panel starts closed. Off: the panel starts hidden for every type; the properties button shows it for that note.',
    )
    expect(screen.getByRole('switch', { name: 'Show properties by default' })).toHaveAttribute('aria-checked', 'true')
    // No default text of the section says "object" (the app's name aside).
    expect((container.textContent ?? '').replace(/\bObject\b/g, '')).not.toMatch(/object/i)
  })

  test('test the types without related content show Notes and Daily notes for the built-in types (M32)', () => {
    useLinkIndex.setState({
      types: [
        typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true }),
        typeDef({ id: 'dailynote', name: 'DailyNote', pluralName: 'DailyNotes', basic: true }),
        typeDef({ id: 'Book', name: 'Book', pluralName: 'Books' }),
      ],
      loaded: true,
    })
    render(<EditorSection />)
    const group = screen.getByRole('group', { name: 'Types without related content' })
    expect(within(group).getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual(['Notes', 'Daily notes', 'Books'])
  })
})
