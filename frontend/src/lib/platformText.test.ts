import { afterEach, describe, expect, it, vi } from 'vitest'
import { REVEAL_LABELS, revealLabelFor, revealMenuLabel } from './platformText'

describe('platformText', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('test the reveal label follows the platform', () => {
    expect(revealLabelFor('Win32', 'Mozilla/5.0 (Windows NT 10.0)')).toBe('Reveal in Explorer')
    expect(revealLabelFor('MacIntel', 'Mozilla/5.0 (Macintosh)')).toBe('Reveal in Finder')
    expect(revealLabelFor('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)')).toBe('Show in file manager')
    expect(revealLabelFor('', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(REVEAL_LABELS.windows)
    expect(revealLabelFor('', '')).toBe(REVEAL_LABELS.other)
  })

  it('test revealMenuLabel reads navigator', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh)' })
    expect(revealMenuLabel()).toBe('Reveal in Finder')
  })
})
