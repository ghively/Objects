import { Editor as TiptapEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resetAiStore, useAi } from '@/ai/store'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { objectSummary } from '@/test/mockApi'
import { editorExtensions, loadBody, serializeBody } from './document'
import { selectBlocks } from './extensions/blockSelection'
import { setEditorObject } from './nodes/blockRef'
import { AI_TEXT, aiBlockedPath, blocksSeed, openBlocksAi, openSelectionAi, selectionSeed } from './aiEntries'

const editors: TiptapEditor[] = []
beforeEach(() => {
  resetAiStore()
  resetLinkIndex()
  useSettings.setState({ settings: { ...settingsDefaults, aiHidden: false } })
})
afterEach(() => {
  while (editors.length) {
    const e = editors.pop()!
    if (!e.isDestroyed) e.destroy()
  }
  document.querySelectorAll('[data-editor-toasts]').forEach((n) => n.remove())
})

function headless(body: string): TiptapEditor {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  loadBody(editor, body)
  editors.push(editor)
  return editor
}

function blockPos(editor: TiptapEditor, i: number): number {
  let pos = 0
  for (let k = 0; k < i; k++) pos += editor.state.doc.child(k).nodeSize
  return pos
}

/** Select `text` (its first occurrence). */
function selectText(editor: TiptapEditor, text: string) {
  let from = -1
  editor.state.doc.descendants((node, pos) => {
    if (from < 0 && node.isText && node.text!.includes(text)) from = pos + node.text!.indexOf(text)
  })
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, from + text.length)))
}

/** Type `text` at the start of top-level block `i`. */
function typeAtStart(editor: TiptapEditor, i: number, text: string) {
  editor.view.dispatch(editor.state.tr.insertText(text, blockPos(editor, i) + 1))
}

const BODY = 'One\n\nTwo\n\nThree\n'

