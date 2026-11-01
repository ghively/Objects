import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from './document'
import { moveBlockTo } from './handles/dragMove'
import { turnInto, selectBlocks, deleteBlocks } from './extensions/blockSelection'
const editors: TiptapEditor[] = []
afterEach(() => { while (editors.length) editors.pop()!.destroy() })
function headless(body: string): TiptapEditor { const e = new TiptapEditor({ extensions: editorExtensions() }); loadBody(e, body); editors.push(e); return e }
function shape(e: TiptapEditor) { const out: string[] = []; e.state.doc.descendants((n, p, parent) => { if (parent?.type.name === 'doc' || ['toggle','group','columns','column','indent'].includes(parent?.type.name ?? '')) out.push(n.type.name + ':' + JSON.stringify(n.textContent).slice(0, 30)); return ['toggle','group','columns','column','indent'].includes(n.type.name) }); return out.join(' | ') }
function endOf(e: TiptapEditor, needle: string): number { let at = -1; e.state.doc.descendants((n, p) => { if (at < 0 && n.isTextblock && n.textContent.includes(needle)) { at = p + 1 + n.content.size; return false } return at < 0 }); if (at < 0) throw new Error('no ' + needle); return at }
function startOf(e: TiptapEditor, needle: string): number { let at = -1; e.state.doc.descendants((n, p) => { if (at < 0 && n.isTextblock && n.textContent.includes(needle)) { at = p + 1; return false } return at < 0 }); if (at < 0) throw new Error('no ' + needle); return at }
function topPos(e: TiptapEditor, needle: string): number { let at = -1; e.state.doc.forEach((n, o) => { if (at < 0 && n.textContent.includes(needle)) at = o }); return at }
function cursor(e: TiptapEditor, pos: number) { e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, pos))) }
function report(name: string, body: string, e: TiptapEditor) { const saved = serializeBody(e); const e2 = headless(saved); const stable = serializeBody(e2) === saved; const s1 = shape(e), s2 = shape(e2); console.log(`${name}:\n  in : ${JSON.stringify(body)}\n  out: ${JSON.stringify(saved)}\n  shape: ${s1}${s1 !== s2 ? '\n  RELOAD: ' + s2 : ''}${stable ? '' : '\n  !! UNSTABLE: ' + JSON.stringify(serializeBody(e2))}`) }

