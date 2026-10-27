import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { WhiteboardBoardToolMemory, WhiteboardTool } from '@/api/whiteboardTypes'
import type { ResolvedSettings, ToolboxProps } from '../canvasTypes'
import { DEFAULT_SETTINGS } from '../model'
import { Toolbox, TOOLBOX_TEXT } from './Toolbox'

function setup(over: Partial<ToolboxProps> = {}) {
  const props: ToolboxProps = {
    tool: 'select',
    onTool: vi.fn(),
    settings: { ...DEFAULT_SETTINGS },
    onSettings: vi.fn(),
    locked: false,
    onLock: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    canUndo: false,
    canRedo: false,
    memory: {},
    ...over,
  }
  render(<Toolbox {...props} />)
  return props
}

const engineering: ResolvedSettings = { ...DEFAULT_SETTINGS, isEngineeringMode: true }

function names(): string[] {
  const bar = screen.getByRole('toolbar')
  return within(bar)
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? '')
}

describe('Toolbox', () => {
  test('test toolbox order and labels', () => {
    setup({ inkSlot: <button type="button" aria-label="Pen" /> })
    expect(names()).toEqual([
      'Move',
      TOOLBOX_TEXT.choosePointer,
      'Text',
      'Existing object',
      'New object',
      'Media',
      TOOLBOX_TEXT.chooseMedia,
      'Shapes',
      TOOLBOX_TEXT.chooseShape,
      'Frame',
      'Pen',
      'Undo',
      'Redo',
      'Lock whiteboard',
      'More options',
    ])
    expect(screen.getByRole('button', { name: 'Move' })).toHaveAttribute('title', 'Select tool (V)')
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', 'Undo last change (Ctrl+Z)')
    expect(screen.getByRole('button', { name: 'Redo' })).toHaveAttribute('title', 'Redo last change (Ctrl+Shift+Z)')
  })

  test('tools call onTool and the current tool is pressed', async () => {
    const user = userEvent.setup()
    const p = setup({ tool: 'text' })
    expect(screen.getByRole('button', { name: 'Text' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Existing object' }))
    await user.click(screen.getByRole('button', { name: 'New object' }))
    await user.click(screen.getByRole('button', { name: 'Frame' }))
    expect(p.onTool).toHaveBeenNthCalledWith(1, 'link')
    expect(p.onTool).toHaveBeenNthCalledWith(2, 'create')
    expect(p.onTool).toHaveBeenNthCalledWith(3, 'frame')
  })

  test('test pointer button re-arms the last of Move and Hand', async () => {
    const user = userEvent.setup()
    const memory: WhiteboardBoardToolMemory = { lastPointerTool: 'hand', lastUsedTool: 'text' }
    const p = setup({ tool: 'text', memory })
    expect(names()[0]).toBe('Hand')
    await user.click(screen.getByRole('button', { name: 'Hand' }))
    expect(p.onTool).toHaveBeenLastCalledWith('hand')
    // The caret offers both.
    await user.click(screen.getByRole('button', { name: TOOLBOX_TEXT.choosePointer }))
    await user.click(screen.getByRole('menuitem', { name: 'Move' }))
    expect(p.onTool).toHaveBeenLastCalledWith('select')
  })

  test('pointer button falls back to Move', () => {
    setup({ tool: 'frame', memory: {} })
    expect(names()[0]).toBe('Move')
  })

  test('shapes button re-arms the last shape tool, else Rectangle; the caret opens the shape menu', async () => {
    const user = userEvent.setup()
    const p = setup({ memory: {} })
    await user.click(screen.getByRole('button', { name: 'Shapes' }))
    expect(p.onTool).toHaveBeenLastCalledWith('rectangle')
    await user.click(screen.getByRole('button', { name: TOOLBOX_TEXT.chooseShape }))
    await user.click(screen.getByRole('menuitem', { name: 'Star' }))
    expect(p.onTool).toHaveBeenLastCalledWith('star')
  })

  test('shapes button re-arms the remembered shape tool', async () => {
    const user = userEvent.setup()
    const p = setup({ memory: { lastShapeTool: 'arrow' } })
    expect(screen.getByRole('button', { name: 'Shapes' })).toHaveAttribute('data-armed', 'arrow')
    await user.click(screen.getByRole('button', { name: 'Shapes' }))
    expect(p.onTool).toHaveBeenLastCalledWith('arrow')
  })

  test('test gates only in engineering mode, with I/O group, falling back to NAND', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <Toolbox
        tool="select"
        onTool={vi.fn()}
        settings={DEFAULT_SETTINGS}
        onSettings={vi.fn()}
        locked={false}
        onLock={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        canUndo={false}
        canRedo={false}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Gates' })).toBeNull()
    unmount()

    const p = setup({ settings: engineering, memory: {} })
    expect(names()).toContain('Gates')
    expect(names().indexOf('Gates')).toBeLessThan(names().indexOf('Frame'))
    expect(names().indexOf('Gates')).toBeGreaterThan(names().indexOf('Shapes'))
    await user.click(screen.getByRole('button', { name: 'Gates' }))
    expect(p.onTool).toHaveBeenLastCalledWith('nand')
    await user.click(screen.getByRole('button', { name: TOOLBOX_TEXT.chooseGate }))
    const menu = screen.getByRole('menu', { name: 'Gates' })
    expect(within(menu).getByText('I/O')).toBeInTheDocument()
    await user.click(within(menu).getByRole('menuitem', { name: 'LOW' }))
    expect(p.onTool).toHaveBeenLastCalledWith('low')
  })

  test('gates button re-arms the last gate', () => {
    setup({ settings: engineering, memory: { lastCircuitTool: 'xor' } })
    expect(screen.getByRole('button', { name: 'Gates' })).toHaveAttribute('data-armed', 'xor')
  })

  test('test undo redo buttons follow canUndo and canRedo', async () => {
    const user = userEvent.setup()
    const p = setup({ canUndo: true, canRedo: false })
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(p.onUndo).toHaveBeenCalledTimes(1)
    expect(p.onRedo).not.toHaveBeenCalled()
  })

  test('lock toggles and a locked board disables the placing tools', async () => {
    const user = userEvent.setup()
    const p = setup({ locked: true })
    const unlock = screen.getByRole('button', { name: 'Unlock whiteboard' })
    await user.click(unlock)
    expect(p.onLock).toHaveBeenCalledWith(false)
    for (const name of ['Text', 'Existing object', 'New object', 'Shapes', 'Frame']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    expect(screen.getByRole('button', { name: 'Move' })).toBeEnabled()
  })

  test('read-only disables lock and the placing tools', () => {
    setup({ readOnly: true })
    expect(screen.getByRole('button', { name: 'Lock whiteboard' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Text' })).toBeDisabled()
  })

  test('more options opens canvas display', async () => {
    const user = userEvent.setup()
    const p = setup()
    await user.click(screen.getByRole('button', { name: 'More options' }))
    expect(screen.getByText('Canvas display')).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Show dots' }))
    expect(p.onSettings).toHaveBeenCalledWith('isShowingDots', false)
  })

  test('every tool the toolbox arms is a known tool', async () => {
    const user = userEvent.setup()
    const seen: WhiteboardTool[] = []
    setup({ settings: engineering, onTool: (t) => seen.push(t) })
    for (const b of screen.getAllByRole('button', { name: /Text|Existing object|New object|Frame/ })) await user.click(b)
    expect(seen).toEqual(['text', 'link', 'create', 'frame'])
  })
})
