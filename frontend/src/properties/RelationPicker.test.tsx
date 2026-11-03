import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PropertyDef } from '@/api/types'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { objectSummary, propertyDef, typeDef } from '@/test/mockApi'
import { api } from '@/api/client'
import { RelationCell } from './cells/RelationCell'
import { RelationPicker } from './RelationPicker'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

const OBJECTS = [
  objectSummary({ path: 'People/Ada.md', id: 'id-ada', type: 'person', title: 'Ada' }),
  objectSummary({ path: 'People/Grace.md', id: 'id-grace', type: 'person', title: 'Grace' }),
  objectSummary({ path: 'People/Alan.md', id: 'id-alan-1', type: 'person', title: 'Alan' }),
  objectSummary({ path: 'People/Archive/Alan.md', id: 'id-alan-2', type: 'person', title: 'Alan' }),
  objectSummary({ path: 'Pages/Ada notes.md', id: 'id-p', type: 'page', title: 'Ada notes' }),
  objectSummary({ path: 'Templates/People/Person.md', id: 'id-t', type: 'person', title: 'Person', template: 'Person' }),
]

function relDef(options: PropertyDef['options']): PropertyDef {
  return propertyDef({ id: 'p1', key: 'people', name: 'People', type: 'entity', options })
}

beforeEach(() => {
  resetLinkIndex()
  useLinkIndex.setState({
    types: [typeDef({ id: 'person', name: 'Person', pluralName: 'People' }), typeDef({ id: 'page', name: 'Page' })],
    objects: OBJECTS,
    loaded: true,
  })
})

describe('RelationPicker', () => {
  it('test RelationPicker lists only allowed type and fixed set ("Selection set") and disambiguates duplicate titles', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { unmount } = render(
      <RelationPicker def={relDef({ isArray: true, allowedTypes: ['person'] })} value={[]} onChange={onChange} />,
    )
    const names = screen.getAllByRole('option').map((o) => o.textContent)
    expect(names.some((n) => n?.includes('Ada notes'))).toBe(false)
    expect(names.some((n) => n?.includes('Person'))).toBe(false) // templates are never offered
    expect(names.filter((n) => n?.startsWith('Alan'))).toHaveLength(2)
    // Duplicate titles show their folder.
    expect(screen.getByText('People/Archive')).toBeInTheDocument()
    expect(screen.queryByText('Selection set')).not.toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: /Grace/ }))
    expect(onChange).toHaveBeenLastCalledWith([{ target: 'Grace', path: 'People/Grace.md' }])
    unmount()

    render(
      <RelationPicker
        def={relDef({ isArray: true, allowedTypes: ['person'], hasFixedSet: true, fixedSet: ['id-ada', 'id-alan-2'] })}
        value={[]}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText('Selection set')).toBeInTheDocument()
    const fixed = screen.getAllByRole('option').map((o) => o.textContent ?? '')
    expect(fixed).toHaveLength(2)
    expect(fixed[0]).toContain('Ada')
    expect(fixed[1]).toContain('Alan')
  })

  it('search narrows, multi-select toggles and keeps other values', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <RelationPicker
        def={relDef({ isArray: true, allowedTypes: ['person'] })}
        value={[{ target: 'Ada', path: 'People/Ada.md' }]}
        onChange={onChange}
      />,
    )
    await user.type(screen.getByRole('textbox', { name: 'Search for objects' }), 'gra')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    await user.click(screen.getByRole('option', { name: /Grace/ }))
    expect(onChange).toHaveBeenLastCalledWith([
      { target: 'Ada', path: 'People/Ada.md' },
      { target: 'Grace', path: 'People/Grace.md' },
    ])
  })

  it('single-select replaces the value and closes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onClose = vi.fn()
    render(
      <RelationPicker
        def={relDef({ isArray: false, allowedTypes: ['person'] })}
        value={[{ target: 'Ada', path: 'People/Ada.md' }]}
        onChange={onChange}
        onClose={onClose}
      />,
    )
    await user.click(screen.getByRole('option', { name: /Grace/ }))
    expect(onChange).toHaveBeenLastCalledWith([{ target: 'Grace', path: 'People/Grace.md' }])
    expect(onClose).toHaveBeenCalled()
  })

  it("empty states use Object's strings and Edit Property opens the settings", async () => {
    const user = userEvent.setup()
    const onOpenSettings = vi.fn()
    const { unmount } = render(
      <RelationPicker
        def={relDef({ isArray: true, allowedTypes: ['person'] })}
        value={[]}
        onChange={vi.fn()}
        onOpenSettings={onOpenSettings}
      />,
    )
    await user.type(screen.getByRole('textbox', { name: 'Search for objects' }), 'zzzz')
    expect(screen.getByText('Nothing found')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit Property' }))
    expect(onOpenSettings).toHaveBeenCalled()
    unmount()

    render(
      <RelationPicker
        def={relDef({ isArray: true, allowedTypes: ['person'], hasFixedSet: true, fixedSet: [] })}
        value={[]}
        onChange={vi.fn()}
      />,
    )
    expect(
      screen.getByText('Nothing to select in this set. Search the whole database to add objects to the set.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Property' })).not.toBeInTheDocument()
  })
})

