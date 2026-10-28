import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { objectSummary, propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

// A probe cell for the `probe` key: shows what the panel hands a cell (frontmatter, onChangeMany).
vi.mock('@/properties/cellFor', async (orig) => {
  const real = await orig<typeof import('@/properties/cellFor')>()
  const Probe = (p: { value?: unknown; frontmatter?: Record<string, unknown>; onChangeMany?(u: Record<string, unknown>, r?: string[]): void }) => (
    <button type="button" data-fm={JSON.stringify(p.frontmatter ?? null)} data-value={JSON.stringify(p.value ?? null)} onClick={() => p.onChangeMany?.({ probe: 'x', sibling: 'y' }, ['gone'])}>
      probe
    </button>
  )
  return { ...real, cellForDef: (def: { key: string }) => (def.key === 'probe' ? Probe : real.cellForDef(def as never)) }
})

import type { Editor as TiptapEditor } from '@tiptap/core'
import { editorObjectTitle } from '@/editor/nodes/blockRef'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { cellValue, decodeDate, PropertyPanel } from './PropertyPanel'

const SCORE = propertyDef({ id: 'p-score', key: 'score', name: 'Score', type: 'number', visibility: 'hideWhenEmpty' })
const SECRET = propertyDef({ id: 'p-secret', key: 'secret', name: 'Secret', type: 'text', visibility: 'hidden' })
const NOTE = propertyDef({ id: 'p-note', key: 'note', name: 'Note', type: 'text' })
const DONE = propertyDef({ id: 'p-done', key: 'done', name: 'Done', type: 'boolean', visibility: 'hideWhenEmpty' })
const OWNER = propertyDef({ id: 'p-owner', key: 'owner', name: 'Owner', type: 'entity', options: { isArray: true } })
const TYPE = typeDef({
  id: 'project',
  name: 'Project',
  propertyDefinitions: [
    propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' }),
    NOTE,
    SCORE,
    DONE,
    SECRET,
  ],
})

beforeEach(() => {
  resetLinkIndex()
  useLinkIndex.setState({ types: [TYPE], objects: [], loaded: true })
})

describe('PropertyPanel', () => {
  test('test hideWhenEmpty hides number 0 and hidden collapses under "Hidden (1)"', async () => {
    const user = userEvent.setup()
    render(
      <PropertyPanel
        type={TYPE}
        frontmatter={{ title: 'X', note: 'hi', score: 0, done: true, secret: 's3' }}
        summary={objectSummary({ path: 'Projects/X.md', type: 'project' })}
        onChange={vi.fn()}
      />,
    )
    const panel = screen.getByRole('complementary', { name: 'Properties' })
    expect(within(panel).getByText('Note')).toBeInTheDocument()
    // Score is 0, which counts as empty; Done is true, so it shows.
    expect(within(panel).queryByText('Score')).not.toBeInTheDocument()
    expect(within(panel).getByText('Done')).toBeInTheDocument()
    // The title is edited in the header, never in the panel.
    expect(within(panel).queryByText('Title')).not.toBeInTheDocument()
    expect(within(panel).queryByText('Secret')).not.toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Hidden (1)' }))
    expect(within(panel).getByText('Secret')).toBeInTheDocument()
  })

  test('a cell commit calls onChange with the key and the API value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<PropertyPanel type={TYPE} frontmatter={{ note: 'hi' }} onChange={onChange} />)
    const input = screen.getByRole('textbox', { name: 'Note' })
    await user.clear(input)
    await user.type(input, 'hello{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('note', 'hello')
  })

  test('keys without a definition show read-only under "External properties"', () => {
    render(<PropertyPanel type={TYPE} frontmatter={{ note: 'hi', legacy: 'old value', id: 'x' }} onChange={vi.fn()} />)
    const section = screen.getByRole('region', { name: 'External properties' })
    expect(within(section).getByText('legacy')).toBeInTheDocument()
    expect(within(section).getByText('old value')).toBeInTheDocument()
    expect(within(section).queryByText('id')).not.toBeInTheDocument()
  })

  test('read-only panel never writes', () => {
    render(<PropertyPanel type={TYPE} frontmatter={{ note: 'hi' }} readOnly onChange={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveAttribute('readonly')
  })
})

describe('cellValue', () => {
  test('decodes the raw frontmatter as API values', () => {
    expect(cellValue(OWNER, { owner: ["[[Ada]]", "[[Bob|B]]"] }, { owner: ['People/Ada.md', null] })).toEqual([
      { target: 'Ada', path: 'People/Ada.md' },
      { target: 'Bob', path: null },
    ])
    expect(cellValue(propertyDef({ id: 'l', type: 'label' }), { l: 'One' })).toEqual(['One'])
    expect(cellValue(SCORE, { score: '12.5' })).toBe(12.5)
    expect(cellValue(propertyDef({ id: 'icon', type: 'entity_icon' }), { icon: 'ph-star', iconColor: 'red' })).toEqual({
      type: 'iconify',
      val: 'ph-star',
      color: 'red',
    })
    expect(cellValue(propertyDef({ id: 'icon', type: 'entity_icon' }), { icon: '🚀' })).toEqual({ type: 'emoji', val: '🚀' })
  })

  test('decodes dates, ranges and the midnight export form', () => {
    const due = propertyDef({ id: 'due', type: 'datetime' })
    expect(decodeDate(due, '2026-10-30')).toEqual({ start: '2026-10-30', resolution: 'day' })
    expect(decodeDate(due, '2026-10-30T14:00:00.000Z -> 2026-10-30T15:00:00.000Z')).toEqual({
      start: '2026-10-30T14:00:00.000Z',
      end: '2026-10-30T15:00:00.000Z',
      resolution: 'time',
    })
    const day = propertyDef({ id: 'd', type: 'datetime', options: { constraints: { resolutionPreference: 'day' } } })
    expect(decodeDate(day, '2026-03-26T00:00:00.000Z')).toEqual({ start: '2026-03-26', resolution: 'day' })
  })
})

describe('PropertyPanel definition editing', () => {
  test('a row label opens the PropertyMenu and Add Property adds a property to the type', async () => {
    const user = userEvent.setup()
    const onTypeChange = vi.fn()
    render(
      <PropertyPanel
        type={TYPE}
        frontmatter={{ title: 'X', note: 'hi' }}
        summary={objectSummary({ path: 'Projects/X.md', type: 'project' })}
        onChange={vi.fn()}
        onTypeChange={onTypeChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Note property menu' }))
    await user.click(screen.getByRole('button', { name: 'Hidden' }))
    expect(onTypeChange.mock.calls[0][0].propertyDefinitions.find((d: { id: string }) => d.id === 'p-note').visibility).toBe(
      'hidden',
    )

    await user.click(screen.getByRole('button', { name: 'Add Property' }))
    await user.click(screen.getByRole('menuitem', { name: 'Checkbox' }))
    await user.click(screen.getByRole('button', { name: 'Create' }))
    const added = onTypeChange.mock.calls[1][0].propertyDefinitions.at(-1)
    expect(added).toMatchObject({ type: 'boolean', key: 'checkbox', name: 'Checkbox' })
  })

  test('Add Property is disabled on a basic type', () => {
    render(
      <PropertyPanel
        type={{ ...TYPE, basic: true }}
        frontmatter={{ title: 'X' }}
        summary={objectSummary({ path: 'Projects/X.md', type: 'project' })}
        onChange={vi.fn()}
        onTypeChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Add Property' })).toBeDisabled()
  })
})

describe('multi-key cell writes', () => {
  test('test property panel passes frontmatter and onChangeMany', async () => {
    const user = userEvent.setup()
    const PROBE = propertyDef({ id: 'p-probe', key: 'probe', name: 'Probe', type: 'text' })
    const T = typeDef({ id: 'project', name: 'Project', propertyDefinitions: [PROBE] })
    const onChangeMany = vi.fn()
    const fm = { probe: 'a', sibling: 'b' }
    render(<PropertyPanel type={T} frontmatter={fm} onChange={vi.fn()} onChangeMany={onChangeMany} />)
    const probe = screen.getByRole('button', { name: 'probe' })
    expect(JSON.parse(probe.getAttribute('data-fm')!)).toEqual(fm)
    await user.click(probe)
    expect(onChangeMany).toHaveBeenCalledWith({ probe: 'x', sibling: 'y' }, ['gone'])
  })
})

describe('M5 backlinks', () => {
  test('test property panel passes backlinks to the backlinks cell', () => {
    const refs = [
      { target: 'Alpha', path: 'Pages/Alpha.md' },
      { target: 'Beta', path: 'Pages/Beta.md' },
    ]
    const BACKLINKS = propertyDef({ id: 'p-bl', key: 'backlinks', name: 'Backlinks', type: 'entity_backlinks' })
    expect(cellValue(BACKLINKS, {}, {}, undefined, refs)).toEqual(refs)
    expect(cellValue(BACKLINKS, {})).toBeNull()

    // The probe cell (key `probe`) shows the value the panel hands the backlinks cell.
    const PROBE = propertyDef({ id: 'p-probe', key: 'probe', name: 'Backlinks', type: 'entity_backlinks' })
    const type = typeDef({ id: 'project', name: 'Project', propertyDefinitions: [PROBE] })
    const summary = objectSummary({ path: 'Projects/X.md' })
    const { rerender } = render(<PropertyPanel type={type} frontmatter={{}} summary={summary} backlinks={refs} onChange={vi.fn()} />)
    expect(JSON.parse(screen.getByRole('button', { name: 'probe' }).dataset.value!)).toEqual(refs)
    rerender(<PropertyPanel type={type} frontmatter={{}} summary={summary} backlinks={[]} onChange={vi.fn()} />)
    expect(JSON.parse(screen.getByRole('button', { name: 'probe' }).dataset.value!)).toEqual([])
  })

  test('Content and Text cells know the object they belong to (for block references)', async () => {
    const CONTENT = propertyDef({ id: 'p-content', key: 'content', name: 'Content', type: 'blocks' })
    const TEXT = propertyDef({ id: 'p-text', key: 'summary', name: 'Summary', type: 'textBlock' })
    const T = typeDef({ id: 'project', name: 'Project', propertyDefinitions: [CONTENT, TEXT] })
    const { container } = render(
      <PropertyPanel
        type={T}
        frontmatter={{ content: 'Some content', summary: 'A line' }}
        summary={objectSummary({ path: 'Projects/Apollo.md', type: 'project' })}
        onChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit Summary' }))
    const editors = await waitFor(() => {
      const els = [...container.querySelectorAll('.ProseMirror')] as (HTMLElement & { editor?: TiptapEditor })[]
      expect(els).toHaveLength(2)
      return els.map((el) => el.editor!)
    })
    for (const editor of editors) expect(editorObjectTitle(editor)).toBe('Apollo')
  })
})
