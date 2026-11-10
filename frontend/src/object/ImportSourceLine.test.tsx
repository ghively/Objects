// M25: the Source line on an imported object's page.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { IMPORT_TEXT as T } from '@/import/text'
import { ImportSourceLine, importSourceOf } from './ImportSourceLine'

const mocked = vi.mocked(api)

beforeEach(() => vi.clearAllMocks())

describe('ImportSourceLine', () => {
  test('test nothing shows for an object that was not imported', () => {
    const { container } = render(<ImportSourceLine source={undefined} />)
    expect(container).toBeEmptyDOMElement()
    expect(importSourceOf('text')).toBeNull()
    expect(importSourceOf({ system: 'x' })).toBeNull()
  })

  test('test a web url opens in a new window and a kept original opens and shows', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const user = userEvent.setup()
    render(
      <ImportSourceLine
        source={{
          system: 'sharepoint',
          id: '01ABC',
          url: 'https://sp.example/dns',
          version: '7.0',
          author: 'Ann',
          modified: '2026-10-30T08:00:00Z',
          original: 'Attachments/Originals/DNS.docx',
        }}
      />,
    )
    expect(screen.getByRole('group', { name: T.sourceHeading })).toHaveTextContent('Imported from SharePoint (Ann, modified 2026-10-30, version 7.0)')
    await user.click(screen.getByRole('button', { name: T.openOriginal }))
    expect(open).toHaveBeenCalledWith('https://sp.example/dns', '_blank', 'noopener,noreferrer')
    await user.click(screen.getByRole('button', { name: T.showFile }))
    expect(mocked.revealImportOriginal).toHaveBeenCalledWith('Attachments/Originals/DNS.docx')
    open.mockRestore()
  })

  test('test M31: a git source shows its commit, the uncommitted mark, and opens the web page at the commit', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const user = userEvent.setup()
    const sha = '0123456789abcdef0123456789abcdef01234567'
    const url = `https://github.com/acme/wiki/blob/${sha}/Hosts/APP01.md`
    render(
      <ImportSourceLine
        source={{ system: 'wiki', id: 'Hosts/APP01.md', url, version: sha, author: 'Ada Example', modified: '2026-10-01T09:30:00Z', uncommitted: true }}
      />,
    )
    expect(screen.getByRole('group', { name: T.sourceHeading })).toHaveTextContent(
      'Imported from the wiki (Ada Example, modified 2026-10-01, commit 0123456, has uncommitted changes)',
    )
    await user.click(screen.getByRole('button', { name: T.openOriginal }))
    expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer')
    open.mockRestore()
  })

  test('test without a web url Open original opens the kept file; a file: url alone has no buttons', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <ImportSourceLine source={{ system: 'files', id: 'a.docx', url: 'file:///x/a.docx', original: 'Attachments/Originals/a.docx' }} />,
    )
    await user.click(screen.getByRole('button', { name: T.openOriginal }))
    expect(mocked.openAttachment).toHaveBeenCalledWith('Attachments/Originals/a.docx')
    rerender(<ImportSourceLine source={{ system: 'obsidian', id: 'a.md', url: 'file:///x/a.md', version: 'sha256:ab' }} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('group', { name: T.sourceHeading })).toHaveTextContent('Imported from Obsidian')
    expect(screen.getByRole('group', { name: T.sourceHeading })).not.toHaveTextContent('sha256')
  })
})
