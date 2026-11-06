// M20: a remote agent's file artifact as a chip.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { RemoteAttachment } from '@/api/types'
import { AttachmentChip } from './AttachmentChip'
import { REMOTE_CHAT_TEXT as R } from './aiText'

const mocked = vi.mocked(api)

const file = (partial: Partial<RemoteAttachment> = {}): RemoteAttachment => ({
  name: 'plan.md',
  mediaType: 'text/markdown',
  size: 12 * 1024,
  kind: 'file',
  file: 'chat1/plan.md',
  url: null,
  ...partial,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AttachmentChip', () => {
  test('test a file chip shows its name and size; Show in folder reveals it', async () => {
    const user = userEvent.setup()
    render(<AttachmentChip agentId="remote1" attachment={file()} />)
    expect(screen.getByText('plan.md')).toBeInTheDocument()
    expect(screen.getByText('12 KB')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: R.showInFolder }))
    await waitFor(() => expect(mocked.revealAgentFile).toHaveBeenCalledWith('remote1', 'chat1/plan.md'))
  })

  test('test an http url chip is a link with the link rules', () => {
    render(<AttachmentChip agentId="remote1" attachment={file({ kind: 'url', file: null, url: 'https://example.org/x.pdf', name: 'x.pdf', size: null })} />)
    const link = screen.getByRole('link', { name: 'x.pdf' })
    expect(link).toHaveAttribute('href', 'https://example.org/x.pdf')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.queryByRole('button', { name: R.showInFolder })).toBeNull()
  })

  test("test a url that isn't http is not a link", () => {
    const { container } = render(
      <AttachmentChip agentId="remote1" attachment={file({ kind: 'url', file: null, url: 'javascript:alert(1)', name: 'evil', size: null })} />,
    )
    expect(screen.getByText('evil')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
  })

  test('test sizes', () => {
    const shown = (size: number | null) => {
      const { container, unmount } = render(<AttachmentChip agentId="remote1" attachment={file({ size })} />)
      const text = container.textContent ?? ''
      unmount()
      return text.replace('plan.md', '')
    }
    expect(shown(null)).toBe('')
    expect(shown(500)).toBe('500 B')
    expect(shown(12 * 1024)).toBe('12 KB')
    expect(shown(1500)).toBe('1 KB')
    expect(shown(3 * 1024 * 1024 + 300 * 1024)).toBe('3.3 MB')
  })
})
