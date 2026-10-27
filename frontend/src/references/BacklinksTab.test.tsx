import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { HighlightedContext } from './BacklinksTab'

describe('HighlightedContext', () => {
  test('offsets are code points, so an emoji before the match does not shift the bold', () => {
    const { container } = render(<HighlightedContext context="🚀 see Ada here" start={6} end={9} />)
    expect(container.querySelector('b')?.textContent).toBe('Ada')
    expect(container.textContent).toBe('🚀 see Ada here')
  })
})
