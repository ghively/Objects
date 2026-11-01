import type { DragEndEvent } from '@dnd-kit/core'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement, type ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LabelOption, PropertyDef } from '@/api/types'
import { propertyDef } from '@/test/mockApi'
import { THEME_COLORS } from '@/theme/palette'
import { LabelMenu } from './LabelMenu'
import { LabelCell } from './cells/LabelCell'

// Capture the DndContext's onDragEnd so a test can play a finished drag (jsdom has no layout,
// so pointer-driven dragging can't be simulated).
const drag = vi.hoisted(() => ({ end: null as null | ((e: DragEndEvent) => void) }))
vi.mock('@dnd-kit/core', async (orig) => {
  const m = await orig<typeof import('@dnd-kit/core')>()
  return {
    ...m,
    DndContext: (props: ComponentProps<typeof m.DndContext>) => {
      drag.end = props.onDragEnd ?? null
      return createElement(m.DndContext, props)
    },
  }
})

afterEach(() => {
  drag.end = null
  vi.restoreAllMocks()
})

function opt(id: string, text: string, extra: Partial<LabelOption> = {}): LabelOption {
  return { id, text, color: 'blue', icon: null, ...extra }
}

function labelDef(set: LabelOption[], extra: Partial<PropertyDef['options']> = {}): PropertyDef {
  return propertyDef({ id: 'p1', key: 'stage', name: 'Stage', type: 'label', options: { isArray: false, set, ...extra } })
}

const STATUS_SET = [
  opt('s1', 'Todo', { statusCategory: 'not-started' }),
  opt('s2', 'Doing', { statusCategory: 'in-progress' }),
  opt('s3', 'Finished', { statusCategory: 'done' }),
]

