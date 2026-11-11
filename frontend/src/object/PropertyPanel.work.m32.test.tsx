// M32, item 10: no value is hidden by the Work switch. With Work off for the space the work
// kinds' rows (steps, lists, floor items) are left out of the panel only while they are empty; a
// row that holds a value still shows. With Work on every row shows, as before.
import { act, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { objectSummary, propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { resetSpaceInfo } from '@/settings/useSpaceInfo'
import { setWorkOn } from '@/test/workOn'
import { PropertyPanel } from './PropertyPanel'

const NOTE = propertyDef({ id: 'p-note', key: 'note', name: 'Note', type: 'text' })
const TRIED = propertyDef({ id: 'p-tried', key: 'tried', name: 'Tried so far', type: 'textList' })
const QUESTIONS = propertyDef({ id: 'p-questions', key: 'questions', name: 'Open questions', type: 'textList' })
const STEPS = propertyDef({ id: 'p-steps', key: 'steps', name: 'Steps', type: 'steps' })
const FLOOR = propertyDef({ id: 'p-floor', key: 'floorItems', name: 'Floor items', type: 'floorItems' })
const TASK = typeDef({
  id: 'task',
  name: 'Task',
  basic: true,
  propertyDefinitions: [propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' }), NOTE, TRIED, QUESTIONS, STEPS, FLOOR],
})
const SUMMARY = objectSummary({ path: 'Tasks/Call the vendor.md', type: 'task', title: 'Call the vendor' })

const rowNames = () => {
  const panel = screen.getByRole('complementary', { name: 'Properties' })
  return ['Note', 'Tried so far', 'Open questions', 'Steps', 'Floor items'].filter((name) => within(panel).queryByText(name))
}

beforeEach(() => {
  resetLinkIndex()
  resetSpaceInfo()
  useLinkIndex.setState({ types: [TASK], objects: [], loaded: true })
})

describe('the work kinds with Work off (M32)', () => {
  test('test an empty work row is left out and one that holds a value still shows', () => {
    setWorkOn(false)
    render(
      <PropertyPanel
        type={TASK}
        frontmatter={{ title: 'Call the vendor', note: '', tried: ['Restarted the reader'], questions: [], steps: [] }}
        summary={SUMMARY}
        onChange={vi.fn()}
      />,
    )
    // The plain row stays though it is empty; of the work kinds only the one with a value shows.
    expect(rowNames()).toEqual(['Note', 'Tried so far'])
    expect(screen.getByDisplayValue('Restarted the reader')).toBeInTheDocument()
  })

  test('test with Work on every work row shows, and the switch moves them without a reload', () => {
    setWorkOn(true)
    render(
      <PropertyPanel
        type={TASK}
        frontmatter={{ title: 'Call the vendor', note: '', tried: ['Restarted the reader'], questions: [], steps: [] }}
        summary={SUMMARY}
        onChange={vi.fn()}
      />,
    )
    expect(rowNames()).toEqual(['Note', 'Tried so far', 'Open questions', 'Steps', 'Floor items'])
    act(() => setWorkOn(false))
    expect(rowNames()).toEqual(['Note', 'Tried so far'])
  })

  test('test a plain task (no work value at all) shows no work row with Work off', () => {
    setWorkOn(false)
    render(<PropertyPanel type={TASK} frontmatter={{ title: 'Call the vendor' }} summary={SUMMARY} onChange={vi.fn()} />)
    expect(rowNames()).toEqual(['Note'])
  })
})
