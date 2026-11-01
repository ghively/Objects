import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { TextBlockEditor } from './nodes/TextBlockEditor'
import { EdgeLabel } from './edges/EdgeLabel'

type TiptapDom = HTMLElement & { editor?: { commands: { focus(p: string): void; insertContent(s: string): void } } }

describe('audit: node editors unmounting without a commit', () => {
  test('TextBlockEditor: typed text is lost when the node unmounts (scrolled out of view) before blur', async () => {
    const onCommit = vi.fn()
    const utils = render(<TextBlockEditor markdown="" onCommit={onCommit} />)
    const dom = await waitFor(() => {
      const el = utils.container.querySelector('.ProseMirror') as TiptapDom | null
      expect(el).toBeTruthy()
      return el!
    })
    act(() => {
      dom.editor!.commands.focus('end')
      dom.editor!.commands.insertContent('Hello typed text')
    })
    // React Flow's onlyRenderVisibleElements unmounts a node that leaves the viewport (pan/zoom
    // with the wheel while editing): the editor goes away without blur or Escape.
    utils.unmount()
    await act(async () => {})
    console.log('TextBlockEditor onCommit calls after unmount:', onCommit.mock.calls)
    expect(onCommit).toHaveBeenCalledWith('Hello typed text')
  })

  test('EdgeLabel input: the typed label is lost when the edge unmounts before blur', async () => {
    const onCommit = vi.fn()
    const utils = render(
      <EdgeLabel edgeId="e1" x={0} y={0} text="" editing selected onStartEdit={() => {}} onCommit={onCommit} />,
    )
    const input = utils.container.querySelector('input')!
    fireEvent.change(input, { target: { value: 'new label' } })
    utils.unmount()
    console.log('EdgeLabel onCommit calls after unmount:', onCommit.mock.calls)
    expect(onCommit).toHaveBeenCalledWith('new label')
  })
})
