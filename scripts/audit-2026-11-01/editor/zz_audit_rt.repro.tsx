import { Editor as TiptapEditor } from '@tiptap/core'
import { afterEach, describe, expect, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from './document'

const editors: TiptapEditor[] = []
afterEach(() => { while (editors.length) editors.pop()!.destroy() })
function headless(body: string): TiptapEditor {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  loadBody(editor, body)
  editors.push(editor)
  return editor
}
function shape(e: TiptapEditor) { const out: string[] = []; e.state.doc.forEach((n) => out.push(n.type.name + (n.attrs.blockSource == null ? '*' : '') + ':' + JSON.stringify(n.textContent).slice(0, 40))); return out }

const CASES: Record<string, string> = {
  nested: '- a\n  - b\n    - c\n- d\n',
  mixedIndent: '- a\n   - b\n\t- c\n',
  tabs: '-\ta\n-\tb\n',
  quoteInList: '- a\n  > q\n- b\n',
  tablePipes: '| a | b |\n|---|---|\n| x \\| y | z |\n',
  tableNoOuter: 'a | b\n--|--\n1 | 2\n',
  html: '<div>\nhi\n</div>\n',
  footnote: 'Text[^1].\n\n[^1]: Note.\n',
  reflink: '[a][r]\n\n[r]: https://x.y\n',
  hardbreak: 'a  \nb\\\nc\n',
  setext: 'Title\n=====\n\nSub\n---\n',
  startN: '5. a\n6. b\n',
  tasks: '- [ ] a\n- [x] b\n  - [ ] c\n',
  math: '$$\nx^2\n$$\n\nInline $a$ here.\n',
  fm: 'Key:: value\n\n---\ntitle: x\n---\n',
  crlf: 'a\r\n\r\n- b\r\n- c\r\n',
  trailingSpaces: 'a   \n\nb \n',
  tildeFence: '~~~js\ncode\n~~~\n',
  longFence: '````\n```\ninner\n```\n````\n',
  twoAnnot: '<!-- block: align=center -->\n<!-- block: color=red -->\nPara\n',
  heading7: '####### not heading\n',
  numPara: '2024. was good\n',
  looseList: '- a\n\n- b\n',
  listPara: '- a\n\n  para\n- b\n',
  codeInList: '- a\n  ```\n  x\n  ```\n- b\n',
  emptyItems: '-\n- \n- c\n',
  nestedOrderedBullet: '1. a\n   - b\n   - c\n2. d\n',
  quoteNested: '> a\n> > b\n> c\n',
  lazyQuote: '> a\nb\n',
  entities: 'a &amp; b &lt; c &nbsp; d\n',
  autolink: '<https://x.y> and https://y.z\n',
  inlineHtml: 'a <b>bold</b> c\n',
  escapes: '\\* not a list\n\\# not heading\n',
  linkTitle: '[a](http://x "t") ![i](p.png "t")\n',
  imgAlt: '![alt](img.png)\n',
  wikilinks: '[[Page]] and [[Page|label]] and ![[Page]]\n',
  wikiEmbed: '![[Page]]\n',
  emphStar: '*a* _b_ **c** __d__ ***e***\n',
  strike: '~~a~~ ~b~\n',
  inlineCode: '`a` ``b ` c``\n',
  backslashes: 'C:\\path\\to\n',
  unicode: 'é 😀 中文 \u2028x\n',
  bareLt: 'a < b > c\n',
  hrVariants: '***\n\n___\n\n- - -\n',
  headingTrailing: '# H #\n## H2 ##\n',
  headingNoSpace: '#nospace\n',
  blockId: 'para ^abc123\n\n- item ^def456\n',
  toggle: '<!-- toggle -->\nhead\n\nbody\n<!-- /toggle -->\n',
  columns: '<!-- columns -->\na\n<!-- column -->\nb\n<!-- /columns -->\n',
  numberedParen: '1) a\n2) b\n',
  listAfterPara: 'para\n- a\n- b\n',
  deepIndentCode: '        indented code\n',
  indentedPara: '   indented\n',
  taskNoSpace: '- [ ]\n- [x]\n',
  nbsp: 'a\u00a0b\n',
  dollar: 'cost $5 and $10\n',
  mathEscaped: '\\$a\\$\n',
  noFinalNl: 'a\n\nb',
  bom: '\ufeffa\n',
  onlySpace: '\n\n\n',
  tableAlign: '| a | b |\n|:--|--:|\n| 1 | 2 |\n',
  tableEmptyCell: '| a | b |\n|---|---|\n| | 2 |\n',
  tableInline: '| a | b |\n|---|---|\n| [[x]] | `c|d` |\n',
  tableRowsUneven: '| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |\n',
  codeNoLang: '```\nx\n```\n',
  codeTrailing: '```js\nx\n\n```\n',
  codeUnclosed: '```\nx\n',
  mathInline2: '$$x$$\n',
  mathNoClose: '$$\nx\n',
  longUrlPara: 'see https://example.com/a_b_c*d\n',
  htmlComment: '<!-- note -->\ntext\n',
  listStar: '* a\n* b\n',
  listPlus: '+ a\n+ b\n',
  mixedMarkers: '- a\n* b\n',
  numberedBig: '1000000000. a\n',
  underscoreWord: 'snake_case_word\n',
  starWord: 'a*b*c\n',
  brackets: '[not a link] [x]\n',
  angleAuto: '<mailto:a@b.c>\n',
  dateToken: 'on @2026-01-01 and {{date:2026-01-01}}\n',
}

describe('audit: no-edit roundtrip', () => {
  test('all', () => {
    const diffs: string[] = []
    for (const [name, body] of Object.entries(CASES)) {
      const e = headless(body)
      const out = serializeBody(e)
      if (out !== body) diffs.push(`${name}: ${JSON.stringify(body)} -> ${JSON.stringify(out)}\n  shape=${shape(e).join(' | ')}`)
    }
    console.log('NOEDIT DIFFS:\n' + diffs.join('\n'))
    expect(true).toBe(true)
  })
  test('shapes (raw blocks)', () => {
    const raws: string[] = []
    for (const [name, body] of Object.entries(CASES)) {
      const e = headless(body)
      const s = shape(e)
      if (s.some((x) => x.startsWith('rawBlock'))) raws.push(`${name}: ${s.join(' | ')}`)
    }
    console.log('RAW BLOCKS:\n' + raws.join('\n'))
  })
  test('type into first textblock then save and reload', () => {
    const diffs: string[] = []
    for (const [name, body] of Object.entries(CASES)) {
      const e = headless(body)
      // find first textblock
      let pos = -1
      e.state.doc.descendants((n, p) => { if (pos < 0 && n.isTextblock && n.type.name !== 'rawBlock') { pos = p; return false } return pos < 0 })
      if (pos < 0) continue
      const node = e.state.doc.nodeAt(pos)!
      e.view.dispatch(e.state.tr.insertText('Z', pos + node.nodeSize - 1))
      const saved = serializeBody(e)
      const e2 = headless(saved)
      const s1 = shape(e).map((x) => x.replace('*', '')), s2 = shape(e2).map((x) => x.replace('*', ''))
      const resaved = serializeBody(e2)
      const notes: string[] = []
      if (JSON.stringify(s1) !== JSON.stringify(s2)) notes.push(`shape changed: ${s1.join(' | ')}  =>  ${s2.join(' | ')}`)
      if (resaved !== saved) notes.push(`not stable: ${JSON.stringify(saved)} -> ${JSON.stringify(resaved)}`)
      diffs.push(`${name}: ${JSON.stringify(body)} -> ${JSON.stringify(saved)}${notes.length ? '\n  !! ' + notes.join('\n  !! ') : ''}`)
    }
    console.log('EDIT RESULTS:\n' + diffs.join('\n'))
  })
})
