// M8 Task 9: the presentation view: title slide, settings, keys, open shortcut.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ObjectDetail } from '@/api/types'
import { objectDetail, objectSummary } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { usePeek, useTabs } from '@/nav/tabs'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { PRESENTATION_TEXT, Presentation } from './Presentation'
import { LAST_SLIDE_KEY, usePresentation } from './usePresentation'

const mocked = vi.mocked(api)
const PATH = 'Pages/Deck.md'

function deck(): ObjectDetail {
  return objectDetail({
    summary: objectSummary({
      path: PATH,
      type: 'page',
      title: 'Quarterly deck',
      description: 'Where we are',
      coverImage: 'Attachments/cover.png',
    }),
    frontmatter: { type: 'page', title: 'Quarterly deck', owner: 'Ada' },
    body: 'Opening words.\n\n# Results\n\nUp and to the right.\n\n---\n\nThanks.\n',
    version: 'v1',
  })
}

function setPrefs(p: Partial<typeof settingsDefaults.presentation>) {
  useSettings.setState({
    settings: { ...settingsDefaults, presentation: { ...settingsDefaults.presentation, ...p } },
    revision: 'r0',
    loaded: true,
  })
}

const key = (k: string, init: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }))
  })

const slideNumber = () => screen.getByLabelText(PRESENTATION_TEXT.slideNumber).textContent

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  usePresentation.getState().stop()
  setPrefs({})
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  mocked.object.mockResolvedValue(deck())
})

describe('Presentation', () => {
  test('test title slide follows settings', async () => {
    setPrefs({ footerLeft: 'Acme', footerRight: 'Confidential' })
    const { unmount } = render(<Presentation />)
    act(() => usePresentation.getState().start(PATH))
    expect(await screen.findByRole('heading', { name: 'Quarterly deck' })).toBeTruthy()
    expect(screen.getByText('Where we are')).toBeTruthy()
    expect(document.querySelector('[data-slide-cover]')).not.toBeNull()
    expect(document.querySelector('[data-slide-properties]')!.innerHTML).toContain('Ada')
    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(screen.getByText('Acme')).toBeTruthy()
    expect(screen.getByText('Confidential')).toBeTruthy()
    await waitFor(() => expect(slideNumber()).toBe('1 / 4'))
    // The header title shows on content slides only.
    expect(document.querySelector('[data-presentation-title]')!.textContent).toBe('')
    fireEvent.click(screen.getByRole('button', { name: PRESENTATION_TEXT.next }))
    expect(document.querySelector('[data-presentation-title]')!.textContent).toBe('Quarterly deck')
    unmount()

    usePresentation.getState().stop()
    localStorage.clear()
    setPrefs({ hideCoverImage: true, hideProgressIndicator: true, hideTitle: true })
    render(<Presentation />)
    act(() => usePresentation.getState().start(PATH))
    expect(await screen.findByRole('heading', { name: 'Quarterly deck' })).toBeTruthy()
    expect(document.querySelector('[data-slide-cover]')).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: PRESENTATION_TEXT.next }))
    expect(document.querySelector('[data-presentation-title]')!.textContent).toBe('')
    // Reading only: nothing is saved while presenting.
    expect(mocked.saveBody).not.toHaveBeenCalled()
  })

  test('test arrow keys and escape navigate and exit', async () => {
    render(<Presentation />)
    act(() => usePresentation.getState().start(PATH))
    await screen.findByRole('heading', { name: 'Quarterly deck' })
    await waitFor(() => expect(slideNumber()).toBe('1 / 4'))
    key('ArrowLeft')
    expect(slideNumber()).toBe('1 / 4')
    key('ArrowRight')
    expect(slideNumber()).toBe('2 / 4')
    expect(await screen.findByText('Opening words.')).toBeTruthy()
    key('ArrowRight')
    expect(await screen.findByText('Results')).toBeTruthy()
    key('ArrowRight')
    expect(await screen.findByText('Thanks.')).toBeTruthy()
    key('ArrowRight')
    expect(slideNumber()).toBe('4 / 4')
    key('ArrowLeft')
    expect(slideNumber()).toBe('3 / 4')
    expect(JSON.parse(localStorage.getItem(LAST_SLIDE_KEY)!)).toEqual({ path: PATH, slide: 2 })
    key('Escape')
    expect(usePresentation.getState().path).toBeNull()
    expect(screen.queryByRole('dialog', { name: PRESENTATION_TEXT.label })).toBeNull()
    // Not presenting: the arrows do nothing here.
    key('ArrowRight')
    expect(usePresentation.getState().slide).toBe(0)
  })

  test('Mod-Alt-p presents the open object; the exit button leaves', async () => {
    render(<Presentation />)
    key('p', { ctrlKey: true, altKey: true })
    expect(usePresentation.getState().path).toBeNull() // no object open
    useTabs.getState().open({ kind: 'object', path: PATH })
    key('p', { ctrlKey: true, altKey: true })
    expect(usePresentation.getState().path).toBe(PATH)
    await screen.findByRole('heading', { name: 'Quarterly deck' })
    fireEvent.click(screen.getByRole('button', { name: PRESENTATION_TEXT.exit }))
    expect(usePresentation.getState().path).toBeNull()
  })
})
