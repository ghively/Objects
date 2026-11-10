import '@/whiteboard/test/flowEnv'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { WhiteboardData, WhiteboardMediaBlock, WhiteboardNode } from '@/api/whiteboardTypes'
import { createMedia, createWeblink } from './actions'
import { Toolbox } from './chrome/Toolbox'
import { fromFlowChange, toFlow } from './flowMapping'
import type { WhiteboardHost } from './host'
import {
  DEFAULT_SETTINGS,
  MEDIA_DEFAULT_SIZE,
  WEBLINK_DEFAULT_SIZE,
  mediaKindOf,
  normalizeWeblinkUrl,
  resolveWhiteboardMediaTool,
  weblinkHost,
} from './model'
import { fakeHost as nodeHost, renderBoard } from './nodes/test/harness'
import { BoardStoreContext, createBoardStore, type BoardStore } from './store'
import { board, node } from './test/boards'
import { TOOLS_KEY, loadToolMemory, saveToolMemory } from './toolMemory'
import { WhiteboardCanvas } from './WhiteboardCanvas'
import { MEDIA_TEXT, bumpMediaToken, resetMediaToken } from '@/settings/mediaLoading'
import { settingsDefaults, useSettings } from '@/settings/useSettings'

const KEY = 'Whiteboards/Media.md'

function canvasHost(over: Partial<WhiteboardHost> = {}): WhiteboardHost {
  return {
    openObject: vi.fn(),
    linkFor: vi.fn((p: string) => `[[${p}]]`),
    resolve: vi.fn(async () => null),
    rows: vi.fn(async () => []),
    requestDelete: vi.fn(),
    createObject: vi.fn(async () => 'Pages/New.md'),
    objects: vi.fn(async () => []),
    uploadAttachment: vi.fn(async (f: File) => ({ path: `Attachments/${f.name}` })),
    fileUrl: vi.fn((p: string) => `/api/file?path=${encodeURIComponent(p)}`),
    openAttachment: vi.fn(async () => ({ ok: true })),
    ...over,
  }
}

function renderCanvas(opts: { store?: BoardStore; host?: WhiteboardHost; snap?: boolean } = {}) {
  const store = opts.store ?? createBoardStore({ doc: { board: board(), strokes: [] } })
  const host = opts.host ?? canvasHost()
  render(
    <BoardStoreContext.Provider value={store}>
      <div style={{ width: 1280, height: 800 }}>
        <WhiteboardCanvas
          boardKey={KEY}
          settings={{ ...DEFAULT_SETTINGS, isSnappingToGrid: opts.snap ?? true }}
          host={host}
        />
      </div>
    </BoardStoreContext.Provider>,
  )
  return { store, host, wrapper: screen.getByTestId('whiteboard-canvas') }
}

function click(el: Element, x: number, y: number) {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, button: 0, pointerId: 1 })
  fireEvent.pointerUp(el, { clientX: x, clientY: y, button: 0, pointerId: 1 })
}

/** The hidden file input the media tool opened (M7's `openFilePicker`). */
function chooseFiles(kind: string, files: File[]) {
  const input = document.querySelector<HTMLInputElement>(`input[data-media-picker="${kind}"]`)
  expect(input, `a ${kind} picker`).not.toBeNull()
  Object.defineProperty(input!, 'files', { value: files, configurable: true })
  fireEvent.change(input!)
}

const png = (name = 'diagram.png') => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' })

let fetchSpy: ReturnType<typeof vi.fn>
let clickSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  localStorage.clear()
  fetchSpy = vi.fn(async () => new Response('{}'))
  vi.stubGlobal('fetch', fetchSpy)
  // jsdom can't open a file dialog: the picker's click is a no-op.
  clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  document.querySelectorAll('input[data-media-picker]').forEach((el) => el.remove())
  clickSpy.mockRestore()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const mediaNodes = (b: WhiteboardData) =>
  Object.values(b.nodes).filter((n) => n.blockId && b.blocks[n.blockId]?.type === 'media')

