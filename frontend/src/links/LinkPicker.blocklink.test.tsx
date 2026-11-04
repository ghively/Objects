// "Always create inline links" (`DeviceSettings.alwaysCreateInlineLinks`): without it, linking at
// the start of an empty block makes an object block; with it, always an inline link.
import { Editor as TiptapEditor } from '@tiptap/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { objectSummary } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { editorExtensions, loadBody, serializeBody } from '@/editor/document'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { installLinkPicker, LinkPicker, useLinkPicker } from './LinkPicker'
import { resetLinkIndex } from './linkIndex'

const mocked = vi.mocked(api)
const ADA = objectSummary({ path: 'People/Ada Lovelace.md', type: 'page', title: 'Ada Lovelace' })

describe('@ at the start of an empty block', () => {
  let editor: TiptapEditor

  beforeEach(() => {
    resetLinkIndex()
    mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [] })
    mocked.objects.mockResolvedValue([ADA])
    mocked.resolve.mockResolvedValue(null)
    installLinkPicker()
    editor = new TiptapEditor({ extensions: editorExtensions() })
  })

  afterEach(() => {
    editor.destroy()
    useLinkPicker.getState().hide()
    useSettings.setState({ settings: settingsDefaults })
  })

  /** Type `@` at the end of the second paragraph (`before` is its text) and pick Ada. */
  async function linkAda(before: string) {
    loadBody(editor, 'Intro\n')
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph', content: before ? [{ type: 'text', text: before }] : [] })
    expect(editor.state.doc.childCount).toBe(2)
    const view = editor.view
    const end = editor.state.doc.content.size - 1
    editor.commands.insertContentAt(end, '@')
    view.someProp('handleTextInput', (f) => f(view, end, end, '@', () => view.state.tr))
    await new Promise((r) => setTimeout(r, 20))
    expect(useLinkPicker.getState().range).toEqual({ from: end, to: end + 1 })
    render(<LinkPicker />)
    const input = await screen.findByRole('textbox', { name: 'Search objects' })
    await screen.findByText('Ada Lovelace')
    fireEvent.change(input, { target: { value: 'ada' } })
    fireEvent.keyDown(input, { key: 'Enter' })
  }

  test('test linking in an empty block makes an object block', async () => {
    await linkAda('')
    expect(editor.state.doc.child(1).type.name).toBe('objectEmbed')
    expect(serializeBody(editor)).toBe('Intro\n\n![[Ada Lovelace]]\n')
  })

  test('test with always create inline links it stays an inline link', async () => {
    useSettings.setState({ settings: { ...settingsDefaults, alwaysCreateInlineLinks: true } })
    await linkAda('')
    expect(editor.state.doc.child(1).type.name).toBe('paragraph')
    expect(serializeBody(editor)).toBe('Intro\n\n[[Ada Lovelace]]\n')
  })

  test('test linking after text is always inline', async () => {
    await linkAda('See ')
    expect(serializeBody(editor)).toBe('Intro\n\nSee [[Ada Lovelace]]\n')
  })
})