describe('LabelMenu', () => {
  it('test LabelMenu search shows "New \'x\'" and creates option with random theme colour', async () => {
    const user = userEvent.setup()
    const onDefChange = vi.fn()
    const onChange = vi.fn()
    render(
      <LabelMenu def={labelDef([opt('a', 'Alpha')])} value={[]} onChange={onChange} onDefChange={onDefChange} />,
    )
    await user.type(screen.getByRole('textbox', { name: 'Search or Create' }), 'Beta')
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: "New 'Beta'" }))

    expect(onDefChange).toHaveBeenCalledTimes(1)
    const next: PropertyDef = onDefChange.mock.calls[0][0]
    const created = next.options.set!.find((o) => o.text === 'Beta')!
    expect(created).toBeDefined()
    expect(THEME_COLORS).toContain(created.color)
    expect(next.options.set).toHaveLength(2)
    // The value is applied after the option set.
    expect(onChange).toHaveBeenCalledWith(['Beta'])
    expect(onDefChange.mock.invocationCallOrder[0]).toBeLessThan(onChange.mock.invocationCallOrder[0])
  })

  it('a new option is not applied when the type save fails or resolves null, and the failure shows', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onDefChange = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('Disk full.'))
    render(<LabelMenu def={labelDef([opt('a', 'Alpha')])} value={[]} onChange={onChange} onDefChange={onDefChange} />)
    await user.type(screen.getByRole('textbox', { name: 'Search or Create' }), 'Beta')
    await user.click(screen.getByRole('button', { name: "New 'Beta'" }))
    expect(onDefChange).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('The label could not be created.')
    await user.click(screen.getByRole('button', { name: "New 'Beta'" }))
    expect(onDefChange).toHaveBeenCalledTimes(2)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Disk full.')
  })

  it('an exact match offers no "New" item', async () => {
    const user = userEvent.setup()
    render(<LabelMenu def={labelDef([opt('a', 'Alpha')])} value={[]} onChange={vi.fn()} onDefChange={vi.fn()} />)
    await user.type(screen.getByRole('textbox', { name: 'Search or Create' }), 'alpha')
    expect(screen.queryByRole('button', { name: /^New / })).not.toBeInTheDocument()
  })

  it('test duplicate label name warns "A label with this name already exists…"', async () => {
    const user = userEvent.setup()
    const onDefChange = vi.fn()
    render(
      <LabelMenu
        def={labelDef([opt('a', 'Alpha'), opt('b', 'Beta')])}
        value={[]}
        onChange={vi.fn()}
        onDefChange={onDefChange}
      />,
    )
    await user.click(screen.getAllByRole('button', { name: 'Edit label' })[1])
    const name = screen.getByRole('textbox', { name: 'Label name' })
    await user.clear(name)
    await user.type(name, 'alpha')
    expect(screen.getByText(/A label with this name already exists/)).toBeInTheDocument()
    await user.tab()
    expect(onDefChange).not.toHaveBeenCalled()
  })

  it('test edit label submenu renames on blur and changes color', async () => {
    const user = userEvent.setup()
    const onDefChange = vi.fn()
    render(
      <LabelMenu def={labelDef([opt('a', 'Alpha')])} value={[]} onChange={vi.fn()} onDefChange={onDefChange} />,
    )
    await user.click(screen.getByRole('button', { name: 'Edit label' }))
    const name = screen.getByRole('textbox', { name: 'Label name' })
    await user.clear(name)
    await user.type(name, 'Omega')
    expect(onDefChange).not.toHaveBeenCalled()
    await user.tab()
    expect(onDefChange).toHaveBeenCalledTimes(1)
    expect(onDefChange.mock.calls[0][0].options.set[0]).toMatchObject({ id: 'a', text: 'Omega', color: 'blue' })

    await user.click(screen.getByRole('button', { name: 'Red' }))
    expect(onDefChange).toHaveBeenCalledTimes(2)
    expect(onDefChange.mock.calls[1][0].options.set[0]).toMatchObject({ id: 'a', color: 'red' })
  })

  it('delete removes the option from the set', async () => {
    const user = userEvent.setup()
    const onDefChange = vi.fn()
    render(
      <LabelMenu
        def={labelDef([opt('a', 'Alpha'), opt('b', 'Beta')])}
        value={[]}
        onChange={vi.fn()}
        onDefChange={onDefChange}
      />,
    )
    await user.click(screen.getAllByRole('button', { name: 'Edit label' })[0])
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDefChange.mock.calls[0][0].options.set.map((o: LabelOption) => o.id)).toEqual(['b'])
  })

  it('test status menu shows "Open" then Not started / In progress / Blocked / Done; empty section shows "Create"', async () => {
    const user = userEvent.setup()
    const onDefChange = vi.fn()
    render(
      <LabelMenu
        def={labelDef(STATUS_SET, { isStatus: true })}
        value={[]}
        onChange={vi.fn()}
        onDefChange={onDefChange}
      />,
    )
    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings).toEqual(['Open', 'Not started', 'In progress', 'Blocked', 'Done'])
    const blocked = screen.getByRole('group', { name: 'Blocked' })
    expect(within(blocked).getByRole('button', { name: 'Create' })).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Done' })).queryByRole('button', { name: 'Create' })).toBeNull()
    expect(within(screen.getByRole('group', { name: 'Done' })).getByText('Finished')).toBeInTheDocument()

    await user.click(within(blocked).getByRole('button', { name: 'Create' }))
    const next: PropertyDef = onDefChange.mock.calls[0][0]
    const created = next.options.set!.find((o) => !STATUS_SET.some((s) => s.id === o.id))!
    expect(created).toMatchObject({ text: 'New status', statusCategory: 'blocked' })
  })

  it('test dragging a status option to Done sets statusCategory done', () => {
    const onDefChange = vi.fn()
    render(
      <LabelMenu
        def={labelDef(STATUS_SET, { isStatus: true })}
        value={[]}
        onChange={vi.fn()}
        onDefChange={onDefChange}
      />,
    )
    expect(drag.end).toBeTypeOf('function')
    act(() => drag.end!({ active: { id: 's1' }, over: { id: 'section:done' } } as unknown as DragEndEvent))
    const set: LabelOption[] = onDefChange.mock.calls[0][0].options.set
    expect(set.find((o) => o.id === 's1')!.statusCategory).toBe('done')

    // Dropping onto another option moves it into that option's section, before it.
    onDefChange.mockClear()
    act(() => drag.end!({ active: { id: 's1' }, over: { id: 's2' } } as unknown as DragEndEvent))
    const set2: LabelOption[] = onDefChange.mock.calls[0][0].options.set
    expect(set2.find((o) => o.id === 's1')!.statusCategory).toBe('in-progress')
  })

  it('reorders a plain label set by dragging', () => {
    const onDefChange = vi.fn()
    render(
      <LabelMenu
        def={labelDef([opt('a', 'A'), opt('b', 'B'), opt('c', 'C')])}
        value={[]}
        onChange={vi.fn()}
        onDefChange={onDefChange}
      />,
    )
    act(() => drag.end!({ active: { id: 'c' }, over: { id: 'a' } } as unknown as DragEndEvent))
    expect(onDefChange.mock.calls[0][0].options.set.map((o: LabelOption) => o.id)).toEqual(['c', 'a', 'b'])
  })

  it('test last Done label cannot be deleted', async () => {
    const user = userEvent.setup()
    const onDefChange = vi.fn()
    render(
      <LabelMenu
        def={labelDef(STATUS_SET, { isStatus: true })}
        value={[]}
        onChange={vi.fn()}
        onDefChange={onDefChange}
      />,
    )
    const done = screen.getByRole('group', { name: 'Done' })
    await user.click(within(done).getByRole('button', { name: 'Edit label' }))
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()

    // Nor can it be dragged out of Done.
    act(() => drag.end?.({ active: { id: 's3' }, over: { id: 'section:blocked' } } as unknown as DragEndEvent))
    expect(onDefChange).not.toHaveBeenCalled()
  })
})

