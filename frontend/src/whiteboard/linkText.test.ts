import { describe, expect, it } from 'vitest'
import type { ObjectSummary } from '@/api/types'
import { linkTargetFor, wikilinkFor } from './linkText'

const obj = (path: string, title: string): ObjectSummary =>
  ({ path, title, id: null, type: 'page', icon: null, iconColor: null, description: null, aliases: [], createdAt: null, lastUpdated: null, tags: [], template: null }) as unknown as ObjectSummary

describe('linkTargetFor', () => {
  it('uses a unique, link-safe title', () => {
    expect(wikilinkFor('Pages/Router A.md', undefined, [obj('Pages/Router A.md', 'Router A')])).toBe('[[Router A]]')
  })
  it('uses the path form for a title a wikilink cannot hold', () => {
    const objects = [obj('Pages/Plan draft.md', 'Plan [draft]')]
    expect(wikilinkFor('Pages/Plan draft.md', undefined, objects)).toBe('[[Pages/Plan draft]]')
    expect(linkTargetFor('Pages/A.md', 'a|b', [])).toBe('Pages/A')
    expect(linkTargetFor('Pages/A.md', 'a#b', [])).toBe('Pages/A')
  })
  it('uses the path form for a duplicate title', () => {
    const objects = [obj('Pages/Note.md', 'Note'), obj('Ideas/Note.md', 'Note')]
    expect(linkTargetFor('Ideas/Note.md', undefined, objects)).toBe('Ideas/Note')
  })
  it('falls back to the given title, or the stem, when the index lacks the object', () => {
    expect(linkTargetFor('Servers/Atlas.md', 'Atlas', [])).toBe('Atlas')
    expect(linkTargetFor('Servers/Atlas.md', undefined, [])).toBe('Atlas')
  })
})