test('containers and tables', () => {
  let b = '<!-- toggle -->\nhead\n\nbody\n<!-- /toggle -->\n\nAfter\n'
  let e = headless(b); cursor(e, endOf(e, 'body')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('new')); report('enter at end of toggle body', b, e)
  e = headless(b); cursor(e, startOf(e, 'body')); selectBlocks(e, startOf(e, 'body') - 1); deleteBlocks(e); report('delete toggle body', b, e)
  e = headless(b); moveBlockTo(e, topPos(e, 'After'), 0); report('move After above toggle', b, e)
  e = headless(b); cursor(e, endOf(e, 'After')); e.view.dispatch(e.state.tr.insertText('Z')); report('edit After', b, e)
  b = '<!-- columns -->\n\na\n\n<!-- column -->\n\nb\n\n<!-- /columns -->\n'
  e = headless(b); cursor(e, endOf(e, 'b')); e.view.dispatch(e.state.tr.insertText('Z')); report('edit col 2 (blank lines inside)', b, e)
  e = headless(b); cursor(e, endOf(e, 'a')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('a2')); report('add para in col 1', b, e)
  b = '<!-- columns -->\r\na\r\n<!-- column -->\r\nb\r\n<!-- /columns -->\r\n'
  e = headless(b); cursor(e, endOf(e, 'a')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('a2')); report('CRLF add para in col 1', b, e)
  b = '<!-- group -->\n- a\n- b\n<!-- /group -->\n'
  e = headless(b); cursor(e, endOf(e, 'b')); e.commands.splitListItem('listItem'); e.view.dispatch(e.state.tr.insertText('c')); report('new list item in group', b, e)
  b = '<!-- indent -->\npara\n<!-- /indent -->\n'
  e = headless(b); cursor(e, startOf(e, 'para')); turnInto(e, 'H2'); report('turn indented para to H2', b, e)
  b = '| a | b |\n|---|---|\n| x | y |\n'
  e = headless(b); cursor(e, endOf(e, 'y')); e.view.dispatch(e.state.tr.insertText('|')); report('pipe typed in cell', b, e)
  e = headless(b); cursor(e, endOf(e, 'y')); e.commands.setHardBreak(); e.view.dispatch(e.state.tr.insertText('z')); report('hard break in cell', b, e)
  e = headless(b); cursor(e, endOf(e, 'y')); e.view.dispatch(e.state.tr.insertText('\n')); report('newline char in cell', b, e)
  e = headless(b); cursor(e, endOf(e, 'y')); e.view.dispatch(e.state.tr.insertText('`c|d`')); report('code with pipe in cell', b, e)
  e = headless(b); cursor(e, endOf(e, 'y')); e.view.dispatch(e.state.tr.insertText(' [[P|lab]]')); e.view.dispatch(e.state.tr.insertText('')); report('wikilink text with pipe in cell', b, e)
  e = headless(b); cursor(e, endOf(e, 'y')); e.commands.insertContent({ type: 'wikilink', attrs: { target: 'P', label: 'lab' } }); report('wikilink node with label in cell', b, e)
  e = headless(b); cursor(e, endOf(e, 'x')); e.commands.insertContent({ type: 'inlineMath', attrs: { text: 'a|b' } }); report('inline math with pipe in cell', b, e)
  b = '- a\n- b\n'
  e = headless(b); cursor(e, endOf(e, 'b')); e.view.dispatch(e.state.tr.insertText('\n')); report('newline char in list item', b, e)
  e = headless(b); cursor(e, endOf(e, 'b')); e.commands.setHardBreak(); e.view.dispatch(e.state.tr.insertText('cont')); report('hard break in list item', b, e)
  e = headless(b); cursor(e, endOf(e, 'b')); e.commands.setHardBreak(); e.view.dispatch(e.state.tr.insertText('- not item')); report('hard break then dash in list item', b, e)
  e = headless(b); cursor(e, endOf(e, 'b')); e.commands.setHardBreak(); e.view.dispatch(e.state.tr.insertText('    code?')); report('hard break then indent in list item', b, e)
  b = '> q\n'
  e = headless(b); cursor(e, endOf(e, 'q')); e.commands.setHardBreak(); e.view.dispatch(e.state.tr.insertText('# h')); report('hard break then # in quote', b, e)
  e = headless(b); cursor(e, endOf(e, 'q')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('p2')); report('enter in quote', b, e)
  b = 'a\n'
  e = headless(b); cursor(e, 1); e.view.dispatch(e.state.tr.insertText('> ')); report('type gt space at start', b, e)
  e = headless(b); cursor(e, 1); e.view.dispatch(e.state.tr.insertText('|')); report('type pipe at start', b, e)
  e = headless(b); cursor(e, 2); e.view.dispatch(e.state.tr.insertText('\n---')); report('newline then hr inside para', b, e)
  e = headless(b); cursor(e, 2); e.view.dispatch(e.state.tr.insertText('\n    code')); report('newline then indent inside para', b, e)
  e = headless(b); cursor(e, 2); e.view.dispatch(e.state.tr.insertText('\n| a |\n|---|\n| b |')); report('newline then table lines inside para', b, e)
  e = headless(b); cursor(e, 2); e.view.dispatch(e.state.tr.insertText('\n```')); report('newline then fence inside para', b, e)
  e = headless(b); cursor(e, 2); e.view.dispatch(e.state.tr.insertText('\n<!-- toggle -->')); report('newline then html inside para', b, e)
  e = headless(b); cursor(e, 2); e.view.dispatch(e.state.tr.insertText('\n> quote')); report('newline then quote inside para', b, e)
  e = headless(b); cursor(e, 2); e.view.dispatch(e.state.tr.insertText('\n$$\nx\n$$')); report('newline then math inside para', b, e)
  e = headless(b); cursor(e, 2); e.view.dispatch(e.state.tr.insertText('\n\nsecond')); report('double newline inside para', b, e)
  e = headless(b); cursor(e, 2); e.view.dispatch(e.state.tr.insertText('  \nhb')); report('trailing 2 spaces newline inside para', b, e)
  e = headless(b); cursor(e, 2); e.view.dispatch(e.state.tr.insertText('\\')); report('type backslash at end', b, e)
  e = headless(b); cursor(e, 2); e.view.dispatch(e.state.tr.insertText('\\\nx')); report('type backslash newline', b, e)
  e = headless(b); cursor(e, 2); e.view.dispatch(e.state.tr.insertText(' ^abc123\nmore')); report('block id then newline (id mid-para)', b, e)
  e = headless(b); cursor(e, 2); e.view.dispatch(e.state.tr.insertText('<!-- c -->')); report('inline html comment', b, e)
  b = '# H\n'
  e = headless(b); cursor(e, endOf(e, 'H')); e.view.dispatch(e.state.tr.insertText('\nline2')); report('newline char in heading', b, e)
  b = '```\ncode\n```\n'
  e = headless(b); cursor(e, endOf(e, 'code')); e.view.dispatch(e.state.tr.insertText('\n```\n')); report('fence typed inside code', b, e)
  e = headless(b); cursor(e, endOf(e, 'code')); e.view.dispatch(e.state.tr.insertText('\n````')); report('4 fence typed inside code', b, e)
  e = headless(b); cursor(e, endOf(e, 'code')); e.view.dispatch(e.state.tr.insertText('\n   ```')); report('3-space fence inside code', b, e)
  b = '~~~\ncode\n~~~\n'
  e = headless(b); cursor(e, endOf(e, 'code')); e.view.dispatch(e.state.tr.insertText('\n~~~')); report('tildes typed inside tilde code', b, e)
  e = headless(b); cursor(e, endOf(e, 'code')); e.view.dispatch(e.state.tr.insertText('\n```')); report('backticks typed inside tilde code', b, e)
  b = '$$\nx\n$$\n'
  e = headless(b); const p = topPos(e, ''); e.view.dispatch(e.state.tr.setNodeAttribute(0, 'text', 'x\n$$\ny')); report('$$ inside math text', b, e)
  e = headless(b); e.view.dispatch(e.state.tr.setNodeAttribute(0, 'text', 'x $$')); report('math text ending $$', b, e)
})
