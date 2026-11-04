import { act, fireEvent, render } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { EdgeLabel } from './EdgeLabel'

function renderLabel(over: Partial<Parameters<typeof EdgeLabel>[0]> = {}) {
  const props = {
    edgeId: 'e1',
    x: 120,
    y: 40,
    text: 'uplink',
    editing: false,
    selected: false,
    onStartEdit: vi.fn(),
    onCommit: vi.fn(),
    ...over,
  }
  const utils = render(<EdgeLabel {...props} />)
  return { props, ...utils, box: utils.container.querySelector('[data-whiteboard-edge-label]') as HTMLElement | null }
}

describe('EdgeLabel', () => {
  test('the typed label commits when the edge unmounts before blur (it left the viewport)', async () => {
    const { props, container, unmount } = renderLabel({ text: '', editing: true, selected: true })
    const input = container.querySelector('input')!
    fireEvent.change(input, { target: { value: 'new label' } })
    unmount()
    await act(async () => {})
    expect(props.onCommit).toHaveBeenCalledTimes(1)
    expect(props.onCommit).toHaveBeenCalledWith('new label')
  })

  test('sits at the midpoint with the label attributes', () => {
    const { box } = renderLabel({ selected: true })
    expect(box!.textContent).toBe('uplink')
    expect(box!.style.transform).toBe('translate(-50%, -50%) translate(120px, 40px)')
    expect(box!.getAttribute('data-whiteboard-edge-selected')).toBe('true')
    expect(box!.hasAttribute('data-whiteboard-active')).toBe(false)
    expect(box!.className).toContain('nodrag')
  })

  test('an empty label renders nothing unless editing', () => {
    expect(renderLabel({ text: '' }).box).toBeNull()
  })

  test('double click starts editing', () => {
    const { box, props } = renderLabel()
    fireEvent.doubleClick(box!)
    expect(props.onStartEdit).toHaveBeenCalledOnce()
  })

  test('double click adds a label; emptying it removes the block (commits once on Enter then blur)', () => {
    const { container, props } = renderLabel({ editing: true, text: '' })
    const input = container.querySelector('input')!
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: 'wan' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    expect(props.onCommit).toHaveBeenCalledTimes(1)
    expect(props.onCommit).toHaveBeenCalledWith('wan')
  })

  test('keys typed in the input do not reach the canvas', () => {
    const onKeyDown = vi.fn()
    const { container } = render(
      <div onKeyDown={onKeyDown}>
        <EdgeLabel edgeId="e1" x={0} y={0} text="a" editing selected={false} onStartEdit={vi.fn()} onCommit={vi.fn()} />
      </div>,
    )
    fireEvent.keyDown(container.querySelector('input')!, { key: 'Delete' })
    expect(onKeyDown).not.toHaveBeenCalled()
  })
})
