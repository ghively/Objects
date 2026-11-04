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
import { HELP_COLLAPSED_KEY, HELP_TEXT } from './helpText'
import { HELP_DOCS } from './HelpDialog'

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

  it('renders the section below Graph and Trash with its three entries', () => {
    render(<Sidebar types={TYPES} />)
    const section = helpSection()
    const space = screen.getByRole('navigation', { name: 'Space' })
    // Below the space entries (and so below the object types).
    expect(space.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const types = screen.getByRole('heading', { name: 'Object Types' })
    expect(types.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const entries = within(section).getAllByRole('listitem').map((li) => li.textContent)
    expect(entries).toEqual([HELP_TEXT.shortcuts, HELP_TEXT.gettingStarted, HELP_TEXT.markdownReference])
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
    for (const topic of ['Spaces', 'Objects and types', 'Properties', '`@`', '`[[`', 'Daily notes', 'Collections and queries', 'Ctrl+K', '`.md`', '`.object/`']) {
      expect(guide).toContain(topic)
    }
    const words = guide.split(/\s+/).filter(Boolean).length
    expect(words).toBeGreaterThanOrEqual(300)
    expect(words).toBeLessThanOrEqual(500)
    const ref = HELP_DOCS.markdownReference
    for (const topic of ['Headings', 'Lists', 'To-dos', 'Quotes', 'Toggles', 'Links', 'front matter']) expect(ref).toContain(topic)
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
})
