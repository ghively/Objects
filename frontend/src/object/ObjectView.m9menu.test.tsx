import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpaceInfo, TypeDef } from '@/api/types'
import { objectDetail, objectSummary, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/find/FindBar', () => ({ FindBar: () => null }))
vi.mock('@/references/ReferencesSection', () => ({ ReferencesSection: () => null }))

import { api } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { EXPORT_TEXT } from './ExportDialog'
import { ObjectView } from './ObjectView'

const mocked = vi.mocked(api)
const PAGE: TypeDef = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', revision: 'r1' })
const DAILY: TypeDef = typeDef({ id: 'dailynote', name: 'DailyNote', pluralName: 'DailyNotes', basic: true })
const BOARD: TypeDef = typeDef({ id: 'whiteboard', name: 'Whiteboard', pluralName: 'Whiteboards', basic: true })
const PATH = 'Pages/Notes.md'

function setup(type: TypeDef = PAGE, extra: Partial<Parameters<typeof objectSummary>[0]> = {}) {
  const detail = objectDetail({
    summary: objectSummary({
      path: PATH,
      type: type.id,
      title: 'Notes',
      createdAt: '2026-01-02T10:00:00Z',
      lastUpdated: '2026-01-03T11:00:00Z',
      ...extra,
    }),
    frontmatter: { type: type.name, title: 'Notes' },
    body: '# Head\n\nOne well-known sentence. Two!\n',
    version: 'v1',
  })
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE, DAILY, BOARD] } satisfies SpaceInfo)
  mocked.objects.mockResolvedValue([detail.summary])
  mocked.object.mockResolvedValue(detail)
}

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.resolve.mockResolvedValue(null)
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.exportObjectUrl.mockImplementation(
    (path: string, opts: { media: boolean }) => `/api/object/export?path=${encodeURIComponent(path)}&media=${opts.media ? 1 : 0}`,
  )
  setup()
})

afterEach(() => {
  document.querySelectorAll('[data-editor-toasts]').forEach((n) => n.remove())
  vi.restoreAllMocks()
})

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  render(<ObjectView path={PATH} mode="page" />)
  await screen.findByText('Head')
  await user.click(screen.getByRole('button', { name: 'More' }))
  return screen.findByRole('menu')
}

function names(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole('menuitem')
    .map((i) => i.textContent ?? '')
}

describe('ObjectView … menu (M9)', () => {
  test('test menu order export, text stats, duplicate', async () => {
    const user = userEvent.setup()
    const menu = await openMenu(user)
    const n = names(menu)
    const at = (s: string) => n.findIndex((x) => x === s || x.startsWith(s + 'Ctrl'))
    expect(at('Text Stats')).toBe(at('Version History') + 1)
    expect(at('Export')).toBe(at('Present') + 1)
    // Capacities' sections: present, export … then version history, text stats (Gene, 2026-10-29).
    expect(at('Export')).toBeLessThan(at('Version History'))
    expect(at('Duplicate')).toBe(at('Merge into object') - 1)
  })

  test('rows show their shortcut: Find, Present and Delete', async () => {
    const user = userEvent.setup()
    const menu = await openMenu(user)
    const row = (label: string) => within(menu).getAllByRole('menuitem').find((i) => i.textContent?.startsWith(label))!
    expect(row('Find in page')).toHaveTextContent('Ctrl F')
    expect(row('Present')).toHaveTextContent('Ctrl Alt P')
    expect(row('Delete')).toHaveTextContent('Ctrl ⌫')
  })

  test('test duplicate opens the copy', async () => {
    const user = userEvent.setup()
    mocked.duplicateObject.mockResolvedValue({
      path: 'Pages/Notes (Copy).md',
      version: 'v1',
      summary: objectSummary({ path: 'Pages/Notes (Copy).md', title: 'Notes (Copy)' }),
    })
    const menu = await openMenu(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Duplicate' }))
    await waitFor(() => expect(mocked.duplicateObject).toHaveBeenCalledWith(PATH))
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Pages/Notes (Copy).md' }))
  })

  test('test duplicate hidden for daily note, template, whiteboard', async () => {
    const user = userEvent.setup()
    for (const [type, extra] of [
      [DAILY, {}],
      [PAGE, { template: 'Weekly' }],
      [BOARD, {}],
    ] as const) {
      resetLinkIndex()
      setup(type, extra)
      const r = render(<ObjectView path={PATH} mode="page" />)
      await screen.findByText('Head')
      await user.click(screen.getByRole('button', { name: 'More' }))
      const menu = await screen.findByRole('menu')
      expect(names(menu)).not.toContain('Duplicate')
      await user.keyboard('{Escape}')
      r.unmount()
    }
  })

  test('test text stats submenu rows', async () => {
    const user = userEvent.setup()
    const menu = await openMenu(user)
    // Submenus are driven with plain clicks: jsdom has no layout, so a pointer move closes them.
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Text Stats' }))
    const sub = await screen.findByTestId('text-stats-menu')
    expect(within(sub).getByText('Text stats')).toBeInTheDocument()
    const rows = [...sub.querySelectorAll<HTMLElement>('[data-stat]')]
    expect(rows.map((r) => r.dataset.stat)).toEqual(['words', 'sentences', 'paragraphs', 'characters', 'createdAt', 'lastUpdated'])
    // "Head" + "One well-known sentence. Two!": 1 + 4 words, 3 sentences, 2 paragraphs.
    expect(rows.slice(0, 3).map((r) => r.textContent)).toEqual(['5 words', '3 sentences', '2 paragraphs'])
  })

  test('test export downloads same-origin url with and without media', async () => {
    const user = userEvent.setup()
    const clicked: { href: string; download: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.getAttribute('href') ?? '', download: this.download })
    })
    let menu = await openMenu(user)
    await user.click(within(menu).getByRole('menuitem', { name: /^Export/ }))
    let dialog = await screen.findByRole('dialog', { name: EXPORT_TEXT.heading })
    expect(within(dialog).getByText('Format')).toBeInTheDocument()
    expect(within(dialog).getByText('Markdown')).toBeInTheDocument()
    expect(within(dialog).getByText('Options')).toBeInTheDocument()
    expect(within(dialog).getByText('Adds files and images to the zip.')).toBeInTheDocument()
    const media = within(dialog).getByRole('switch', { name: 'Include media' })
    expect(media).toHaveAttribute('aria-checked', 'false')
    await user.click(within(dialog).getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(clicked).toHaveLength(1))
    expect(mocked.exportObjectUrl).toHaveBeenLastCalledWith(PATH, { media: false })
    expect(clicked[0]).toEqual({ href: `/api/object/export?path=${encodeURIComponent(PATH)}&media=0`, download: 'Notes.md' })
    expect(clicked[0].href).not.toMatch(/^https?:/)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.querySelector('[data-editor-toasts]')?.textContent).toContain('The export is ready and will be downloaded.')

    await user.click(screen.getByRole('button', { name: 'More' }))
    menu = await screen.findByRole('menu')
    await user.click(within(menu).getByRole('menuitem', { name: /^Export/ }))
    dialog = await screen.findByRole('dialog', { name: EXPORT_TEXT.heading })
    await user.click(within(dialog).getByRole('switch', { name: 'Include media' }))
    await user.click(within(dialog).getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(clicked).toHaveLength(2))
    expect(clicked[1]).toEqual({ href: `/api/object/export?path=${encodeURIComponent(PATH)}&media=1`, download: 'Notes.zip' })
  })
})
