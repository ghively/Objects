/**
 * M31 item 10: an inline `#tag` in a paragraph renders as a coloured chip. The chip is a
 * decoration only: the document keeps the plain `#tag` text, so a body with tags saves back
 * byte for byte. Not a tag: code (blocks and inline), link text and URLs (`#anchor`), a bare
 * `#`, a heading's `# ` marker, `C#` (no boundary before it) and `#123` (digits only, as the
 * importer's `inline_tags`).
 */
import { Editor as TiptapEditor } from '@tiptap/core'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ObjectSummary } from '@/api/types'
import { useLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { editorExtensions, loadBody, serializeBody } from './document'
import { findInlineTags, INLINE_TAG_CLASS, inlineTagDecorations, openInlineTag } from './extensions/inlineTag'

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
  useLinkIndex.setState({ objects: [], types: [], loaded: false, revision: 0 })
  vi.restoreAllMocks()
})

function headless(body: string): TiptapEditor {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  loadBody(editor, body)
  editors.push(editor)
  return editor
}

function tag(title: string, color: string | null, path = `Tags/${title}.md`): ObjectSummary {
  return { path, id: `id-${title}`, title, type: 'tag', tags: [], color } as unknown as ObjectSummary
}

/** The tags the editor decorates, by the text they cover. */
function chips(editor: TiptapEditor): { text: string; name: string; style: string }[] {
  const set = inlineTagDecorations(editor.state)
  return set.find().map((d) => {
    const spec = (d as unknown as { type: { attrs: Record<string, string> } }).type.attrs
    return { text: editor.state.doc.textBetween(d.from, d.to), name: spec['data-inline-tag'], style: spec.style ?? '' }
  })
}

describe('findInlineTags', () => {
  test('finds a tag at the start, after a space, a bracket or a comma', () => {
    expect(findInlineTags('#work and #home, (#later),#next').map((t) => t.name)).toEqual(['work', 'home', 'later', 'next'])
    const [t] = findInlineTags('see #project/alpha now')
    expect(t).toEqual({ from: 4, to: 18, name: 'project/alpha' })
  })

  test('punctuation ends a tag; unicode letters and - _ / stay in it', () => {
    expect(findInlineTags('#done. #to-do! #a_b? #café').map((t) => t.name)).toEqual(['done', 'to-do', 'a_b', 'café'])
  })

  test('not a tag: a bare #, digits only, a word before it, a heading marker, a URL anchor', () => {
    expect(findInlineTags('# heading')).toEqual([])
    expect(findInlineTags('a # b ## c')).toEqual([])
    expect(findInlineTags('issue #123 and #2024-11')).toEqual([])
    expect(findInlineTags('C# and F#sharp')).toEqual([])
    expect(findInlineTags('https://example.com/page#anchor')).toEqual([])
    expect(findInlineTags('#v2 is fine').map((t) => t.name)).toEqual(['v2'])
  })
})

