import { Editor as TiptapEditor } from '@tiptap/core'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { editorExtensions, loadBody } from '../document'
import { setEditorObject } from '../nodes/blockRef'
import { csvField, csvFilename, exportTableCsv, tableToCsv, toCsv } from './csv'
import { tableAt } from './tableCommands'

const editors: TiptapEditor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
  vi.restoreAllMocks()
})

function tablePos(editor: TiptapEditor): number {
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.type.name === 'table') at = pos
    return at < 0
  })
  return at
}

describe('csv', () => {
  test('test csv quoting', () => {
    expect(csvField('plain')).toBe('plain')
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('two\nlines')).toBe('"two\nlines"')
    expect(csvField('cr\rhere')).toBe('"cr\rhere"')
    expect(csvField('')).toBe('')
    expect(toCsv([['a', 'b,c'], ['"q"', '']])).toBe('a,"b,c"\r\n"""q""",')

    // A table exports its cells as shown: formulas as values, links as their labels.
    const editor = new TiptapEditor({ extensions: editorExtensions() })
    editors.push(editor)
    const body = [
      '| Name | Qty | Note |',
      '| --- | --- | --- |',
      '| [[Apple Pie]] | 2 | sweet, "best" |',
      '| [[Pear]] | 3 | `x` |',
      '| Total | =SUM(B2:B3) | =1/0 |',
      '',
    ].join('\n')
    loadBody(editor, body)
    const table = tableAt(editor.state.doc, tablePos(editor))!
    expect(tableToCsv(table)).toBe(
      ['Name,Qty,Note', 'Apple Pie,2,"sweet, ""best"""', 'Pear,3,x', 'Total,5,Value'].join('\r\n'),
    )

    expect(csvFilename('Q3 / plan: "draft"')).toBe('Q3 _ plan_ _draft_.csv')
    expect(csvFilename('')).toBe('Table.csv')
    expect(csvFilename(null)).toBe('Table.csv')

    // "Export as CSV" downloads <object title>.csv.
    setEditorObject(editor, { path: 'Notes/Budget.md', title: 'Budget 2026' })
    const created: Blob[] = []
    const url = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      created.push(b as Blob)
      return 'blob:csv'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    let downloaded = ''
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloaded = this.download
    })
    expect(exportTableCsv(editor, tablePos(editor))).toBe(true)
    expect(url).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(downloaded).toBe('Budget 2026.csv')
    expect(created[0].type).toBe('text/csv;charset=utf-8')
  })
})
