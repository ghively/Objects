import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { board, node } from '../test/boards'
import { fakeHost, fakeRow, renderBoard } from './test/harness'

describe('EntityNode', () => {
  test('test entity node shows caption and card; double click peeks, ctrl double click opens a new tab', async () => {
    const host = fakeHost({
      resolve: vi.fn(async (link: string) => (link === '[[Router A]]' ? 'Devices/Router A.md' : link === '[[Router B]]' ? 'Devices/Router B.md' : null)),
      rows: vi.fn(async (paths: string[]) => paths.map((p) => fakeRow(p, p.replace(/^.*\//, '').replace(/\.md$/, '')))),
    })
    const a = node({ id: 'a', blockId: 'ba', position: { x: 0, y: 0 }, width: 360, height: 120 })
    const b = node({ id: 'b', blockId: 'bb', position: { x: 500, y: 0 }, width: 360, height: 120 })
    const { nodeEl } = renderBoard(
      board([a, b], [], { ba: { type: 'entity', link: '[[Router A]]' }, bb: { type: 'entity', link: '[[Router B]]' } }),
      { host },
    )
    await waitFor(() => expect(nodeEl('a')!.querySelector('[data-testid="small-card"]')).toBeTruthy())
    await waitFor(() => expect(nodeEl('b')!.querySelector('[data-testid="small-card"]')).toBeTruthy())
    // Rows for every embed come in one batched call.
    expect(host.rows).toHaveBeenCalledTimes(1)
    expect(vi.mocked(host.rows).mock.calls[0][0].sort()).toEqual(['Devices/Router A.md', 'Devices/Router B.md'])

    const caption = nodeEl('a')!.querySelector('[data-testid="whiteboard-embed-caption"]') as HTMLElement
    expect(caption).toHaveClass('whiteboard-embed-caption')
    expect(caption).toHaveTextContent('Router A')
    expect(nodeEl('a')!.querySelector('[data-testid="card-title"]')).toHaveTextContent('Router A')

    const body = nodeEl('a')!.querySelector('[data-testid="whiteboard-entity-node"]') as HTMLElement
    expect(body.style.minWidth).toBe('360px')
    fireEvent.doubleClick(body)
    expect(host.openObject).toHaveBeenLastCalledWith('Devices/Router A.md', { ctrlKey: false, metaKey: false })
    fireEvent.doubleClick(body, { ctrlKey: true })
    expect(host.openObject).toHaveBeenLastCalledWith('Devices/Router A.md', { ctrlKey: true, metaKey: false })
    fireEvent.doubleClick(body, { metaKey: true })
    expect(host.openObject).toHaveBeenLastCalledWith('Devices/Router A.md', { ctrlKey: false, metaKey: true })
  })

  test('test dangling entity link shows the link text', async () => {
    const host = fakeHost()
    const n = node({ id: 'd', blockId: 'bd', width: 360, height: 120 })
    const { nodeEl } = renderBoard(board([n], [], { bd: { type: 'entity', link: '[[Gone Server|Old box]]' } }), { host })
    const dangling = await screen.findByTestId('whiteboard-dangling-link')
    expect(dangling).toHaveTextContent('Old box')
    expect(dangling).toHaveClass('wikilink-unresolved')
    expect(nodeEl('d')!.querySelector('[data-testid="whiteboard-entity-node"]')).toHaveAttribute('data-dangling')
    expect(host.rows).not.toHaveBeenCalled()
    fireEvent.doubleClick(nodeEl('d')!.querySelector('[data-testid="whiteboard-entity-node"]')!)
    expect(host.openObject).not.toHaveBeenCalled()
  })
})
