import { useRef } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { objectSummary } from '@/test/mockApi'
import { loadPageInspectorPinned, PageInspector, PAGE_INSPECTOR_TEXT, savePageInspectorPinned } from './PageInspector'

const SUMMARY = objectSummary({
  path: 'Pages/Notes.md',
  createdAt: '2026-01-02T10:00:00Z',
  lastUpdated: '2026-01-03T11:00:00Z',
})

function Harness({ html, markdown, dailyNote = false }: { html: string; markdown: string; dailyNote?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null)
  return (
    <>
      <div ref={ref} data-testid="body">
        <div className="ProseMirror" contentEditable suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <PageInspector
        bodyRef={ref}
        getMarkdown={() => markdown}
        summary={SUMMARY}
        dailyNote={dailyNote}
        pinned={false}
        onPin={() => undefined}
      />
    </>
  )
}

beforeEach(() => {
  localStorage.clear()
})

describe('PageInspector', () => {
  test('test outline lists headings and empty state string', async () => {
    const user = userEvent.setup()
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const { unmount } = render(
      <Harness
        html={'<h1>Intro</h1><p>Text</p><h2>Details</h2><div contenteditable="false"><h2>Embedded</h2></div>'}
        markdown={'# Intro\n\nText\n\n## Details\n'}
      />,
    )
    const inspector = screen.getByRole('complementary', { name: PAGE_INSPECTOR_TEXT.inspector })
    expect(within(inspector).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Outline', 'Stats'])
    const outline = within(inspector).getByTestId('inspector-outline')
    const items = within(outline).getAllByRole('button')
    // An embed's own headings are not this page's.
    expect(items.map((b) => b.textContent)).toEqual(['Intro', 'Details'])
    expect(items[1].dataset.level).toBe('2')
    await user.click(items[1])
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll.mock.contexts[0]).toBe(screen.getByRole('heading', { name: 'Details' }))
    unmount()

    render(<Harness html="<p>No headings</p>" markdown="No headings" />)
    expect(screen.getByText('No headings in this page')).toBeInTheDocument()
  })

  test('test outline follows edits', async () => {
    vi.useFakeTimers()
    try {
      render(<Harness html="<p>x</p>" markdown="x" />)
      expect(screen.getByText(PAGE_INSPECTOR_TEXT.emptyOutline)).toBeInTheDocument()
      const pm = screen.getByTestId('body').querySelector('.ProseMirror') as HTMLElement
      const h = document.createElement('h3')
      h.textContent = 'Added'
      await act(async () => {
        pm.appendChild(h)
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(screen.getByRole('button', { name: 'Added' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  test('test stats tab order and created hidden for daily notes', async () => {
    const user = userEvent.setup()
    const md = '# Title\n\nOne well-known sentence. Another one!\n\nMath $x+y$ left out.\n'
    const { unmount } = render(<Harness html="<h1>Title</h1>" markdown={md} />)
    await user.click(screen.getByRole('tab', { name: 'Stats' }))
    const stats = screen.getByTestId('inspector-stats')
    const rows = [...stats.querySelectorAll<HTMLElement>('[data-stat]')]
    expect(rows.map((r) => r.dataset.stat)).toEqual(['words', 'sentences', 'paragraphs', 'characters', 'createdAt', 'lastUpdated'])
    // "Title" + "One well-known sentence. Another one!" + "Math left out." -> 1 + 5 + 3 words.
    expect(rows[0].textContent).toBe('9 words')
    expect(rows[2].textContent).toBe('3 paragraphs')
    expect(rows[4].textContent).toContain('Created at')
    expect(rows[5].textContent).toContain('Last updated')
    unmount()

    render(<Harness html="" markdown="Hi." dailyNote />)
    await user.click(screen.getByRole('tab', { name: 'Stats' }))
    const daily = [...screen.getByTestId('inspector-stats').querySelectorAll<HTMLElement>('[data-stat]')]
    expect(daily.map((r) => r.dataset.stat)).toEqual(['words', 'sentences', 'paragraphs', 'characters', 'lastUpdated'])
    expect(daily[0].textContent).toBe('1 word')
  })

  test('test pin is kept per viewer', () => {
    expect(loadPageInspectorPinned()).toBe(false)
    savePageInspectorPinned(true)
    expect(loadPageInspectorPinned()).toBe(true)
    savePageInspectorPinned(false)
    expect(loadPageInspectorPinned()).toBe(false)
  })
})
