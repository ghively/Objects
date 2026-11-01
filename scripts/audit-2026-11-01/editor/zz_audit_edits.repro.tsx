import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection, NodeSelection } from '@tiptap/pm/state'
import { afterEach, test } from 'vitest'
import { editorExtensions, loadBody, serializeBody } from './document'
import { turnInto, duplicateBlocks, selectBlocks } from './extensions/blockSelection'
import { moveBlockTo } from './handles/dragMove'
const editors: TiptapEditor[] = []
afterEach(() => { while (editors.length) editors.pop()!.destroy() })
function headless(body: string, opts?: any): TiptapEditor { const e = new TiptapEditor({ extensions: editorExtensions(opts) }); loadBody(e, body); editors.push(e); return e }
function shape(e: TiptapEditor) { const out: string[] = []; e.state.doc.forEach((n) => out.push(n.type.name + ':' + JSON.stringify(n.textContent).slice(0, 50))); return out.join(' | ') }
function endOf(e: TiptapEditor, needle: string): number { let at = -1; e.state.doc.descendants((n, p) => { if (at < 0 && n.isTextblock && n.textContent.includes(needle)) { at = p + 1 + n.content.size; return false } return at < 0 }); if (at < 0) throw new Error('no ' + needle); return at }
function startOf(e: TiptapEditor, needle: string): number { let at = -1; e.state.doc.descendants((n, p) => { if (at < 0 && n.isTextblock && n.textContent.includes(needle)) { at = p + 1; return false } return at < 0 }); if (at < 0) throw new Error('no ' + needle); return at }
function topPos(e: TiptapEditor, needle: string): number { let at = -1; e.state.doc.forEach((n, o) => { if (at < 0 && n.textContent.includes(needle)) at = o }); return at }
function cursor(e: TiptapEditor, pos: number) { e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, pos))) }
function report(name: string, body: string, e: TiptapEditor) { const saved = serializeBody(e); const e2 = headless(saved); const stable = serializeBody(e2) === saved; console.log(`${name}:\n  in : ${JSON.stringify(body)}\n  out: ${JSON.stringify(saved)}\n  shape: ${shape(e)}\n  reload: ${shape(e2)}${stable ? '' : '\n  !! UNSTABLE: ' + JSON.stringify(serializeBody(e2))}`) }

test('undo after reload', () => {
  const e = headless('Alpha\n\nBeta\n')
  e.view.dispatch(e.state.tr.insertText('X', endOf(e, 'Alpha')))
  loadBody(e, 'Gamma\n\nDelta\n')
  console.log('before undo:', shape(e))
  e.commands.undo()
  console.log('after undo:', shape(e), JSON.stringify(serializeBody(e)))
})

test('CRLF structures edited', () => {
  const cases: [string, string, string][] = [
    ['crlf list item 2', '- a\r\n- b\r\n- c\r\n', 'b'],
    ['crlf table', '| a | b |\r\n|---|---|\r\n| 1 | 2 |\r\n', '1'],
    ['crlf code', '```\r\nx\r\ny\r\n```\r\n', 'y'],
    ['crlf quote', '> a\r\n> b\r\n', 'b'],
    ['crlf toggle', '<!-- toggle -->\r\nhead\r\n\r\nbody\r\n<!-- /toggle -->\r\n', 'body'],
    ['crlf nested list', '- a\r\n  - b\r\n- c\r\n', 'b'],
    ['crlf para multi', 'line1\r\nline2\r\nline3\r\n', 'line2'],
  ]
  for (const [name, body, needle] of cases) { const e = headless(body); e.view.dispatch(e.state.tr.insertText('Z', endOf(e, needle))); report(name, body, e) }
})

