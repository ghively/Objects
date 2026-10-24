import { Editor as TiptapEditor } from '@tiptap/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ObjectSummary } from '@/api/types'
import { objectSummary } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { editorExtensions, loadBody, serializeBody } from '@/editor/document'
import { fuzzyMatch, installLinkPicker, LinkPicker, useLinkPicker } from './LinkPicker'
import { resetLinkIndex } from './linkIndex'

const mocked = vi.mocked(api)

function s(title: string, path = `Pages/${title}.md`): ObjectSummary {
  return objectSummary({ path, type: 'page', title })
}

const OBJECTS = [s('Ada Lovelace', 'People/Ada Lovelace.md'), s('Alpha'), s('Fix printer'), s('Database backups')]

describe('fuzzyMatch', () => {
  test('prefers prefix and word-start matches, drops non-matches', () => {
    expect(fuzzyMatch('al', OBJECTS).map((o) => o.title)).toEqual(['Alpha', 'Ada Lovelace'])
    expect(fuzzyMatch('fp', OBJECTS).map((o) => o.title)).toEqual(['Fix printer'])
    expect(fuzzyMatch('zzz', OBJECTS)).toEqual([])
    expect(fuzzyMatch('', OBJECTS)).toHaveLength(4)
  })
})

describe('[[ trigger', () => {
  let editor: TiptapEditor

  beforeEach(() => {
    resetLinkIndex()
    mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [] })
    mocked.objects.mockResolvedValue(OBJECTS)
    mocked.resolve.mockResolvedValue(null)
    installLinkPicker()
    editor = new TiptapEditor({ extensions: editorExtensions() })
    loadBody(editor, 'Hello \n')
  })

  afterEach(() => {
    editor.destroy()
    useLinkPicker.getState().hide()
  })

  test('typing [[ opens the picker and choosing inserts [[Title]]', async () => {
    const view = editor.view
    const end = editor.state.doc.firstChild!.nodeSize - 1
    editor.commands.insertContentAt(end, '[')
    const at = end + 1
    const handled = view.someProp('handleTextInput', (f) => f(view, at, at, '[', () => view.state.tr))
    expect(handled).toBeFalsy()
    editor.commands.insertContentAt(at, '[')

    await waitFor(() => expect(useLinkPicker.getState().range).toEqual({ from: end, to: end + 2 }))

    render(<LinkPicker />)
    const input = await screen.findByRole('textbox', { name: 'Search objects' })
    await screen.findByText('Ada Lovelace')
    fireEvent.change(input, { target: { value: 'ada' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(useLinkPicker.getState().range).toBeNull()
    expect(serializeBody(editor)).toBe('Hello [[Ada Lovelace]]\n')
  })
})
