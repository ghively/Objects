import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { Sidebar } from '@/shell/Sidebar'
import { ShortcutsSheet } from '@/settings/ShortcutsSheet'
import { resetSettingsModal, useSettingsModal } from '@/settings/useSettingsModal'
import { typeDef } from '@/test/mockApi'
import { GUIDES, HELP_COLLAPSED_KEY, HELP_TEXT } from './helpText'
import { GUIDE_DOCS, HELP_DOCS } from './HelpDialog'

const TYPES = [typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true })]

function helpSection() {
  return screen.getByRole('region', { name: HELP_TEXT.section })
}

/** Every request the page made, by URL. */
function fetchedUrls(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.map((args: unknown[]) => {
    const req = args[0] as RequestInfo | URL
    return typeof req === 'string' ? req : req instanceof URL ? req.href : req.url
  })
}

/** A URL on this machine: relative, or on a loopback host. */
function isLocal(url: string): boolean {
  const u = new URL(url, 'http://127.0.0.1/')
  return ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
}

/** No mocked api function that changes the space was called. */
function spaceWrites(): string[] {
  const fns = api as unknown as Record<string, { mock?: { calls: unknown[] } }>
  return Object.keys(fns).filter(
    (k) => /save|create|update|write|delete|put|patch|move|rename|restore|trash/i.test(k) && (fns[k].mock?.calls.length ?? 0) > 0,
  )
}

