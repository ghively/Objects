/**
 * M30 Task 10: the "From sources" section's bounds are M7's group container (plan "The "From sources"
 * section (our format)"), so the editor reads `<!-- group from-sources -->` as a group open, keeps the
 * option's exact text, shows the section as one grouped block and writes it back byte for byte.
 */
import { Editor as TiptapEditor } from '@tiptap/core'
import { afterEach, describe, expect, test } from 'vitest'
import { formatAnnotation, parseAnnotation } from './annotations'
import { editorExtensions, loadBody, serializeBody } from './document'

/** The Contract's example section, as T5's `distill.build_section` writes it ("\n" endings). */
const SECTION = [
  '<!-- group from-sources -->',
  '## From sources',
  '',
  '- The Payroll server at HQ. ([[Sources/APP01|APP01]])',
  '- Payroll runs on it. ([[Payroll]])',
  '',
  'Sources disagree:',
  '- IP address: 10.0.0.5 ([[Sources/APP01|APP01]]) or 10.0.0.6 ([[Old APP01 notes]]); 10.0.0.5 kept, from the newer source.',
  '',
  'Also linked: [[SRV-DB01]] (backs up to)',
  '<!-- /group -->',
  '',
].join('\n')

/** Gene's own notes below the section (a blank line separates them). */
const NOTES = '## My notes\n\nPatched on Tuesday. See [[SRV-DB01]].\n'

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

function headless(body: string): TiptapEditor {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  loadBody(editor, body)
  editors.push(editor)
  return editor
}

function count(editor: TiptapEditor, type: string): number {
  let n = 0
  editor.state.doc.descendants((node) => {
    if (node.type.name === type) n++
  })
  return n
}

describe('the From sources section in the editor', () => {
  test('the annotation parser reads the open as a group keeping the from-sources option raw', () => {
    const open = parseAnnotation('<!-- group from-sources -->\n')
    expect(open).toEqual({ type: 'open', name: 'group', options: [{ key: 'from-sources', value: true, raw: 'from-sources' }] })
    expect(formatAnnotation(open!)).toBe('<!-- group from-sources -->')
    expect(parseAnnotation('<!-- /group -->')).toEqual({ type: 'close', name: 'group', options: [] })
  })

  test('a document holding the section loads as one group and serialises back byte for byte', () => {
    const body = `${SECTION}\n${NOTES}`
    const editor = headless(body)
    expect(count(editor, 'group')).toBe(1)
    expect(serializeBody(editor)).toBe(body)
  })

  test('the section alone, and the section with a group Gene nested inside, round-trip', () => {
    expect(serializeBody(headless(SECTION))).toBe(SECTION)
    const nested = SECTION.replace('Also linked:', '<!-- group -->\nGene put this here.\n<!-- /group -->\n\nAlso linked:')
    const editor = headless(`${nested}\n${NOTES}`)
    expect(count(editor, 'group')).toBe(2)
    expect(serializeBody(editor)).toBe(`${nested}\n${NOTES}`)
  })
})