describe('Object -> Tag relations (item 22)', () => {
  const TAGS = [
    objectSummary({ path: 'Tags/In Progress.md', id: 'id-t1', type: 'tag', title: 'In Progress', color: 'bg-blue' }),
    objectSummary({ path: 'Tags/Complete.md', id: 'id-t2', type: 'tag', title: 'Complete', color: 'bg-green' }),
  ]
  const statusDef = () =>
    propertyDef({ id: 'p2', key: 'status', name: 'Status', type: 'entity', options: { isArray: false, allowedTypes: ['tag'] } })

  beforeEach(() => {
    useLinkIndex.setState({
      types: [typeDef({ id: 'tag', name: 'Tag', basic: true })],
      objects: TAGS,
      loaded: true,
    })
  })

  it('shows the linked tags as chips in their own colour', () => {
    render(<RelationCell def={statusDef()} value={[{ target: 'In Progress', path: 'Tags/In Progress.md' }]} onChange={vi.fn()} />)
    const chip = screen.getByText('In Progress').closest('[data-tag-chip]') as HTMLElement
    expect(chip).not.toBeNull()
    expect(chip.getAttribute('data-tag-chip')).toBe('blue')
  })

  it('the picker is "Search or Create": tags as coloured chips, and a new tag is created and picked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const ensure = vi.mocked(api.ensureTag)
    ensure.mockResolvedValueOnce({ path: 'Tags/On Hold.md', created: true })
    render(<RelationPicker def={statusDef()} value={[]} onChange={onChange} />)
    expect(screen.getByRole('textbox', { name: 'Search or Create' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Complete/ }).querySelector('[data-tag-chip="green"]')).not.toBeNull()
    await user.type(screen.getByRole('textbox', { name: 'Search or Create' }), 'On Hold')
    await user.click(screen.getByRole('option', { name: "Create 'On Hold'" }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([{ target: 'On Hold', path: 'Tags/On Hold.md' }]))
    expect(ensure).toHaveBeenCalledWith('On Hold')
  })

  it('offers no create for an existing tag or a relation to other types', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<RelationPicker def={statusDef()} value={[]} onChange={vi.fn()} />)
    await user.type(screen.getByRole('textbox', { name: 'Search or Create' }), 'complete')
    expect(screen.queryByRole('option', { name: /Create/ })).toBeNull()
    unmount()
    render(<RelationPicker def={relDef({ isArray: true, allowedTypes: ['person'] })} value={[]} onChange={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: 'Search for objects' })).toBeInTheDocument()
  })
})