describe('Help & Resources (sidebar)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    localStorage.removeItem(HELP_COLLAPSED_KEY)
    resetSettingsModal()
    vi.clearAllMocks()
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('renders the section below the types with its four entries', () => {
    render(<Sidebar types={TYPES} />)
    const section = helpSection()
    // Below the types, at the end of the sidebar's scrolling content (M32: the sidebar's heading
    // is "Types"; it was "Object Types").
    const types = screen.getByRole('heading', { name: /^(Object )?Types$/ })
    expect(types.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const entries = within(section).getAllByRole('listitem').map((li) => li.textContent)
    expect(entries).toEqual([HELP_TEXT.shortcuts, HELP_TEXT.gettingStarted, HELP_TEXT.markdownReference, HELP_TEXT.guides])
    // Local only: no link of any kind.
    expect(section.querySelectorAll('a')).toHaveLength(0)
  })

  it('Keyboard shortcuts opens the Shortcuts sheet', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Sidebar types={TYPES} />
        <ShortcutsSheet />
      </>,
    )
    await user.click(within(helpSection()).getByRole('button', { name: HELP_TEXT.shortcuts }))
    expect(useSettingsModal.getState().shortcutsOpen).toBe(true)
    expect(await screen.findByRole('dialog', { name: 'Shortcuts' })).toBeInTheDocument()
  })

  it.each([
    ['gettingStarted', HELP_TEXT.gettingStarted, 'Where your files live'],
    ['markdownReference', HELP_TEXT.markdownReference, 'Properties (front matter)'],
  ] as const)('%s opens read-only, with no request off this machine and no write', async (doc, label, heading) => {
    const user = userEvent.setup()
    render(<Sidebar types={TYPES} />)
    await user.click(within(helpSection()).getByRole('button', { name: label }))
    const dialog = await screen.findByRole('dialog', { name: label })
    expect(dialog).toHaveAttribute('data-help-doc', doc)
    await waitFor(() => expect(within(dialog).getByRole('heading', { level: 1 })).toHaveTextContent(label))
    expect(within(dialog).getByRole('heading', { name: heading })).toBeInTheDocument()
    expect(dialog.querySelector('.ProseMirror')).toHaveAttribute('contenteditable', 'false')
    // No external link in the rendered text.
    for (const a of dialog.querySelectorAll('a[href]')) expect(isLocal(a.getAttribute('href')!)).toBe(true)
    expect(fetchedUrls(fetchSpy).filter((u) => !isLocal(u))).toEqual([])
    expect(spaceWrites()).toEqual([])
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('the bundled texts name no remote address and cover what they should', () => {
    for (const text of Object.values(HELP_DOCS)) expect(text).not.toMatch(/[a-z]+:\/\/|www\./i)
    const guide = HELP_DOCS.gettingStarted
    for (const topic of ['Spaces', 'Types and properties', '`@`', '`[[`', "Today's note", 'saved search', 'Ctrl+K', '`.md`', '`.object/`']) {
      expect(guide).toContain(topic)
    }
    const words = guide.split(/\s+/).filter(Boolean).length
    expect(words).toBeGreaterThanOrEqual(300)
    expect(words).toBeLessThanOrEqual(700)
    const ref = HELP_DOCS.markdownReference
    for (const topic of ['Headings', 'Lists', 'To-dos', 'Quotes', 'Toggles', 'Links', 'front matter']) expect(ref).toContain(topic)
  })

  it('How-to guides lists the guides and opens each read-only, with no request off this machine and no write (D1)', async () => {
    const user = userEvent.setup()
    render(<Sidebar types={TYPES} />)
    await user.click(within(helpSection()).getByRole('button', { name: HELP_TEXT.guides }))
    const dialog = await screen.findByRole('dialog', { name: HELP_TEXT.guides })
    expect(dialog).toHaveAttribute('data-help-doc', 'guides')
    const titles = GUIDES.map((g) => g.title)
    // M32: Tasks leads (every space has tasks); the four type guides follow.
    expect(titles).toEqual(['Tasks', 'People', 'Meetings', 'Projects', 'Books'])
    for (const g of GUIDES) {
      await user.click(within(dialog).getByRole('button', { name: g.title }))
      expect(dialog.querySelector(`[data-guide="${g.id}"]`)).not.toBeNull()
      await waitFor(() => expect(within(dialog).getByRole('heading', { level: 1 })).toHaveTextContent(g.title))
      expect(dialog.querySelector('.ProseMirror')).toHaveAttribute('contenteditable', 'false')
      await user.click(within(dialog).getByRole('button', { name: HELP_TEXT.allGuides }))
    }
    expect(fetchedUrls(fetchSpy).filter((u) => !isLocal(u))).toEqual([])
    expect(spaceWrites()).toEqual([])
  })

  it('the guides name no remote address, stay short and cover their type', () => {
    for (const text of Object.values(GUIDE_DOCS)) {
      expect(text).not.toMatch(/[a-z]+:\/\/|www\./i)
      expect(text.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(420)
    }
    for (const [id, props] of [
      ['people', ['Picture', 'Category', 'Organizations', 'Projects', 'Meetings']],
      ['meetings', ['Date', 'Type', 'Attendees', 'Project', 'Reviewed']],
      ['projects', ['Status', 'Timeframe', 'Collaborators', 'Steps', 'Projects map']],
      ['books', ['Authors', 'Genre', 'Rating', 'Reading timeline']],
      // M32: the plain Tasks page, then the optional Work page (the dashboard).
      ['tasksDashboard', ['Today', 'Upcoming', 'Inbox', 'All', 'Done', 'More', 'Add a task', 'New task', 'Search tasks', 'The Work page (optional)', 'Now', 'Brain dump', 'More views']],
    ] as const)
      for (const p of props) expect(GUIDE_DOCS[id]).toContain(p)
  })

  it('folds like the other sections, and the fold persists', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Sidebar types={TYPES} />)
    const fold = within(helpSection()).getByRole('button', { name: HELP_TEXT.section })
    expect(fold).toHaveAttribute('aria-expanded', 'true')
    await user.click(fold)
    expect(fold).toHaveAttribute('aria-expanded', 'false')
    expect(within(helpSection()).queryByRole('button', { name: HELP_TEXT.gettingStarted })).toBeNull()
    expect(localStorage.getItem(HELP_COLLAPSED_KEY)).toBe('1')
    unmount()

    render(<Sidebar types={TYPES} />)
    const again = within(helpSection()).getByRole('button', { name: HELP_TEXT.section })
    expect(again).toHaveAttribute('aria-expanded', 'false')
    expect(within(helpSection()).queryByRole('button', { name: HELP_TEXT.shortcuts })).toBeNull()
    await user.click(again)
    expect(within(helpSection()).getByRole('button', { name: HELP_TEXT.shortcuts })).toBeInTheDocument()
    expect(localStorage.getItem(HELP_COLLAPSED_KEY)).toBeNull()
  })

  // M32 (item 14): Help is written for someone who writes notes and tracks tasks by hand.
  describe('notes first (M32)', () => {
    const headings = (text: string) => text.split('\n').filter((l) => /^#{1,2} /.test(l)).map((l) => l.replace(/^#+ /, ''))

    it('Getting started opens with the first five minutes; types and properties come later, as optional', () => {
      const guide = HELP_DOCS.gettingStarted
      expect(headings(guide)).toEqual([
        'Getting started',
        'Your first five minutes',
        'Finding your way around',
        'Types and properties (optional)',
        'The Assistant',
        'Spaces',
        'Where your files live',
      ])
      expect(guide).not.toContain('Everything you write is an object')
      // The first five minutes, in order: a note, today's note, a link, a task with a date, search, tags.
      const first = guide.slice(guide.indexOf('## Your first five minutes'), guide.indexOf('## Finding your way around'))
      const steps = ['**Write a note.**', "**Open today's note.**", '**Link two notes.**', '**Add a task with a date.**', '**Find things.**', '**Tag a note.**']
      const at = steps.map((t) => first.indexOf(t))
      expect(at.every((i) => i >= 0)).toBe(true)
      expect([...at].sort((a, b) => a - b)).toEqual(at)
      for (const key of ['`[[`', 'Ctrl+K', 'Ctrl+Shift+D', '`#`', 'friday']) expect(first).toContain(key)
      // Nothing about types or properties before their own section.
      expect(first).not.toMatch(/\bpropert(y|ies)\b|\btypes\b|\ba type\b|\bcollections?\b/i)
      // One short paragraph on the Assistant as a helper, and one line on Work and IT as things you turn on.
      const assistant = guide.slice(guide.indexOf('## The Assistant'), guide.indexOf('## Spaces'))
      expect(assistant.trim().split(/\n\s*\n/)).toHaveLength(2)
      expect(assistant).toContain('only when you ask')
      expect(guide).toMatch(/The Work page[^\n]*IT operations[^\n]*until you turn them on/)
    })

    it('no help text says "object" for a thing you wrote (the app, its folders and file names aside)', () => {
      const texts = { ...HELP_DOCS, ...GUIDE_DOCS, ...HELP_TEXT, ...Object.fromEntries(GUIDES.map((g) => [`title:${g.id}`, g.title])) }
      for (const [name, text] of Object.entries(texts)) {
        const plain = String(text)
          .replace(/`[^`]*`/g, '') // `.object/`, file names, front matter
          .replace(/\bObject\b(?! types?\b)/g, '') // the app's name
        expect(plain, name).not.toMatch(/object/i)
        expect(plain, name).not.toMatch(/\bquer(y|ies)\b/i)
      }
    })

    it('the Tasks guide is about the plain page, with the Work page as a short optional section', () => {
      const tasks = GUIDE_DOCS.tasksDashboard
      expect(headings(tasks)).toEqual(['Tasks', 'The lists', 'Adding a task', 'Dates', 'Finishing and finding', 'The Work page (optional)'])
      const plain = tasks.slice(0, tasks.indexOf('## The Work page (optional)'))
      // The dashboard's parts are not in the plain page's part.
      for (const word of ['Now', 'Energy', 'Brain dump', 'queue', 'Captures', 'agent']) expect(plain).not.toContain(word)
      for (const word of ['friday', 'tomorrow', 'nov 20', 'next week', 'Backspace', 'Today', 'Tomorrow', 'Next week', 'No date', 'Overdue']) {
        expect(plain).toContain(word)
      }
      for (const list of ['Status', 'Deadline', 'Recurring', 'Reminders', 'Tags', 'Context']) expect(plain).toContain(list)
      const work = tasks.slice(tasks.indexOf('## The Work page (optional)'))
      expect(work).toContain('Use the Work page in this space')
      expect(work.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(200)
    })

    it('the guides say how to get a type now that a new space no longer asks', () => {
      for (const id of ['people', 'meetings', 'projects', 'books'] as const) {
        expect(GUIDE_DOCS[id]).not.toContain('Start with basic setup')
        expect(GUIDE_DOCS[id]).toContain('`+` beside **Types**')
      }
      // A project's ticket fields are there only while the Work page is on.
      expect(GUIDE_DOCS.projects).toContain('While the Work page is on')
      expect(HELP_TEXT.guidesIntro).toBe('Short guides to Tasks and to four types you can add: People, Meetings, Projects and Books.')
    })
  })
})
