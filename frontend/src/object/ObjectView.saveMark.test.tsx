// M32, item 1: the note's toolbar (page and peek) shows the save mark for its own path, to the
// left of the toolbar's buttons so it never moves them, and it stays while the buttons fade for
// typing.
import type { Editor as TiptapEditor } from '@tiptap/core'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpaceInfo, TypeDef } from '@/api/types'
import { objectDetail, objectSummary, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/find/FindBar', () => ({ FindBar: () => <div data-testid="find-bar" /> }))
vi.mock('@/references/ReferencesSection', () => ({ ReferencesSection: () => null }))

import { api } from '@/api/client'
import { serializeBody } from '@/editor/document'
import { clearSaveState, setSaveState } from '@/editor/saveStateStore'
import { resetLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { ObjectView } from './ObjectView'

const mocked = vi.mocked(api)
const PAGE: TypeDef = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', revision: 'r1' })
const PATH = 'Pages/Notes.md'
const OTHER = 'Pages/Other.md'

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE] } satisfies SpaceInfo)
  mocked.resolve.mockResolvedValue(null)
  mocked.onChange.mockReturnValue(() => undefined)
  const detail = objectDetail({
    summary: objectSummary({ path: PATH, type: 'page', title: 'Notes' }),
    frontmatter: { type: 'Page', title: 'Notes' },
    body: 'Hello.\n',
    version: 'v1',
  })
  mocked.objects.mockResolvedValue([detail.summary])
  mocked.object.mockResolvedValue(detail)
})
afterEach(() => {
  act(() => {
    clearSaveState(PATH)
    clearSaveState(OTHER)
  })
})

describe.each(['page', 'peek'] as const)('the save mark in the %s toolbar', (mode) => {
  test('follows the save state of this note only', async () => {
    const { container } = render(<ObjectView path={PATH} mode={mode} />)
    await screen.findByText('Hello.')
    const mark = container.querySelector('[data-save-mark]') as HTMLElement
    expect(mark).toHaveTextContent('')
    act(() => setSaveState(OTHER, 'saving'))
    expect(mark).toHaveTextContent('')
    act(() => setSaveState(PATH, 'unsaved'))
    expect(mark).toHaveTextContent('Saving…')
    act(() => setSaveState(PATH, 'saved'))
    expect(mark).toHaveTextContent('Saved')
  })

  test('sits before the find bar and the buttons, which keep their place at the right', async () => {
    const { container } = render(<ObjectView path={PATH} mode={mode} />)
    await screen.findByText('Hello.')
    const mark = container.querySelector('[data-save-mark]') as HTMLElement
    const more = screen.getByRole('button', { name: 'More' })
    // Just before the right-aligned group (the find bar, the buttons), so its width grows away from them.
    const group = mark.nextElementSibling as HTMLElement
    expect(group.contains(more)).toBe(true)
    expect(group.contains(screen.getByTestId('find-bar'))).toBe(true)
    expect(group.nextElementSibling).toBeNull()
    expect(mark).toHaveClass('ml-auto')
  })

  test('is the toolbar\'s own part that stays while the rest fades for typing', async () => {
    const { container } = render(<ObjectView path={PATH} mode={mode} />)
    await screen.findByText('Hello.')
    const mark = container.querySelector('[data-save-mark]') as HTMLElement
    const toolbar = mark.parentElement as HTMLElement
    expect(toolbar).toHaveAttribute('data-typing-fade')
    expect(mark).toHaveAttribute('data-typing-stay')
    // The buttons are in parts that fade.
    const fading = [...toolbar.children].filter((el) => !el.hasAttribute('data-typing-stay'))
    expect(fading.some((el) => el.contains(screen.getByRole('button', { name: 'More' })))).toBe(true)
  })
})

// The two lanes joined: the real editor publishes its autosave state and the toolbar shows it.
// Nothing here sets the store by hand.
describe.each(['page', 'peek'] as const)('typing in the real editor moves the save mark (%s)', (mode) => {
  test('test typing shows "Saving…" until the save lands, then "Saved"', async () => {
    let land: (v: { version: string }) => void = () => undefined
    mocked.saveBody.mockImplementation(() => new Promise<{ version: string }>((resolve) => (land = resolve)))
    const { container } = render(<ObjectView path={PATH} mode={mode} />)
    await screen.findByText('Hello.')
    const editor = await waitFor(() => {
      const pm = container.querySelector('.ProseMirror') as (HTMLElement & { editor?: TiptapEditor }) | null
      if (!pm?.editor) throw new Error('editor not mounted')
      return pm.editor
    })
    const mark = container.querySelector('[data-save-mark]') as HTMLElement
    // A note nobody typed in says nothing.
    expect(mark).toHaveTextContent('')
    expect(mocked.saveBody).not.toHaveBeenCalled()

    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' More.')
    })
    const typed = serializeBody(editor)
    expect(typed).toBe('Hello. More.\n')
    // Unsaved at once (before the autosave's wait is over), and while the save is in flight.
    expect(mark).toHaveTextContent('Saving…')
    await waitFor(() => expect(mocked.saveBody).toHaveBeenCalledWith(PATH, typed, 'v1'), { timeout: 4000 })
    expect(mark).toHaveTextContent('Saving…')
    expect(mark).toHaveAttribute('data-save-mark', 'saving')

    // The save lands: "Saved".
    await act(async () => {
      land({ version: 'v2' })
    })
    await waitFor(() => expect(mark).toHaveTextContent('Saved'))
    expect(mark).toHaveAttribute('data-save-mark', 'saved')
    expect(mocked.saveBody).toHaveBeenCalledTimes(1)
  }, 15000)
})
