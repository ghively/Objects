import { Editor as TiptapEditor } from '@tiptap/core'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { EditorContent } from '@tiptap/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { objectDetail, objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { editorExtensions, loadBody, serializeBody } from './document'
import { selectBlocks } from './extensions/blockSelection'
import { BlockMenu } from './handles/BlockMenu'
import { setBoardHelperForTests, turnIntoObject, turnIntoTask, turnIntoWhiteboard, turnTodoIntoTask } from './turnInto'

const mocked = vi.mocked(api)
const editors: TiptapEditor[] = []

const status = propertyDef({
  id: 'status',
  key: 'status',
  type: 'label',
  name: 'Status',
  options: {
    isStatus: true,
    set: [
      { id: 's0', text: 'Not Started', color: null, icon: null, statusCategory: 'not-started' },
      { id: 's1', text: 'Done', color: null, icon: null, statusCategory: 'done' },
    ],
  },
})
const PAGE_T = typeDef({ id: 'Page', name: 'Page', basic: true })
const TASK_T = typeDef({ id: 'Task', name: 'Task', basic: true, propertyDefinitions: [status] })

function headless(body: string): TiptapEditor {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  editors.push(editor)
  loadBody(editor, body)
  return editor
}

/** The document position just inside the first text block whose text starts with `text`. */
function caretIn(editor: TiptapEditor, text: string): number {
  let at = -1
  editor.state.doc.descendants((n, pos) => {
    if (at >= 0) return false
    if (n.isTextblock && n.textContent.startsWith(text)) {
      at = pos + 1
      return false
    }
    return true
  })
  editor.commands.setTextSelection(at)
  return at
}

beforeEach(() => {
  resetLinkIndex()
  useLinkIndex.setState({ types: [PAGE_T, TASK_T], objects: [], loaded: true })
  let n = 0
  mocked.createObject.mockImplementation(async (_typeId: string, opts: { title?: string } = {}) => ({
    path: `Pages/${opts.title}.md`,
    version: `c${++n}`,
  }))
  mocked.object.mockImplementation(async (path: string) =>
    objectDetail({ summary: objectSummary({ path }), body: '', version: 'v-loaded' }),
  )
  mocked.saveBody.mockResolvedValue({ version: 'v-saved' } as never)
})

afterEach(() => {
  cleanup()
  while (editors.length) editors.pop()!.destroy()
  setBoardHelperForTests(null)
})

