/**
 * M32 item 4, "Markdown habits": a bare word ending in a file extension (`notes.md`, `config.py`)
 * is not turned into a web link as it is typed or pasted; real addresses still are.
 */
import { Editor as TiptapEditor } from '@tiptap/core'
import { afterEach, describe, expect, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from '../document'
import { FILE_EXTENSIONS, looksLikeFileName, shouldAutoLink } from './autoLink'

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

function fresh(): TiptapEditor {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  loadBody(editor, '')
  editor.commands.setTextSelection(1)
  editors.push(editor)
  return editor
}

/** Type `text` key by key through the editor's text-input path. */
function type(ed: TiptapEditor, text: string) {
  for (const ch of text) {
    const { from, to } = ed.state.selection
    const handled = ed.view.someProp('handleTextInput', (f) => f(ed.view, from, to, ch, () => ed.state.tr.insertText(ch, from, to)))
    if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to))
  }
}

/** The link marks in the doc: `[text, href]` per linked run. */
function links(ed: TiptapEditor): [string, string][] {
  const out: [string, string][] = []
  ed.state.doc.descendants((n) => {
    const link = n.isText ? n.marks.find((m) => m.type.name === 'link') : undefined
    if (link) out.push([n.text ?? '', String(link.attrs.href)])
  })
  return out
}

describe('file names are not web links (M32)', () => {
  test.each(['notes.md', 'config.py', 'run.sh', 'main.rs', 'README.md', 'archive.zip', 'clip.mov', 'lib.cc', 'deploy.pl', 'backup.tar.gz', 'notes.2026.md'])(
    'test "%s" is a file name',
    (word) => {
      expect(looksLikeFileName(word)).toBe(true)
      expect(shouldAutoLink(word)).toBe(false)
    },
  )

  test.each([
    'example.com',
    'www.example.com',
    'www.notes.md',
    'https://example.com',
    'https://example.com/notes.md',
    'http://docs.rs',
    'docs.rs/serde',
    'example.py/path',
    'example.md?x=1',
    'gov.uk',
    'notion.so',
    'github.io',
    'me@example.md',
    'mailto:me@example.com',
  ])('test "%s" is a real address', (address) => {
    expect(looksLikeFileName(address)).toBe(false)
    expect(shouldAutoLink(address)).toBe(true)
  })

  test('test words that are no address at all stay unlinked, as before', () => {
    expect(shouldAutoLink('localhost')).toBe(false)
    expect(shouldAutoLink('192.168.1.1')).toBe(false)
  })

  test('test the list holds the extensions that are also web endings', () => {
    for (const ext of ['md', 'py', 'sh', 'rs', 'pl', 'cc', 'zip', 'mov', 'ts', 'json']) expect(FILE_EXTENSIONS.has(ext), ext).toBe(true)
    // Endings people type as real sites stay links.
    for (const ext of ['com', 'org', 'net', 'io', 'so', 'ai', 'app', 'dev', 'me', 'co', 'uk']) expect(FILE_EXTENSIONS.has(ext), ext).toBe(false)
  })

  test('test typing a file name does not make a link', () => {
    for (const word of ['notes.md', 'config.py', 'data.json', 'run.sh', 'main.rs', 'index.ts']) {
      const ed = fresh()
      type(ed, `see ${word} for more`)
      expect(links(ed), word).toEqual([])
      expect(serializeBody(ed)).toBe(`see ${word} for more`)
    }
  })

  test('test typing a real address still makes a link', () => {
    const plain = fresh()
    type(plain, 'see example.com for more')
    expect(links(plain)).toEqual([['example.com', 'http://example.com']])
    const full = fresh()
    type(full, 'see https://example.com/notes.md for more')
    expect(links(full)).toEqual([['https://example.com/notes.md', 'https://example.com/notes.md']])
    const www = fresh()
    type(www, 'see www.example.md for more')
    expect(links(www)).toEqual([['www.example.md', 'http://www.example.md']])
  })

  test('test a file name inside a path is not linked either', () => {
    const ed = fresh()
    type(ed, 'open src/config.py now')
    expect(links(ed)).toEqual([])
  })

  test('test pasted text links its addresses but not its file names', () => {
    const ed = fresh()
    ed.commands.insertContent('read notes.md then example.org ')
    expect(links(ed)).toEqual([['example.org', 'http://example.org']])
  })
})