describe('AI entries: blocks', () => {
  test('the seed carries the blocks as Markdown and the object path as context', () => {
    const editor = headless('# Head\n\n- a\n- b\n\nTail\n')
    setEditorObject(editor, { path: 'Pages/Note.md' })
    selectBlocks(editor, blockPos(editor, 0), blockPos(editor, 1))
    const seed = blocksSeed(editor, 'askBlock')
    expect(seed.mode).toBe('askBlock')
    expect(seed.block).toBe('# Head\n\n- a\n- b')
    expect(seed.contextPaths).toEqual(['Pages/Note.md'])
    expect(seed.blockPath).toBe('Pages/Note.md')
    expect(typeof seed.onReplace).toBe('function')
    expect(typeof seed.onInsertBelow).toBe('function')
  })

  test('without a known path the seed leaves the context to the chat (its default)', () => {
    const editor = headless(BODY)
    editor.commands.setTextSelection(2)
    const seed = blocksSeed(editor, 'tagBlock')
    expect(seed.contextPaths).toBeUndefined()
    expect(seed.block).toBe('One')
  })

  test('openBlocksAi stores the seed for the chat panel', () => {
    const editor = headless(BODY)
    selectBlocks(editor, blockPos(editor, 1))
    openBlocksAi(editor, 'askBlock')
    expect(useAi.getState().pending?.seed).toMatchObject({ mode: 'askBlock', block: 'Two' })
  })

  test('nothing opens while AI features are hidden', () => {
    useSettings.setState({ settings: { ...settingsDefaults, aiHidden: true } })
    const editor = headless(BODY)
    selectBlocks(editor, blockPos(editor, 1))
    openBlocksAi(editor, 'askBlock')
    expect(useAi.getState().pending).toBeNull()
  })

  test('nothing opens on a page excluded from AI or a template', () => {
    useLinkIndex.setState({
      objects: [
        objectSummary({ path: 'Pages/Secret.md', tags: ['[[Exclude from AI]]'] }),
        objectSummary({ path: 'Other/Tpl.md', template: 'Tpl' }),
        objectSummary({ path: 'Pages/Open.md', tags: ['Ideas'] }),
      ],
      loaded: true,
    })
    expect(aiBlockedPath('Pages/Secret.md')).toBe(true)
    expect(aiBlockedPath('Other/Tpl.md')).toBe(true)
    expect(aiBlockedPath('Templates/Tasks/Bug report.md')).toBe(true)
    expect(aiBlockedPath('Pages/Open.md')).toBe(false)
    expect(aiBlockedPath(null)).toBe(false)
    const editor = headless(BODY)
    setEditorObject(editor, { path: 'Pages/Secret.md' })
    selectBlocks(editor, blockPos(editor, 1))
    openBlocksAi(editor, 'askBlock')
    selectText(editor, 'Two')
    openSelectionAi(editor)
    expect(useAi.getState().pending).toBeNull()
  })

  test('the range stops following edits once the seed is released or the editor is destroyed', () => {
    const listener = (editor: TiptapEditor) => {
      const on = vi.spyOn(editor, 'on')
      const off = vi.spyOn(editor, 'off')
      return () => {
        const added = on.mock.calls.find((c) => c[0] === 'transaction')?.[1]
        expect(added).toBeTypeOf('function')
        expect(off).toHaveBeenCalledWith('transaction', added)
      }
    }
    const editor = headless(BODY)
    const removed = listener(editor)
    selectBlocks(editor, blockPos(editor, 1))
    const seed = blocksSeed(editor, 'askBlock')
    seed.release!()
    removed()

    const other = headless(BODY)
    const removedOther = listener(other)
    other.commands.setTextSelection(2)
    selectText(other, 'Two')
    selectionSeed(other)
    other.destroy()
    removedOther()
  })

  test('a seed the chat never took is released when another replaces it', () => {
    const release = vi.fn()
    useAi.getState().open({ mode: 'chat', release })
    useAi.getState().open({ mode: 'chat' })
    expect(release).toHaveBeenCalledTimes(1)
  })

  test('replace puts the accepted Markdown in place of the blocks, as blocks', () => {
    const editor = headless(BODY)
    selectBlocks(editor, blockPos(editor, 1))
    const seed = blocksSeed(editor, 'askBlock')
    seed.onReplace!('## New\n\n- x\n- y')
    expect(serializeBody(editor)).toBe('One\n\n## New\n\n- x\n- y\n\nThree\n')
  })

  test('replace of several blocks, plain text as one paragraph per line', () => {
    const editor = headless(BODY)
    selectBlocks(editor, blockPos(editor, 0), blockPos(editor, 1))
    const seed = blocksSeed(editor, 'askBlock')
    seed.onReplace!('First line\nSecond line')
    expect(serializeBody(editor)).toBe('First line\n\nSecond line\n\nThree\n')
  })

  test('insert below puts the text after the blocks; the last block of the page too', () => {
    const editor = headless(BODY)
    selectBlocks(editor, blockPos(editor, 0))
    blocksSeed(editor, 'askBlock').onInsertBelow!('Added')
    expect(serializeBody(editor)).toBe('One\n\nAdded\n\nTwo\n\nThree\n')

    selectBlocks(editor, blockPos(editor, 3))
    blocksSeed(editor, 'askBlock').onInsertBelow!('**End**')
    expect(serializeBody(editor)).toBe('One\n\nAdded\n\nTwo\n\nThree\n\n**End**\n')
  })

  test('the range follows edits made after opening (mapped through later transactions)', () => {
    const editor = headless(BODY)
    selectBlocks(editor, blockPos(editor, 2))
    const seed = blocksSeed(editor, 'askBlock')
    typeAtStart(editor, 0, 'Zero ') // an edit above the block moves it
    seed.onReplace!('Replaced')
    expect(serializeBody(editor)).toBe('Zero One\n\nTwo\n\nReplaced\n')
  })

  test('a block edited since opening is left alone: replace inserts below it instead', () => {
    const editor = headless(BODY)
    selectBlocks(editor, blockPos(editor, 1))
    const seed = blocksSeed(editor, 'askBlock')
    typeAtStart(editor, 1, 'Edited ')
    seed.onReplace!('Answer')
    expect(serializeBody(editor)).toBe('One\n\nEdited Two\n\nAnswer\n\nThree\n')
  })

  test('a closed editor changes nothing and says so', () => {
    const editor = headless(BODY)
    selectBlocks(editor, blockPos(editor, 1))
    const seed = blocksSeed(editor, 'askBlock')
    editor.destroy()
    expect(() => seed.onReplace!('x')).not.toThrow()
    expect(document.querySelector('[data-editor-toasts]')?.textContent).toContain(AI_TEXT.closed)
  })

  test('empty accepted text changes nothing', () => {
    const editor = headless(BODY)
    selectBlocks(editor, blockPos(editor, 1))
    const seed = blocksSeed(editor, 'askBlock')
    seed.onReplace!('  \n ')
    seed.onInsertBelow!('')
    expect(serializeBody(editor)).toBe(BODY)
  })
})