describe('LabelCell', () => {
  it('test single-select closes, multi-select stays open', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const set = [opt('a', 'Alpha'), opt('b', 'Beta')]
    const { unmount } = render(<LabelCell def={labelDef(set)} value={[]} onChange={onChange} onDefChange={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Edit Stage' }))
    await user.click(await screen.findByRole('option', { name: /Alpha/ }))
    expect(onChange).toHaveBeenLastCalledWith(['Alpha'])
    expect(screen.queryByRole('textbox', { name: 'Search or Create' })).not.toBeInTheDocument()
    unmount()

    onChange.mockClear()
    render(
      <LabelCell
        def={labelDef(set, { isArray: true })}
        value={['Beta']}
        onChange={onChange}
        onDefChange={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Edit Stage' }))
    await user.click(await screen.findByRole('option', { name: /Alpha/ }))
    expect(onChange).toHaveBeenLastCalledWith(['Beta', 'Alpha'])
    expect(screen.getByRole('textbox', { name: 'Search or Create' })).toBeInTheDocument()
  })

  it('renders the selected options as pills', () => {
    render(
      <LabelCell
        def={labelDef([opt('a', 'Alpha', { color: 'teal' })])}
        value={['Alpha']}
        onChange={vi.fn()}
        onDefChange={vi.fn()}
      />,
    )
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })
})

describe('LabelMenu settings gear', () => {
  it('opens the property settings from the search field', async () => {
    const user = userEvent.setup()
    const onOpenSettings = vi.fn()
    const { unmount } = render(
      <LabelMenu def={labelDef([opt('a', 'Alpha')])} value={[]} onChange={vi.fn()} onDefChange={vi.fn()} onOpenSettings={onOpenSettings} />,
    )
    expect(screen.getByRole('textbox', { name: 'Search or Create' })).toHaveAttribute('placeholder', 'Search or Create')
    const gear = screen.getByRole('button', { name: 'Go to property settings' })
    expect(gear).toHaveAttribute('title', 'Go to property settings')
    await user.click(gear)
    expect(onOpenSettings).toHaveBeenCalled()
    unmount()
    render(<LabelMenu def={labelDef([opt('a', 'Alpha')])} value={[]} onChange={vi.fn()} onDefChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Go to property settings' })).not.toBeInTheDocument()
  })
})
