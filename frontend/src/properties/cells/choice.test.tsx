import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { objectSummary, propertyDef, typeDef } from '@/test/mockApi'
import { TagPicker } from '../TagPicker'
import { AliasesCell } from './AliasesCell'
import { ColorCell } from './ColorCell'
import { DescriptionCell } from './DescriptionCell'
import { BacklinksCell, CollectionsCell, SystemFieldCell } from './SystemFieldCell'
import { TagsCell } from './TagsCell'
import { TypeChipCell } from './TypeChipCell'
import { RelationCell } from './RelationCell'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

beforeEach(() => {
  resetLinkIndex()
  useLinkIndex.setState({
    types: [typeDef({ id: 'tag', name: 'Tag', color: 'gray' }), typeDef({ id: 'person', name: 'Person', color: 'teal' })],
    objects: [
      objectSummary({ path: 'Tags/Math.md', type: 'tag', title: 'Math', color: 'bg-red' }),
      objectSummary({ path: 'Tags/Music.md', type: 'tag', title: 'Music', color: 'bg-blue' }),
      objectSummary({ path: 'People/Ada.md', type: 'person', title: 'Ada' }),
    ],
    loaded: true,
  })
})

describe('TagPicker', () => {
  it('test TagPicker placeholder "Search for tags or create one"; create calls onChange', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TagPicker value={['Math']} onChange={onChange} />)
    const input = screen.getByPlaceholderText('Search for tags or create one')
    await user.type(input, 'Mu')
    expect(screen.getByRole('option', { name: /Music/ })).toBeInTheDocument()
    await user.clear(input)
    await user.type(input, 'Physics')
    await user.click(screen.getByRole('option', { name: /Create 'Physics'/ }))
    expect(onChange).toHaveBeenLastCalledWith(['Math', 'Physics'])
  })

  it('picking an existing tag adds it; selected tags open on click', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onOpenTag = vi.fn()
    render(<TagPicker value={['Math']} onChange={onChange} onOpenTag={onOpenTag} />)
    await user.click(screen.getByRole('option', { name: /Music/ }))
    expect(onChange).toHaveBeenLastCalledWith(['Math', 'Music'])
    await user.click(screen.getByRole('button', { name: 'Math' }))
    expect(onOpenTag).toHaveBeenCalledWith('Math')
  })
})

describe('TagsCell', () => {
  it('shows tag chips and removes one', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onOpenTag = vi.fn()
    render(
      <TagsCell
        def={propertyDef({ id: 'tags', type: 'entity_tags', name: 'Tags' })}
        value={['Math', 'Music']}
        onChange={onChange}
        onOpenTag={onOpenTag}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Math' }))
    expect(onOpenTag).toHaveBeenCalledWith('Math')
    await user.click(screen.getByRole('button', { name: 'Remove Music' }))
    expect(onChange).toHaveBeenLastCalledWith(['Math'])
  })
})

describe('AliasesCell', () => {
  it('test AliasesCell 9th alias shows "You can only add up to 8 aliases."', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const eight = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']
    render(
      <AliasesCell
        def={propertyDef({ id: 'aliases', type: 'entity_aliases', name: 'Aliases' })}
        value={eight}
        onChange={onChange}
      />,
    )
    await user.type(screen.getByRole('textbox', { name: 'Add alias' }), 'a9{Enter}')
    expect(screen.getByText('You can only add up to 8 aliases.')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('adds an alias on Enter and refuses a duplicate', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <AliasesCell
        def={propertyDef({ id: 'aliases', type: 'entity_aliases', name: 'Aliases' })}
        value={['One']}
        onChange={onChange}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'Add alias' })
    await user.type(input, 'one{Enter}')
    expect(screen.getByText('An alias with this name already exists.')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    await user.clear(input)
    await user.type(input, 'Two{Enter}')
    expect(onChange).toHaveBeenLastCalledWith(['One', 'Two'])
  })
})

describe('other system cells', () => {
  it('DescriptionCell commits multi-line text on blur; empty is null', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <DescriptionCell
        def={propertyDef({ id: 'description', type: 'entity_description', name: 'Description' })}
        value="Old"
        onChange={onChange}
      />,
    )
    const box = screen.getByRole('textbox', { name: 'Description' })
    await user.clear(box)
    await user.type(box, 'Line 1{Shift>}{Enter}{/Shift}Line 2')
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith('Line 1\nLine 2')
    await user.clear(box)
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('ColorCell writes bg-<colour>', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ColorCell def={propertyDef({ id: 'color', type: 'color', name: 'Color' })} value="bg-red" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Edit Color' }))
    await user.click(await screen.findByRole('button', { name: 'Light blue' }))
    expect(onChange).toHaveBeenCalledWith('bg-sky')
  })

  it('TypeChipCell shows the type and opens change type', async () => {
    const user = userEvent.setup()
    const onChangeType = vi.fn()
    render(
      <TypeChipCell
        def={propertyDef({ id: 'type', type: 'entity_type', name: 'Object type' })}
        value="person"
        onChange={vi.fn()}
        onChangeType={onChangeType}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Person/ }))
    expect(onChangeType).toHaveBeenCalled()
  })

  it('collections, backlinks and media fields are read-only', () => {
    render(
      <>
        <CollectionsCell def={propertyDef({ id: 'collections', type: 'entity_collections' })} value={[]} onChange={vi.fn()} />
        <BacklinksCell def={propertyDef({ id: 'backlinks', type: 'entity_backlinks' })} value={3} onChange={vi.fn()} />
        <SystemFieldCell def={propertyDef({ id: 'mimeType', type: 'text' })} value="image/png" onChange={vi.fn()} />
      </>,
    )
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('image/png')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('RelationCell shows linked titles from the index', () => {
    render(
      <RelationCell
        def={propertyDef({ id: 'p', type: 'entity', name: 'People', options: { allowedTypes: ['person'] } })}
        value={[{ target: 'Ada', path: 'People/Ada.md' }, { target: 'Missing', path: null }]}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('Missing')).toBeInTheDocument()
  })
})
