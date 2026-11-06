import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { objectSummary } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

vi.mock('./markdown', async (orig) => {
  const real = await orig<typeof import('./markdown')>()
  return { ...real, renderChatMarkdown: vi.fn(real.renderChatMarkdown) }
})

import { api } from '@/api/client'
import { loadGrammar } from '@/editor/code/highlight'
import { resetLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { ChatMarkdown, STREAM_RENDER_MS } from './ChatMarkdown'
import { renderChatMarkdown } from './markdown'

const mocked = vi.mocked(api)
const spy = vi.mocked(renderChatMarkdown)

const ALPHA = objectSummary({ path: 'Servers/Alpha.md', type: 'page', title: 'Alpha' })

beforeEach(() => {
  resetLinkIndex()
  spy.mockClear()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [] })
  mocked.objects.mockResolvedValue([ALPHA])
  mocked.resolve.mockImplementation(async (link: string) => (link === 'Alpha' || link === 'Servers/Alpha' ? ALPHA.path : null))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  usePeek.getState().close()
})

describe('ChatMarkdown (M16)', () => {
  test('test renders and presents object links', async () => {
    const { container } = render(<ChatMarkdown source={'See [[Alpha]] and [the server](Servers/Alpha.md).'} />)
    expect(container.querySelector('.chat-md')).not.toBeNull()
    const chips = [...container.querySelectorAll<HTMLElement>('[data-wikilink]')]
    expect(chips).toHaveLength(2)
    for (const chip of chips) await waitFor(() => expect(chip.getAttribute('data-resolved-path')).toBe(ALPHA.path))
    fireEvent.click(chips[0])
    expect(usePeek.getState().path).toBe(ALPHA.path)
    const open = vi.spyOn(useTabs.getState(), 'open')
    fireEvent.click(chips[1], { ctrlKey: true })
    expect(open).toHaveBeenCalledWith({ kind: 'object', path: ALPHA.path }, { newTab: true, via: 'link' })
    open.mockRestore()
  })

  test('test streaming re-renders at most every STREAM_RENDER_MS', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(<ChatMarkdown source="a" streaming />)
    let source = 'a'
    for (let i = 0; i < 20; i++) {
      source += ` w${i}`
      rerender(<ChatMarkdown source={source} streaming />)
      act(() => {
        vi.advanceTimersByTime(4)
      })
    }
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2)
    act(() => {
      vi.advanceTimersByTime(STREAM_RENDER_MS)
    })
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2)
    expect(container.textContent?.trim()).toBe(source)
    // Done streaming: the final text shows at once.
    rerender(<ChatMarkdown source={source + ' **end**'} />)
    expect(container.querySelector('strong')).toHaveTextContent('end')
  })

  test("test a fence's grammar loading re-renders", async () => {
    const { container } = render(<ChatMarkdown source={'```yaml\nkey: value\n```'} />)
    expect(container.querySelector('pre.chat-code')).not.toBeNull()
    await loadGrammar('yaml')
    await waitFor(() => expect(container.querySelector('pre.chat-code span[class^="hljs-"]')).not.toBeNull())
  })
})