describe('inline tag decorations', () => {
  test('a tag in a paragraph, a heading, a list item and a quote is a chip', () => {
    const ed = headless('Plan #work today\n\n## Notes #idea\n\n- buy #home\n\n> said #quote\n')
    expect(chips(ed).map((c) => c.text)).toEqual(['#work', '#idea', '#home', '#quote'])
    expect(chips(ed)[0].name).toBe('work')
  })

  test('code blocks, inline code, link text and autolinked URLs hold no chips', () => {
    const body = [
      '```',
      '#notatag in code',
      '```',
      '',
      'Inline `#code` here',
      '',
      'A [#linked](https://example.com) label and <https://example.com/x#anchor>',
      '',
      'Page https://example.com/a#b end',
      '',
      '# Heading',
      '',
      'real #one',
      '',
    ].join('\n')
    const ed = headless(body)
    expect(chips(ed).map((c) => c.text)).toEqual(['#one'])
  })

  test('a tag stops at inline code and at a wikilink', () => {
    const ed = headless('#ab`cd` and #x[[Target]]\n')
    expect(chips(ed).map((c) => c.text)).toEqual(['#ab', '#x'])
  })

  test("a Tag object's colour colours the chip; an unknown tag is neutral (gray)", () => {
    useLinkIndex.setState({ objects: [tag('Work', 'bg-teal')], loaded: true, revision: 1 })
    const ed = headless('#work and #other\n')
    const [work, other] = chips(ed)
    expect(work.style).toContain('--tag-bg-teal')
    expect(work.style).toContain('--tag-text-teal')
    expect(other.style).toContain('--tag-bg-gray')
  })

  test('the chips repaint when the link index changes (a tag created or recoloured)', () => {
    const ed = headless('#work\n')
    expect(chips(ed)[0].style).toContain('--tag-bg-gray')
    useLinkIndex.setState({ objects: [tag('work', 'purple')], loaded: true, revision: 2 })
    expect(chips(ed)[0].style).toContain('--tag-bg-purple')
  })

  test('typing a tag makes a chip, and the chip follows edits elsewhere', () => {
    const ed = headless('First line\n\nSecond\n')
    ed.commands.setTextSelection(ed.state.doc.child(0).nodeSize - 1)
    ed.commands.insertContent(' #new')
    expect(chips(ed).map((c) => c.text)).toEqual(['#new'])
    ed.commands.setTextSelection(1)
    ed.commands.insertContent('XY ')
    expect(chips(ed).map((c) => c.text)).toEqual(['#new'])
  })

  test('the chip has the inline-tag class', () => {
    const ed = headless('#work\n')
    const d = inlineTagDecorations(ed.state).find()[0] as unknown as { type: { attrs: Record<string, string> } }
    expect(d.type.attrs.class).toBe(INLINE_TAG_CLASS)
  })
})

describe('inline tags round-trip', () => {
  test('a body with tags loads and saves back byte for byte (LF, CRLF and a BOM)', () => {
    const bodies = [
      'Plan #work today, see #project/alpha.\n\n## Notes #idea\n\n- [ ] call #home\n- #a and #b\n\nissue #123 C# https://x.y/#z\n',
      '﻿First #one\r\n\r\n> quoted #two\r\n\r\n`#code` #three\r\n',
      '#start of the body with no final newline #end',
    ]
    for (const body of bodies) {
      const ed = headless(body)
      expect(serializeBody(ed), JSON.stringify(body)).toBe(body)
    }
  })

  test('a typed tag saves as plain #tag text (no escape, no new syntax)', () => {
    const ed = headless('Hello\n')
    ed.commands.setTextSelection(ed.state.doc.child(0).nodeSize - 1)
    ed.commands.insertContent(' #fresh')
    expect(serializeBody(ed)).toBe('Hello #fresh\n')
  })
})

describe('opening a chip', () => {
  test('a tag with a Tag object opens it in the peek (Ctrl: a new tab; Shift: the side panel)', () => {
    useLinkIndex.setState({ objects: [tag('Work', 'teal', 'Tags/Work.md')], loaded: true, revision: 1 })
    const peek = vi.spyOn(usePeek.getState(), 'peek').mockImplementation(() => undefined)
    const open = vi.spyOn(useTabs.getState(), 'open').mockImplementation(() => undefined)
    const side = vi.spyOn(useTabs.getState(), 'openInSidepanel').mockImplementation(() => undefined)
    openInlineTag('work', {})
    expect(peek).toHaveBeenCalledWith('Tags/Work.md')
    openInlineTag('work', { ctrlKey: true })
    expect(open).toHaveBeenCalledWith({ kind: 'object', path: 'Tags/Work.md' }, { newTab: true, via: 'link' })
    openInlineTag('work', { shiftKey: true })
    expect(side).toHaveBeenCalledWith({ kind: 'object', path: 'Tags/Work.md' })
  })

  test('a tag with no Tag object opens a search for it in a new tab (nothing is created)', () => {
    const open = vi.spyOn(useTabs.getState(), 'open').mockImplementation(() => undefined)
    openInlineTag('later', {})
    expect(open).toHaveBeenCalledWith({ kind: 'search', q: '#later' }, { newTab: true })
  })
})