describe('whiteboard media and web-link nodes', () => {
  test('test media tool uploads and places a node', async () => {
    const { store, host } = renderCanvas()
    await act(async () => {})
    act(() => store.getState().actions.setTool('image'))
    click(screen.getByTestId('whiteboard-placement'), 301, 299)
    // One-shot: back to Move while the dialog is open; nothing placed until a file is chosen.
    expect(store.getState().tool).toBe('select')
    expect(Object.keys(store.getState().doc.board.nodes)).toHaveLength(0)
    const input = document.querySelector<HTMLInputElement>('input[data-media-picker="image"]')
    expect(input?.accept).toContain('image/*')
    await act(async () => chooseFiles('image', [png()]))
    expect(host.uploadAttachment).toHaveBeenCalledTimes(1)
    const b = store.getState().doc.board
    const [n] = mediaNodes(b)
    expect(b.blocks[n.blockId!]).toEqual({ type: 'media', path: 'Attachments/diagram.png' })
    // The image default size, centred on the click and snapped to the 30 px grid.
    expect(n).toMatchObject({ kind: 'block', width: 420, height: 300, headless: true })
    expect(n.position.x % 30).toBe(0)
    expect(n.position.y % 30).toBe(0)
    expect(n.position).toEqual({ x: 90, y: 150 })
    expect(store.getState().selection).toEqual([n.id])
    // One undo step removes it.
    act(() => store.getState().actions.undo())
    expect(mediaNodes(store.getState().doc.board)).toHaveLength(0)
    // The upload went through the host only; the canvas fetched nothing itself.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('the PDF, Audio and File tools accept their kind; an upload over 100 MiB is refused before sending', async () => {
    const { store, host } = renderCanvas()
    await act(async () => {})
    act(() => store.getState().actions.setTool('pdf'))
    click(screen.getByTestId('whiteboard-placement'), 300, 300)
    expect(document.querySelector<HTMLInputElement>('input[data-media-picker="pdf"]')?.accept).toContain('.pdf')
    await act(async () => chooseFiles('pdf', [new File(['%PDF'], 'report.pdf')]))
    act(() => store.getState().actions.setTool('file'))
    click(screen.getByTestId('whiteboard-placement'), 900, 300)
    const big = new File(['x'], 'huge.zip')
    Object.defineProperty(big, 'size', { value: 101 * 1024 * 1024 })
    await act(async () => chooseFiles('file', [big]))
    expect(host.uploadAttachment).toHaveBeenCalledTimes(1)
    const b = store.getState().doc.board
    const nodes = mediaNodes(b)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject(MEDIA_DEFAULT_SIZE.pdf)
  })

  test('test media tool remembers the last kind', async () => {
    const user = userEvent.setup()
    const onTool = vi.fn()
    const props = {
      tool: 'select' as const,
      onTool,
      settings: { ...DEFAULT_SETTINGS },
      onSettings: vi.fn(),
      locked: false,
      onLock: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      canUndo: false,
      canRedo: false,
    }
    const { rerender } = render(<Toolbox {...props} memory={{}} />)
    // Nothing remembered: Image.
    expect(screen.getByRole('button', { name: 'Media' })).toHaveAttribute('data-armed', 'image')
    await user.click(screen.getByRole('button', { name: 'Choose media' }))
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Image', 'PDF', 'Audio', 'File', 'Web link'])
    await user.click(screen.getByRole('menuitem', { name: 'Web link' }))
    expect(onTool).toHaveBeenLastCalledWith('weblink')

    // The store remembers it per board (localStorage only) and the button re-arms it.
    const store = createBoardStore({ onMemory: (m) => saveToolMemory(KEY, m) })
    act(() => store.getState().actions.setTool('pdf'))
    act(() => store.getState().actions.setTool('rectangle'))
    expect(loadToolMemory(KEY)).toMatchObject({ lastMediaTool: 'pdf', lastUsedTool: 'rectangle' })
    expect(JSON.parse(localStorage.getItem(TOOLS_KEY + KEY) ?? '{}').lastMediaTool).toBe('pdf')
    rerender(<Toolbox {...props} memory={store.getState().memory} />)
    expect(screen.getByRole('button', { name: 'Media' })).toHaveAttribute('data-armed', 'pdf')
    await user.click(screen.getByRole('button', { name: 'Media' }))
    expect(onTool).toHaveBeenLastCalledWith('pdf')

    expect(resolveWhiteboardMediaTool()).toBe('image')
    expect(resolveWhiteboardMediaTool(undefined, 'audio')).toBe('audio')
    expect(resolveWhiteboardMediaTool('file', 'audio')).toBe('file')
    expect(resolveWhiteboardMediaTool('rectangle', 'text')).toBe('image')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('test dropped file becomes a media node', async () => {
    const { store, host, wrapper } = renderCanvas({ snap: false })
    await act(async () => {})
    const files = [png('a.png'), new File(['ID3'], 'voice memo.m4a')]
    const ev = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperties(ev, {
      clientX: { value: 500 },
      clientY: { value: 300 },
      dataTransfer: { value: { files, types: ['Files'], getData: () => '' } },
    })
    await act(async () => {
      wrapper.dispatchEvent(ev)
    })
    expect(ev.defaultPrevented).toBe(true)
    expect(host.uploadAttachment).toHaveBeenCalledTimes(2)
    const b = store.getState().doc.board
    const nodes = mediaNodes(b)
    expect(nodes.map((n) => (b.blocks[n.blockId!] as WhiteboardMediaBlock).path)).toEqual([
      'Attachments/a.png',
      'Attachments/voice memo.m4a',
    ])
    // Centred on the drop point, the second one a grid step further (the cascade).
    const [img, audio] = nodes
    expect(img.position.x + img.width! / 2).toBe(500)
    expect(img.position.y + img.height! / 2).toBe(300)
    expect(audio).toMatchObject(MEDIA_DEFAULT_SIZE.audio)
    expect(audio.position.x + audio.width! / 2).toBe(530)
    // A locked board takes no files.
    act(() => store.getState().actions.setLocked(true))
    await act(async () => {
      wrapper.dispatchEvent(ev)
    })
    expect(host.uploadAttachment).toHaveBeenCalledTimes(2)
  })

  test('the web link tool asks for a URL and an optional title, then places a card', async () => {
    const user = userEvent.setup()
    const { store } = renderCanvas()
    await act(async () => {})
    act(() => store.getState().actions.setTool('weblink'))
    click(screen.getByTestId('whiteboard-placement'), 300, 300)
    expect(store.getState().tool).toBe('select')
    const dialog = screen.getByTestId('whiteboard-weblink-input')
    expect(screen.getByText('Add link')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Paste URL'), 'javascript:alert(1)')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid URL format')
    expect(Object.keys(store.getState().doc.board.nodes)).toHaveLength(0)
    await user.clear(screen.getByPlaceholderText('Paste URL'))
    await user.type(screen.getByPlaceholderText('Paste URL'), 'www.example.org/guide')
    await user.type(screen.getByPlaceholderText('Title'), '  The guide ')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(dialog).not.toBeInTheDocument()
    const b = store.getState().doc.board
    const [n] = Object.values(b.nodes)
    expect(b.blocks[n.blockId!]).toEqual({ type: 'weblink', url: 'https://www.example.org/guide', title: 'The guide' })
    expect(n).toMatchObject(WEBLINK_DEFAULT_SIZE)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('test weblink node never fetches', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const b = createWeblink(board(), { url: 'https://www.example.org/a/b?c=1', title: 'Example' }, { x: 0, y: 0 }, { id: 'w' })
    const bare = createWeblink(b, { url: 'http://example.com/plain' }, { x: 0, y: 300 }, { id: 'w2' })
    const { nodeEl, container } = renderBoard(bare, { host: nodeHost() })
    await act(async () => {})
    const card = nodeEl('w')!.querySelector('[data-testid="whiteboard-weblink-node"]') as HTMLElement
    expect(card).not.toBeNull()
    expect(card.querySelector('[data-testid="whiteboard-weblink-title"]')).toHaveTextContent('Example')
    expect(card.querySelector('[data-testid="whiteboard-weblink-host"]')).toHaveTextContent('example.org')
    expect(card).toHaveTextContent('https://www.example.org/a/b?c=1')
    const plain = nodeEl('w2')!.querySelector('[data-testid="whiteboard-weblink-title"]')
    expect(plain).toHaveTextContent('http://example.com/plain')
    // Nothing that loads a remote resource: no image, iframe, favicon, link or script.
    expect(container.querySelectorAll('img, iframe, link, script, object, embed')).toHaveLength(0)
    expect(fetchSpy).not.toHaveBeenCalled()
    // Double-click opens the URL in the browser (a user navigation), still without a fetch.
    fireEvent.doubleClick(card)
    expect(open).toHaveBeenCalledWith('https://www.example.org/a/b?c=1', '_blank', 'noopener,noreferrer')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(weblinkHost('https://www.example.org/x')).toBe('example.org')
    expect(normalizeWeblinkUrl('example.org')).toBe('https://example.org')
    for (const bad of ['', 'ftp://x.org', 'mailto:a@b.c', 'https://', 'http:///x', 'https://a b.org', 'data:text/html,hi']) {
      expect(normalizeWeblinkUrl(bad), bad).toBeNull()
    }
  })

  test('media nodes render the file kinds and open with the OS on double-click', async () => {
    let b = board()
    b = createMedia(b, 'Attachments/diagram.png', { x: 0, y: 0 }, { id: 'img' })
    b = createMedia(b, 'Attachments/report.pdf', { x: 600, y: 0 }, { id: 'pdf' })
    b = createMedia(b, 'Attachments/voice.m4a', { x: 0, y: 600 }, { id: 'aud' })
    b = createMedia(b, 'Attachments/data.xlsx', { x: 600, y: 600 }, { id: 'file' })
    const host = nodeHost({
      fileUrl: vi.fn((p: string) => `/api/file?path=${encodeURIComponent(p)}`),
      openAttachment: vi.fn(async () => ({ ok: true })),
    })
    const { nodeEl } = renderBoard(b, { host })
    await act(async () => {})
    const img = nodeEl('img')!.querySelector('img')!
    expect(img.getAttribute('src')).toBe('/api/file?path=Attachments%2Fdiagram.png')
    expect(img.style.objectFit).toBe('cover')
    expect(nodeEl('pdf')!.querySelector('iframe')!.getAttribute('src')).toBe('/api/file?path=Attachments%2Freport.pdf')
    expect(nodeEl('aud')!.querySelector('audio')).not.toBeNull()
    expect(nodeEl('file')!.querySelector('[data-testid="whiteboard-media-file"]')).toHaveTextContent('data.xlsx')
    // Every URL is same-origin.
    for (const el of document.querySelectorAll('[src]')) expect(el.getAttribute('src')!.startsWith('/')).toBe(true)
    fireEvent.doubleClick(nodeEl('img')!.querySelector('[data-testid="whiteboard-media-node"]')!)
    expect(host.openAttachment).toHaveBeenCalledWith('Attachments/diagram.png')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mediaKindOf('Attachments/clip.MP4')).toBe('video')
  })

  test('with Media loading: Required only an image node waits behind Load; Clear media cache reloads it (M31 fix)', async () => {
    useSettings.setState({ settings: { ...settingsDefaults, mediaLoading: 'required' }, revision: 'r0', loaded: true })
    const b = createMedia(board(), 'Attachments/diagram.png', { x: 0, y: 0 }, { id: 'img' })
    const host = nodeHost({ fileUrl: vi.fn((p: string) => `/api/file?path=${encodeURIComponent(p)}`), openAttachment: vi.fn(async () => ({ ok: true })) })
    const { nodeEl } = renderBoard(b, { host })
    await act(async () => {})
    expect(nodeEl('img')!.querySelector('img')).toBeNull()
    expect(nodeEl('img')!.querySelector('[data-testid="media-placeholder"]')).toHaveTextContent('diagram.png')
    fireEvent.click(screen.getByRole('button', { name: MEDIA_TEXT.load }))
    const img = nodeEl('img')!.querySelector('img')!
    expect(img.getAttribute('src')).toBe('/api/file?path=Attachments%2Fdiagram.png')
    act(() => void bumpMediaToken())
    expect(nodeEl('img')!.querySelector('img')!.getAttribute('src')).toMatch(/^\/api\/file\?path=Attachments%2Fdiagram\.png&m=\w+$/)
    useSettings.setState({ settings: settingsDefaults })
    resetMediaToken()
  })

  test('test media nodes round trip through flow mapping', () => {
    let b = board([node({ id: 't', blockId: 'bt', width: 420, height: 60 })], [], { bt: { type: 'text', markdown: 'hi' } })
    b = createMedia(b, 'Attachments/diagram.png', { x: 0, y: 0 }, { id: 'm' })
    b = createWeblink(b, { url: 'https://example.org' }, { x: 0, y: 400 }, { id: 'w' })
    // Unknown keys on the media block and node survive.
    const m = b.nodes.m
    b = {
      ...b,
      nodes: { ...b.nodes, m: { ...m, 'x-future': 1 } as WhiteboardNode },
      blocks: { ...b.blocks, [m.blockId!]: { ...b.blocks[m.blockId!], caption: 'kept' } },
    }
    const flow = toFlow(b)
    const fm = flow.nodes.find((n) => n.id === 'm')!
    expect(fm.type).toBe('boardBlock')
    expect(fm.data.block).toEqual({ type: 'media', path: 'Attachments/diagram.png', caption: 'kept' })
    expect(fm.data.node).toBe(b.nodes.m)
    expect(fm).toMatchObject({ width: 420, height: 300 })
    expect(flow.nodes.find((n) => n.id === 'w')!.data.block).toEqual({ type: 'weblink', url: 'https://example.org' })
    // No change → the same board; a resize writes only width and height.
    expect(fromFlowChange(b, [])).toBe(b)
    const resized = fromFlowChange(b, [
      { type: 'dimensions', id: 'm', dimensions: { width: 630, height: 450 }, resizing: true },
    ])
    expect(resized.nodes.m).toEqual({ ...b.nodes.m, width: 630, height: 450 })
    expect(resized.blocks).toBe(b.blocks)
    expect(resized.nodes.w).toBe(b.nodes.w)
    // Back to JSON and in again: identical.
    expect(JSON.parse(JSON.stringify(resized))).toEqual(resized)
  })
})
