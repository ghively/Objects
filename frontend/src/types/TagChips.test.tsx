import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import { objectSummary } from '@/test/mockApi'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { currentTarget, useTabs } from '@/nav/tabs'
import { TagChips } from './TagChips'

const tag = (title: string, color: string | null = null) => objectSummary({ path: `Tags/${title}.md`, type: 'tag', title, color })
const note = (title: string, tags: string[]) => objectSummary({ path: `Pages/${title}.md`, type: 'page', title, tags })

beforeEach(() => {
  resetLinkIndex()
  useTabs.getState().reset()
  useLinkIndex.setState({
    loaded: true,
    objects: [
      tag('Linux', 'bg-blue'),
      tag('Wifi'),
      tag('Unused'),
      note('A', ['linux', 'Wifi']),
      note('B', ['Linux']),
      { ...note('T', ['Linux']), template: 'Default' },
    ],
  })
})

describe('TagChips (polish item 16)', () => {
  test('every tag as a chip with its count, most used first', () => {
    render(<TagChips />)
    const chips = screen.getAllByTestId('tag-chip')
    expect(chips.map((c) => c.textContent)).toEqual(['Linux2', 'Wifi1', 'Unused0'])
    expect(within(chips[0]).getByText('2')).toBeInTheDocument()
  })

  test('a chip opens its tag', async () => {
    const user = userEvent.setup()
    render(<TagChips />)
    await user.click(screen.getAllByTestId('tag-chip')[1])
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Tags/Wifi.md' })
  })
})
