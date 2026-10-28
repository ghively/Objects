import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { MarkdownPreview } from './MarkdownPreview'

describe('MarkdownPreview', () => {
  test('renders the text the way a page body renders', async () => {
    render(<MarkdownPreview text={'## Plan\n\n- [ ] Patch the hosts\n- [x] Reboot\n\nSee [[Runbook]] and **bold**.\n'} />)
    const preview = screen.getByTestId('markdown-preview')
    await waitFor(() => expect(preview.querySelector('h2')).toHaveTextContent('Plan'))
    expect(preview.querySelectorAll('ul[data-type="taskList"] li')).toHaveLength(2)
    expect(preview.querySelector('strong')).toHaveTextContent('bold')
    expect(preview.textContent).toContain('Runbook')
  })

  test('markdown preview shows raw html as text', async () => {
    const html = '<img src="x" onerror="window.__md = 1"><iframe src="https://example.com"></iframe>'
    render(<MarkdownPreview text={`Before\n\n${html}\n\nAfter\n`} />)
    const preview = screen.getByTestId('markdown-preview')
    await waitFor(() => expect(preview.textContent).toContain('After'))
    expect(preview.querySelector('img')).toBeNull()
    expect(preview.querySelector('iframe')).toBeNull()
    expect(preview.textContent).toContain(html)
    expect((window as unknown as { __md?: number }).__md).toBeUndefined()
  })

  test('is read-only and follows text changes', async () => {
    const { rerender } = render(<MarkdownPreview text="First" />)
    const preview = screen.getByTestId('markdown-preview')
    await waitFor(() => expect(preview.textContent).toContain('First'))
    expect(preview.querySelector('.ProseMirror')).toHaveAttribute('contenteditable', 'false')
    rerender(<MarkdownPreview text="Second" />)
    await waitFor(() => expect(preview.textContent).toContain('Second'))
    expect(preview.textContent).not.toContain('First')
  })
})