describe('turn into (M8 Task 27)', () => {
  test('test turn into object creates and embeds', async () => {
    const editor = headless('Before\n\n- Parent item ^ab12cd\n  - child one\n  - child two\n- Sibling\n\nAfter\n')
    caretIn(editor, 'Parent item')
    let ok = false
    await act(async () => {
      ok = await turnIntoObject(editor, 'Page')
    })
    expect(ok).toBe(true)
    expect(mocked.createObject).toHaveBeenCalledWith('Page', { title: 'Parent item' })
    // The children became the body (dedented), saved against the loaded version.
    expect(mocked.saveBody).toHaveBeenCalledWith('Pages/Parent item.md', '- child one\n- child two\n', 'v-loaded')
    expect(serializeBody(editor)).toBe(
      'Before\n\n<!-- block: view=inline -->\n![[Parent item]]\n\n- Sibling\n\nAfter\n',
    )
  })

  test('test turn into object of a paragraph without children writes no body', async () => {
    const editor = headless('One\n\nMake me an object\n\nThree\n')
    caretIn(editor, 'Make me')
    await act(async () => {
      await turnIntoObject(editor)
    })
    expect(mocked.createObject).toHaveBeenCalledWith('Page', { title: 'Make me an object' })
    expect(mocked.saveBody).not.toHaveBeenCalled()
    expect(serializeBody(editor)).toBe('One\n\n<!-- block: view=inline -->\n![[Make me an object]]\n\nThree\n')
  })

  test('test a title shared with another object embeds by path', async () => {
    useLinkIndex.setState({ objects: [objectSummary({ path: 'Other/Dup.md', title: 'Dup' })] })
    const editor = headless('Dup\n')
    caretIn(editor, 'Dup')
    await act(async () => {
      await turnIntoObject(editor, 'Page')
    })
    expect(serializeBody(editor)).toBe('<!-- block: view=inline -->\n![[Pages/Dup]]\n')
  })

  test('test todo turns into task object', async () => {
    const editor = headless('- [x] Buy milk\n- [ ] Walk dog\n')
    caretIn(editor, 'Buy milk')
    await act(async () => {
      await turnTodoIntoTask(editor)
    })
    expect(mocked.createObject).toHaveBeenCalledWith('Task', { title: 'Buy milk', values: { status: ['Done'] } })
    expect(serializeBody(editor)).toBe('<!-- block: view=inline -->\n![[Buy milk]]\n\n- [ ] Walk dog\n')

    // An open to-do: no status value; a paragraph is not a to-do.
    mocked.createObject.mockClear()
    caretIn(editor, 'Walk dog')
    await act(async () => {
      await turnTodoIntoTask(editor)
    })
    expect(mocked.createObject).toHaveBeenCalledWith('Task', { title: 'Walk dog' })
    const plain = headless('Just text\n')
    caretIn(plain, 'Just')
    mocked.createObject.mockClear()
    expect(await turnTodoIntoTask(plain)).toBe(false)
    expect(mocked.createObject).not.toHaveBeenCalled()
  })

  test('test block menu offers turn into task object for to-dos only', async () => {
    const editor = headless('- [ ] Buy milk\n\nText\n')
    selectBlocks(editor, 0)
    const view = render(<BlockMenu editor={editor} open onOpenChange={() => {}} anchor={{ left: 0, top: 0, width: 10, height: 10 }} />)
    const names = () => within(screen.getByRole('menu')).getAllByRole('menuitem').map((m) => m.firstChild?.textContent)
    await screen.findByRole('menu')
    expect(names()).toEqual(expect.arrayContaining(['Copy block reference', 'Turn into object', 'Turn into task object', 'Turn into whiteboard']))
    view.unmount()
    selectBlocks(editor, editor.state.doc.child(0).nodeSize)
    render(<BlockMenu editor={editor} open onOpenChange={() => {}} anchor={{ left: 0, top: 0, width: 10, height: 10 }} />)
    await screen.findByRole('menu')
    expect(names()).not.toContain('Turn into task object')
  })

  test('test turn into task from any block', async () => {
    const editor = headless('Call the bank\n')
    caretIn(editor, 'Call')
    await act(async () => {
      await turnIntoTask(editor)
    })
    expect(mocked.createObject).toHaveBeenCalledWith('Task', { title: 'Call the bank' })
    expect(serializeBody(editor)).toBe('<!-- block: view=inline -->\n![[Call the bank]]\n')
  })

  test('test turn into whiteboard calls the board helper', async () => {
    const helper = vi.fn(async (_blocks: string[], _title: string) => 'Whiteboards/Plan.md')
    setBoardHelperForTests(helper)
    const editor = headless('Keep\n\nPlan\n\n- one\n- two\n\nTail\n')
    let second = 0
    editor.state.doc.forEach((_n, offset, i) => {
      if (i === 1) second = offset
    })
    let third = 0
    editor.state.doc.forEach((_n, offset, i) => {
      if (i === 2) third = offset
    })
    selectBlocks(editor, second, third)
    await act(async () => {
      await turnIntoWhiteboard(editor)
    })
    expect(helper).toHaveBeenCalledWith(['Plan', '- one\n- two'], 'Plan')
    expect(serializeBody(editor)).toBe('Keep\n\n![[Plan]]\n\nTail\n')
  })

  test('test a task embed in link block view shows the task checkbox', async () => {
    const TASK = objectSummary({ path: 'Tasks/Buy milk.md', type: 'Task', title: 'Buy milk' })
    mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE_T, TASK_T], icon: null, description: null, hideTaskManagement: false, revision: '' })
    mocked.objects.mockResolvedValue([TASK])
    useLinkIndex.setState({ objects: [TASK] })
    mocked.resolve.mockResolvedValue(TASK.path)
    mocked.rows.mockResolvedValue([row({ summary: TASK, values: { status: ['Not Started'] } })])
    const editor = new TiptapEditor({ extensions: editorExtensions() })
    editors.push(editor)
    render(
      <div data-object-path="Pages/Host.md">
        <EditorContent editor={editor} />
      </div>,
    )
    await act(async () => {
      loadBody(editor, '<!-- block: view=inline -->\n![[Buy milk]]\n')
    })
    const task = await screen.findByTestId('object-embed-task')
    await waitFor(() => expect(within(task).getByRole('checkbox')).toBeInTheDocument())
    expect(task).toHaveTextContent('Buy milk')
  })
})
