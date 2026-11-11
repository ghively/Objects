// M32, item 1: the note's toolbar (page and peek) shows the save mark for its own path, to the
// left of the toolbar's buttons so it never moves them.
import { act, render, screen } from '@testing-library/react'
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
    // The same right-aligned group: the mark first, so its width grows away from the buttons.
    const group = mark.parentElement as HTMLElement
    expect(group.contains(more)).toBe(true)
    expect(group.firstElementChild).toBe(mark)
    expect(mark.compareDocumentPosition(screen.getByTestId('find-bar')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
