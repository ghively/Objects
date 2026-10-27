import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { Highlight, MatchedTitle, splitHighlights, splitTitle } from './Highlight'

describe('splitHighlights', () => {
  test('splits on U+0002/U+0003', () => {
    expect(splitHighlights('a \u0002cafe\u0003 b')).toEqual([
      { text: 'a ', hit: false },
      { text: 'cafe', hit: true },
      { text: ' b', hit: false },
    ])
    expect(splitHighlights('\u0002open')).toEqual([{ text: 'open', hit: true }])
    expect(splitHighlights('')).toEqual([])
  })
})

describe('Highlight', () => {
  test('renders matches in <b> inside .search-highlights and never parses HTML', () => {
    const { container } = render(<Highlight text={'x <img src=y onerror=alert(1)> \u0002hit\u0003 <b>no</b>'} />)
    const span = container.querySelector('.search-highlights')!
    expect(span).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()
    const bold = span.querySelectorAll('b')
    expect(bold).toHaveLength(1)
    expect(bold[0].textContent).toBe('hit')
    expect(span.textContent).toBe('x <img src=y onerror=alert(1)> hit <b>no</b>')
  })
})

describe('MatchedTitle', () => {
  test('bolds title spans, clamped and merged', () => {
    expect(splitTitle('Alpha Beta', [[6, 8], [0, 2], [1, 3], [9, 99]])).toEqual([
      { text: 'Alp', hit: true },
      { text: 'ha ', hit: false },
      { text: 'Be', hit: true },
      { text: 't', hit: false },
      { text: 'a', hit: true },
    ])
    const { container } = render(<MatchedTitle title="Alpha" matches={[[0, 3]]} />)
    expect(container.querySelector('b')?.textContent).toBe('Alp')
    expect(container.textContent).toBe('Alpha')
  })
})
