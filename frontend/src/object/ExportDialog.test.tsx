import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi({
    exportProperties: vi.fn(async () => [
      { key: 'bio', name: 'Bio', empty: false },
      { key: 'manager', name: 'Manager', empty: true },
      { key: 'tags', name: 'Tags', empty: false },
    ]),
  }),
}))

import { api } from '@/api/client'
import { EXPORT_TEXT, ExportDialog, exportFileName } from './ExportDialog'

const mocked = vi.mocked(api)
const real = await vi.importActual<typeof import('@/api/client')>('@/api/client')
const PATH = 'People/Ada Lovelace.md'

let clicked: { href: string; download: string }[]

beforeEach(() => {
  clicked = []
  mocked.exportObjectUrl.mockImplementation(real.api.exportObjectUrl)
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.getAttribute('href') ?? '', download: this.download })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  document.querySelectorAll('iframe, [data-editor-toasts]').forEach((n) => n.remove())
})

function open() {
  const onOpenChange = vi.fn()
  render(<ExportDialog open onOpenChange={onOpenChange} path={PATH} />)
  return { dialog: screen.getByRole('dialog', { name: EXPORT_TEXT.heading }), onOpenChange }
}

const params = (href: string) => Object.fromEntries(new URL(href, 'http://x').searchParams)

describe('Export dialog (polish item 23)', () => {
  test('four format tiles, Markdown selected, its four options', () => {
    const { dialog } = open()
    const tiles = within(within(dialog).getByRole('radiogroup', { name: 'Format' })).getAllByRole('radio')
    expect(tiles.map((t) => t.textContent)).toEqual(['PDF', 'Markdown', 'Microsoft Word', 'Latex'])
    expect(within(dialog).getByRole('radio', { name: 'Markdown' })).toHaveAttribute('aria-checked', 'true')
    for (const name of [
      'Include subpages (as a folder)',
      'Include media',
      'Add the title as a top heading',
      'Links as wikilinks',
    ]) {
      expect(within(dialog).getByRole('switch', { name })).toBeInTheDocument()
    }
    expect(within(dialog).getByRole('switch', { name: 'Links as wikilinks' })).toHaveAttribute('aria-checked', 'true')
    expect(within(dialog).getByText('Export links as [[title]] instead of [title](path).')).toBeInTheDocument()
  })

  test('plain Markdown keeps the short url; options travel as flags and zip the folder', async () => {
    const user = userEvent.setup()
    let { dialog } = open()
    await user.click(within(dialog).getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(clicked).toHaveLength(1))
    expect(mocked.exportObjectUrl).toHaveBeenLastCalledWith(PATH, { media: false })
    expect(clicked[0].download).toBe('Ada Lovelace.md')

    cleanup()
    ;({ dialog } = open())
    await user.click(within(dialog).getByRole('switch', { name: 'Include subpages (as a folder)' }))
    await user.click(within(dialog).getByRole('switch', { name: 'Add the title as a top heading' }))
    await user.click(within(dialog).getByRole('switch', { name: 'Links as wikilinks' }))
    await user.click(within(dialog).getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(clicked).toHaveLength(2))
    expect(params(clicked[1].href)).toEqual({ path: PATH, media: '0', subpages: '1', titleH1: '1', wikilinks: '0' })
    expect(clicked[1].download).toBe('Ada Lovelace.zip')
  })

  test('PDF: three styles all available, options, paper and properties; printed, not downloaded', async () => {
    const user = userEvent.setup()
    const { dialog, onOpenChange } = open()
    await user.click(within(dialog).getByRole('radio', { name: 'PDF' }))
    const styles = within(within(dialog).getByRole('radiogroup', { name: 'Style' })).getAllByRole('radio')
    expect(styles.map((s) => s.querySelector('span')?.textContent)).toEqual(['Notes', 'Essay', 'Academic'])
    for (const s of styles) expect(s).toBeEnabled()
    expect(styles[0]).toHaveAttribute('aria-checked', 'true')
    expect(within(dialog).queryByText(/\bPro\b|Experimental/)).toBeNull()
    await user.click(styles[2])

    expect(within(dialog).getByRole('switch', { name: 'Hide empty properties' })).toHaveAttribute('aria-checked', 'true')
    expect(within(dialog).getByRole('switch', { name: 'Include embedded content' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('switch', { name: 'Include outline' }))
    await user.click(within(dialog).getByRole('switch', { name: 'Show type labels' }))
    await user.click(within(dialog).getByRole('radio', { name: 'Letter' }))

    // Properties: the empty one is hidden while "Hide empty properties" is on.
    expect(await within(dialog).findByText('Bio')).toBeInTheDocument()
    expect(within(dialog).queryByText('Manager')).toBeNull()
    expect(within(dialog).getByText('Deselect properties to hide them from the export.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Bio' }))
    expect(within(dialog).getByRole('checkbox', { name: 'All properties' })).toHaveAttribute('aria-checked', 'false')

    await user.click(within(dialog).getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(clicked).toHaveLength(0)
    const frame = document.querySelector('iframe')!
    expect(frame).not.toBeNull()
    expect(frame.getAttribute('src')).toMatch(/^\/api\/object\/export\?/)
    expect(params(frame.getAttribute('src')!)).toEqual({
      path: PATH,
      media: '0',
      format: 'html',
      style: 'academic',
      paper: 'Letter',
      embedded: '1',
      outline: '1',
      hideEmpty: '1',
      typeLabels: '1',
      hide: 'bio',
    })
  })

  test.each([
    ['Microsoft Word', 'docx', 'Ada Lovelace.docx'],
    ['Latex', 'latex', 'Ada Lovelace.tex'],
  ])('%s downloads its file', async (tile, format, name) => {
    const user = userEvent.setup()
    const { dialog } = open()
    await user.click(within(dialog).getByRole('radio', { name: tile }))
    await within(dialog).findByText('Bio')
    expect(within(dialog).queryByRole('radiogroup', { name: 'Style' })).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(clicked).toHaveLength(1))
    expect(params(clicked[0].href)).toMatchObject({ format, hideEmpty: '1', typeLabels: '0' })
    expect(clicked[0].download).toBe(name)
  })

  test('file names per format', () => {
    expect(exportFileName('Pages/A b.md', false)).toBe('A b.md')
    expect(exportFileName('Pages/A b.md', true)).toBe('A b.zip')
    expect(exportFileName('Pages/A b.md', false, 'md', true)).toBe('A b.zip')
    expect(exportFileName('Pages/A b.md', false, 'docx')).toBe('A b.docx')
    expect(exportFileName('Pages/A b.md', false, 'latex')).toBe('A b.tex')
  })
})
