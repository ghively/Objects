// M8 Task 9: slides split at top-level H1/H2 headings and horizontal lines (our rule).
import { describe, expect, test } from 'vitest'
import { buildSlides, isSlideHeading, splitSlideBodies } from './slides'

describe('slides', () => {
  test('test slides split at top level h1 h2 and rules', () => {
    const body = [
      'Intro paragraph.',
      '',
      '# One',
      '',
      'First.',
      '',
      '### Three stays',
      '',
      'Still first.',
      '',
      '## Two',
      '',
      'Second.',
      '',
      '---',
      '',
      'After the rule.',
      '',
      '<!-- toggle -->',
      '# Inside a toggle',
      '',
      'Toggle text.',
      '<!-- /toggle -->',
      '',
      '```',
      '# not a heading',
      '---',
      '```',
      '',
      'Setext',
      '======',
      '',
      'Last.',
      '',
    ].join('\n')
    const slides = splitSlideBodies(body)
    expect(slides.map((s) => s.trim().split('\n')[0])).toEqual(['Intro paragraph.', '# One', '## Two', 'After the rule.', 'Setext'])
    expect(slides[1]).toContain('### Three stays')
    expect(slides[1]).toContain('Still first.')
    // The rule itself is dropped; a toggle and a code fence never split.
    expect(slides[2]).not.toContain('---')
    expect(slides[3]).toContain('# Inside a toggle')
    expect(slides[3]).toContain('# not a heading')
    expect(slides[4]).toContain('Last.')
  })

  test('the title slide comes first; blank slides are left out', () => {
    expect(buildSlides('')).toEqual([{ kind: 'title' }])
    expect(buildSlides('---\n\n---\n')).toEqual([{ kind: 'title' }])
    const s = buildSlides('# A\r\n\r\nText\r\n')
    expect(s).toEqual([{ kind: 'title' }, { kind: 'content', body: '# A\r\n\r\nText\r\n' }])
  })

  test('only h1 and h2 open a slide', () => {
    expect(isSlideHeading({ kind: 'heading', raw: '# A\n' })).toBe(true)
    expect(isSlideHeading({ kind: 'heading', raw: '## A\n' })).toBe(true)
    expect(isSlideHeading({ kind: 'heading', raw: '### A\n' })).toBe(false)
    expect(isSlideHeading({ kind: 'paragraph', raw: '# A\n' })).toBe(false)
  })
})
