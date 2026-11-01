// M6 Task 13: whiteboards wired into the app (page and peek routing, "+ New").
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { WhiteboardPageProps } from './WhiteboardPage'
import { objectSummary, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

const pageProps: WhiteboardPageProps[] = []
vi.mock('./WhiteboardPage', () => ({
  WhiteboardPage: (p: WhiteboardPageProps) => {
    pageProps.push(p)
    return <div data-testid="whiteboard-page" data-mode={p.mode} data-path={p.path} />
  },
}))
vi.mock('@/object/ObjectView', () => ({
  ObjectView: (p: { path: string; mode: string }) => <div data-testid="object-view" data-mode={p.mode} data-path={p.path} />,
}))
vi.mock('@/api/whiteboardClient', async (orig) => {
  const real = await orig<typeof import('@/api/whiteboardClient')>()
  return { ...real, whiteboardApi: { ...real.whiteboardApi, createWhiteboard: vi.fn() } }
})

import { api } from '@/api/client'
import { whiteboardApi } from '@/api/whiteboardClient'
import { NewObjectMenu } from '@/create/NewObjectMenu'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { currentTarget, usePeek, useTabs } from '@/nav/tabs'
import { ObjectPage } from '@/object/ObjectPage'
import { ObjectPeek } from '@/object/ObjectPeek'
import { inkPlugin } from './ink'

const mocked = vi.mocked(api)
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true })
const WHITEBOARD = typeDef({
  id: 'whiteboard',
  name: 'Whiteboard',
  pluralName: 'Whiteboards',
  basic: true,
  icon: { type: 'iconify', val: 'ph-presentation' },
})
const BOARD = 'Whiteboards/Network map.md'
const NOTE = 'Pages/Note.md'

beforeEach(() => {
  pageProps.length = 0
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  vi.mocked(whiteboardApi.createWhiteboard).mockReset()
  mocked.objects.mockResolvedValue([])
  useLinkIndex.setState({
    types: [PAGE, WHITEBOARD],
    objects: [
      objectSummary({ path: BOARD, type: 'whiteboard', title: 'Network map' }),
      objectSummary({ path: NOTE, type: 'page', title: 'Note' }),
    ],
    loaded: true,
  })
})

describe('whiteboard integration', () => {
  test('test whiteboard object opens WhiteboardPage in page and peek with the ink plugin', async () => {
    const { unmount } = render(<ObjectPage path={BOARD} />)
    expect(await screen.findByTestId('whiteboard-page')).toHaveAttribute('data-mode', 'page')
    expect(pageProps.at(-1)?.ink).toBe(inkPlugin)
    unmount()

    render(<ObjectPage path={NOTE} />)
    expect(screen.getByTestId('object-view')).toHaveAttribute('data-path', NOTE)
    expect(screen.queryByTestId('whiteboard-page')).toBeNull()

    render(<ObjectPeek />)
    act(() => usePeek.getState().peek(BOARD))
    await waitFor(() => expect(pageProps.at(-1)?.mode).toBe('peek'))
    expect(await screen.findByTestId('whiteboard-page')).toHaveAttribute('data-mode', 'peek')
    const last = pageProps.at(-1)
    expect(last?.ink).toBe(inkPlugin)
    expect(last?.footer).toBeTruthy()
    act(() => last?.onExpand?.())
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: BOARD })
    expect(usePeek.getState().path).toBeNull()
  })

  test('test New menu creates a whiteboard before its type exists', async () => {
    useLinkIndex.setState({ types: [PAGE], objects: [], loaded: true })
    vi.mocked(whiteboardApi.createWhiteboard).mockResolvedValue({
      path: 'Whiteboards/Plan.md',
      version: 'v1',
      typeIds: ['whiteboard'],
    })
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<NewObjectMenu open onOpenChange={onOpenChange} />)
    await user.click(screen.getByRole('option', { name: 'Whiteboard' }))
    const search = screen.getByRole('textbox', { name: 'Search or Create' })
    await user.type(search, 'Plan')
    await user.click(screen.getByRole('option', { name: "New 'Plan'" }))
    await waitFor(() => expect(whiteboardApi.createWhiteboard).toHaveBeenCalledWith('Plan'))
    expect(mocked.createObject).not.toHaveBeenCalled()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Whiteboards/Plan.md' })
  })

  test('test New menu lists the stored Whiteboard type once', async () => {
    const user = userEvent.setup()
    vi.mocked(whiteboardApi.createWhiteboard).mockResolvedValue({
      path: 'Whiteboards/Untitled.md',
      version: 'v1',
      typeIds: [],
    })
    render(<NewObjectMenu open onOpenChange={() => undefined} />)
    expect(screen.getAllByRole('option', { name: 'Whiteboard' })).toHaveLength(1)
    await user.click(screen.getByRole('option', { name: 'Whiteboard' }))
    await user.click(screen.getByRole('option', { name: 'New Untitled' }))
    await waitFor(() => expect(whiteboardApi.createWhiteboard).toHaveBeenCalledWith(undefined))
  })
})
