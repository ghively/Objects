// M9 Task 5: a board save also stamps the board .md's lastUpdated; the Notes adopt the
// `mdVersion` it answers, so their next body save doesn't meet a 409.
import '@/whiteboard/test/flowEnv'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Editor as TiptapEditor } from '@tiptap/core'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { WhiteboardSaveResult } from '@/api/whiteboardTypes'
import { objectDetail, objectSummary } from '@/test/mockApi'
import { OBJECT_DRAG_MIME } from './dnd'
import type { WhiteboardHost } from './host'
import { board } from './test/boards'
import { mockWhiteboardApi } from './test/mockWhiteboardApi'
import { WhiteboardPage } from './WhiteboardPage'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'

const PATH = 'Whiteboards/Board.md'

function fakeHost(): WhiteboardHost {
  return {
    openObject: vi.fn(),
    linkFor: vi.fn((p: string) => `[[${p.split('/').pop()!.replace(/\.md$/, '')}]]`),
    resolve: vi.fn(async () => null),
    rows: vi.fn(async () => []),
    requestDelete: vi.fn(),
    createObject: vi.fn(async () => 'Pages/New.md'),
    objects: vi.fn(async () => []),
  }
}

function drop(link: string) {
  const ev = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperties(ev, {
    clientX: { value: 300 },
    clientY: { value: 300 },
    dataTransfer: { value: { getData: (f: string) => (f === OBJECT_DRAG_MIME ? link : ''), types: [OBJECT_DRAG_MIME] } },
  })
  act(() => {
    screen.getByTestId('whiteboard-canvas').dispatchEvent(ev)
  })
}

function pmEditor(): TiptapEditor {
  const dom = screen.getByTestId('whiteboard-notes-editor').querySelector('.ProseMirror') as (HTMLElement & { editor?: TiptapEditor }) | null
  if (!dom?.editor) throw new Error('editor not mounted')
  return dom.editor
}

beforeEach(() => {
  vi.mocked(api.saveBody).mockClear()
  vi.mocked(api.object).mockImplementation(async (path: string) =>
    objectDetail({ summary: objectSummary({ path, title: 'Board' }), body: 'First note line.\n', version: 'v1' }),
  )
})

describe('whiteboard lastUpdated bump', () => {
  test('test notes save after a board save uses the new md version', async () => {
    const client = mockWhiteboardApi(board(), 'rev-1')
    client.saveBoard.mockImplementation(async () => ({ revision: 'rev-2', mdVersion: 'v2' }) as WhiteboardSaveResult & { revision: string })
    render(
      <div style={{ width: 1280, height: 800 }}>
        <WhiteboardPage path={PATH} mode="page" host={fakeHost()} client={client} />
      </div>,
    )
    await waitFor(() => expect(screen.getByTestId('whiteboard-canvas')).toBeInTheDocument())
    const notes = await screen.findByTestId('whiteboard-notes')
    const toggle = within(notes).getByRole('button', { name: 'Notes' })
    fireEvent.click(toggle)
    await waitFor(() => expect(screen.getByTestId('whiteboard-notes-editor')).toHaveTextContent('First note line.'))

    // A board edit saves the board; the server stamped the .md and answered its new version.
    drop('Pages/Router A.md')
    await waitFor(() => expect(client.saveBoard).toHaveBeenCalledTimes(1))
    await act(async () => {
      await Promise.resolve()
    })

    const editor = pmEditor()
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' More.')
    })
    fireEvent.click(toggle) // collapsing saves at once
    await waitFor(() => expect(api.saveBody).toHaveBeenCalledTimes(1))
    expect(api.saveBody).toHaveBeenCalledWith(PATH, 'First note line. More.\n', 'v2')
  })

  test('test a save without mdVersion keeps the notes version', async () => {
    const client = mockWhiteboardApi(board(), 'rev-1')
    render(
      <div style={{ width: 1280, height: 800 }}>
        <WhiteboardPage path={PATH} mode="page" host={fakeHost()} client={client} />
      </div>,
    )
    await waitFor(() => expect(screen.getByTestId('whiteboard-canvas')).toBeInTheDocument())
    const toggle = within(await screen.findByTestId('whiteboard-notes')).getByRole('button', { name: 'Notes' })
    fireEvent.click(toggle)
    await waitFor(() => expect(screen.getByTestId('whiteboard-notes-editor')).toHaveTextContent('First note line.'))
    drop('Pages/Router A.md')
    await waitFor(() => expect(client.saveBoard).toHaveBeenCalledTimes(1))
    const editor = pmEditor()
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' More.')
    })
    fireEvent.click(toggle)
    await waitFor(() => expect(api.saveBody).toHaveBeenCalledTimes(1))
    expect(api.saveBody).toHaveBeenCalledWith(PATH, 'First note line. More.\n', 'v1')
  })
})