describe('AI entries: text selection', () => {
  test('the seed carries the selected text and opens the chat mode', () => {
    const editor = headless('Hello brave world\n')
    setEditorObject(editor, { path: 'Pages/Note.md' })
    selectText(editor, 'brave')
    const seed = selectionSeed(editor)!
    expect(seed).toMatchObject({ mode: 'chat', block: 'brave', contextPaths: ['Pages/Note.md'], blockPath: 'Pages/Note.md' })
    openSelectionAi(editor)
    expect(useAi.getState().pending?.seed).toMatchObject({ mode: 'chat', block: 'brave' })
  })

  test('no seed for an empty selection', () => {
    const editor = headless('Hello\n')
    editor.commands.setTextSelection(2)
    expect(selectionSeed(editor)).toBeNull()
  })

  test('replace puts plain text in place of the selection', () => {
    const editor = headless('Hello brave world\n\nNext\n')
    selectText(editor, 'brave')
    const seed = selectionSeed(editor)!
    editor.commands.setTextSelection(1) // the editor moved on (the panel took the focus)
    seed.onReplace!('**bold** new')
    expect(serializeBody(editor)).toBe('Hello \\*\\*bold\\*\\* new world\n\nNext\n')
  })

  test('replace with several lines splits the block at the selection', () => {
    const editor = headless('Hello brave world\n')
    selectText(editor, 'brave')
    selectionSeed(editor)!.onReplace!('one\ntwo')
    expect(serializeBody(editor)).toBe('Hello one\n\ntwo world\n')
  })

  test('the selection is mapped through later edits', () => {
    const editor = headless('Hello brave world\n')
    selectText(editor, 'world')
    const seed = selectionSeed(editor)!
    editor.view.dispatch(editor.state.tr.insertText('Oh ', 1))
    seed.onReplace!('planet')
    expect(serializeBody(editor)).toBe('Oh Hello brave planet\n')
  })

  test('when the selected text changed, replace inserts a paragraph below instead', () => {
    const editor = headless('Hello brave world\n\nNext\n')
    selectText(editor, 'brave')
    const seed = selectionSeed(editor)!
    const at = editor.state.selection.from + 1
    editor.view.dispatch(editor.state.tr.insertText('X', at))
    seed.onReplace!('kind')
    expect(serializeBody(editor)).toBe('Hello bXrave world\n\nkind\n\nNext\n')
  })

  test('insert below adds a paragraph after the selection block (after a whole list)', () => {
    const editor = headless('- one\n- two\n\nAfter\n')
    selectText(editor, 'one')
    selectionSeed(editor)!.onInsertBelow!('Below')
    expect(serializeBody(editor)).toBe('- one\n- two\n\nBelow\n\nAfter\n')
  })
})