test('Enter at end of list item, Enter in middle of paragraph, Backspace at block start', () => {
  let e = headless('- a\n- b\n\nPara\n'); cursor(e, endOf(e, 'b')); e.commands.splitListItem('listItem'); e.view.dispatch(e.state.tr.insertText('new')); report('enter after b', '- a\n- b\n\nPara\n', e)
  e = headless('First line\n\nSecond\n'); cursor(e, startOf(e, 'First') + 5); e.commands.splitBlock(); report('split paragraph', 'First line\n\nSecond\n', e)
  e = headless('# Head\nPara\n'); cursor(e, startOf(e, 'Para')); e.commands.joinBackward(); report('backspace at para start after heading', '# Head\nPara\n', e)
  e = headless('A\n\nB\n'); cursor(e, startOf(e, 'B')); e.commands.joinBackward(); report('join B into A', 'A\n\nB\n', e)
  e = headless('- a\n- b\n- c\n'); cursor(e, startOf(e, 'a')); e.commands.deleteRange({ from: startOf(e, 'a') - 2, to: endOf(e, 'a') + 2 }); report('delete first item', '- a\n- b\n- c\n', e)
  e = headless('1. a\n2. b\n3. c\n'); const p = topPos(e, 'a'); const list = e.state.doc.nodeAt(p)!; const item = list.firstChild!; e.view.dispatch(e.state.tr.delete(p + 1, p + 1 + item.nodeSize)); report('delete first ordered item', '1. a\n2. b\n3. c\n', e)
  e = headless('3. a\n4. b\n5. c\n'); const p2 = topPos(e, 'a'); const list2 = e.state.doc.nodeAt(p2)!; e.view.dispatch(e.state.tr.delete(p2 + 1, p2 + 1 + list2.firstChild!.nodeSize)); report('delete first ordered item start 3', '3. a\n4. b\n5. c\n', e)
  e = headless('Para one\n\nPara two\n'); cursor(e, endOf(e, 'one')); e.commands.setHardBreak(); e.view.dispatch(e.state.tr.insertText('more')); report('shift-enter', 'Para one\n\nPara two\n', e)
  e = headless('line a\nline b\n\nX\n'); cursor(e, startOf(e, 'line a')); turnInto(e, 'H2'); report('turn multi-line para into H2', 'line a\nline b\n\nX\n', e)
  e = headless('- a\n- b\n\nX\n'); cursor(e, startOf(e, 'a')); turnInto(e, 'text'); report('turn list into text', '- a\n- b\n\nX\n', e)
  e = headless('para ^abc123\n\nX\n'); selectBlocks(e, 0); duplicateBlocks(e); report('duplicate block with id', 'para ^abc123\n\nX\n', e)
  e = headless('A\n\nB\n\nC\n'); moveBlockTo(e, topPos(e, 'C'), 0); report('drag C to top', 'A\n\nB\n\nC\n', e)
  e = headless('# H\nA\n\nB\n'); moveBlockTo(e, topPos(e, 'B'), topPos(e, 'A')); report('drag B before A (after heading, no blank)', '# H\nA\n\nB\n', e)
  e = headless('A\n\n- x\n- y\n'); moveBlockTo(e, topPos(e, 'x'), 0); report('drag list above para', 'A\n\n- x\n- y\n', e)
  e = headless('```\ncode\n```\nPara\n'); moveBlockTo(e, topPos(e, 'Para'), 0); report('drag para above code', '```\ncode\n```\nPara\n', e)
  e = headless('- a\n  - b\n- c\n'); cursor(e, startOf(e, 'b')); e.commands.liftListItem('listItem'); report('outdent b', '- a\n  - b\n- c\n', e)
  e = headless('- a\n- b\n- c\n'); cursor(e, startOf(e, 'b')); e.commands.sinkListItem('listItem'); report('indent b', '- a\n- b\n- c\n', e)
  e = headless('- a\n- b\n- c\n'); cursor(e, startOf(e, 'c')); e.commands.sinkListItem('listItem'); report('indent c (last)', '- a\n- b\n- c\n', e)
  e = headless('- [ ] a\n- [ ] b\n'); cursor(e, startOf(e, 'a')); e.commands.toggleTaskList?.(); report('toggle tasklist off', '- [ ] a\n- [ ] b\n', e)
  e = headless('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n'); cursor(e, startOf(e, '1')); e.commands.addRowAfter(); report('add table row', '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n', e)
  e = headless('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n'); cursor(e, startOf(e, '1')); e.commands.deleteRow(); report('delete table row', '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n', e)
  e = headless('|a|b|\n|-|-|\n|1|2|\n'); cursor(e, startOf(e, '1')); e.commands.addColumnAfter(); report('add column compact table', '|a|b|\n|-|-|\n|1|2|\n', e)
  e = headless('Text\n\n$$\nx\n$$\n'); cursor(e, endOf(e, 'Text')); e.view.dispatch(e.state.tr.insertText('Z')); report('edit before math', 'Text\n\n$$\nx\n$$\n', e)
  e = headless('<!-- block: align=center -->\nPara\n\nNext\n'); cursor(e, startOf(e, 'Para')); turnInto(e, 'H1'); report('turn annotated para into H1', '<!-- block: align=center -->\nPara\n\nNext\n', e)
  e = headless('<!-- block: align=center -->\nPara\n\nNext\n'); cursor(e, startOf(e, 'Para')); turnInto(e, 'code'); report('turn annotated para into code', '<!-- block: align=center -->\nPara\n\nNext\n', e)
  e = headless('> quote\n\nNext\n'); cursor(e, startOf(e, 'quote')); turnInto(e, 'text'); report('quote to text', '> quote\n\nNext\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('# not heading')); report('type # at new para', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('| a | b |')); report('type pipes at new para', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('<div>hi</div>')); report('type html at new para', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('Key:: value')); report('type field line', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('<!-- toggle -->')); report('type container open line', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('[^1]: footnote')); report('type footnote def', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('```')); report('type fence', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('    four spaces')); report('type 4-space indent', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('\tTabbed')); report('type tab indent', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('~~~')); report('type tildes', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('***')); report('type stars', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('___')); report('type underscores', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('> quoted')); report('type gt', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('+ plus')); report('type plus', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('[[Page]] text ^abc123')); report('type trailing block id', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('![[Embed]]')); report('type embed line', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('![alt](img.png)')); report('type image line', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('$$x$$')); report('type math line', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('<https://x.y>')); report('type autolink', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('a <b>bold</b> c')); report('type inline html', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('a < b > c')); report('type lt gt', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('a &amp; b')); report('type entity', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('line1\nline2')); report('insertText with newline', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('Trailing spaces   ')); report('type trailing spaces', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('<!-- /toggle -->')); report('type close line', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('<!-- column -->')); report('type separator', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('<!-- block: align=center -->')); report('type annotation', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('---')); report('type hr', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('Title\n===')); report('type setext', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('[x]: http://y')); report('type ref def', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('- [ ] not a task')); report('type task syntax', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('1) paren')); report('type paren ordered', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('cost $5 and $10 and $$ double')); report('type dollars', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('@2026-01-01 date')); report('type date token text', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('a b')); report('type nbsp', 'a\n\nb\n', e)
  e = headless('a\n\nb\n'); cursor(e, endOf(e, 'b')); e.commands.splitBlock(); e.view.dispatch(e.state.tr.insertText('line sep')); report('type U+2028', 'a\n\nb\n', e)
})

test('heading edits', () => {
  let e = headless('# Head\n\nPara\n'); cursor(e, endOf(e, 'Head')); e.commands.setHardBreak(); e.view.dispatch(e.state.tr.insertText('two')); report('shift-enter in heading', '# Head\n\nPara\n', e)
  e = headless('Head\n====\n\nPara\n'); cursor(e, endOf(e, 'Head')); e.view.dispatch(e.state.tr.insertText('Z')); report('edit setext', 'Head\n====\n\nPara\n', e)
  e = headless('## Head ##\n\nPara\n'); cursor(e, endOf(e, 'Head')); e.view.dispatch(e.state.tr.insertText(' #')); report('type hash at heading end', '## Head ##\n\nPara\n', e)
})
