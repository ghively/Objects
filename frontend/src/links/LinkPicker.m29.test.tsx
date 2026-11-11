// M29 Task 9: the `[[` / `@` picker's create rows: "New '<q>'" of the suggested type, then
// "Other types"; picking creates the object (no templateId), links it and sets the last type.
import { Editor as TiptapEditor } from '@tiptap/core'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { setLastTypeSpace, useLastType } from '@/create/lastType'
import { editorExtensions, loadBody, serializeBody } from '@/editor/document'
import { useRecent } from '@/nav/recent'
import { useTabs } from '@/nav/tabs'
import { installLinkPicker, LinkPicker, useLinkPicker } from './LinkPicker'
import { resetLinkIndex } from './linkIndex'

const mocked = vi.mocked(api)

const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true })
const HOST = typeDef({
  id: 'host',
  name: 'Host',
  pluralName: 'Hosts',
  namePatterns: ['{ip}', '{fqdn}', 'SRV-*', '@@##', '@@@##', '@@@@##', '@*-##'],
})
const APPLICATION = typeDef({ id: 'application', name: 'Application', pluralName: 'Applications' })
const DAILY = typeDef({ id: 'dailynote', name: 'DailyNote', pluralName: 'Daily Notes', basic: true })
const LOCKED = typeDef({ id: 'locked', name: 'Locked', pluralName: 'Lockeds', readOnlyReason: 'Not valid JSON' })

describe('[[ create rows (M29)', () => {
  let editor: TiptapEditor

  beforeEach(async () => {
    localStorage.clear()
    await setLastTypeSpace(null)
    useTabs.getState().reset()
    resetLinkIndex()
    useRecent.setState({ paths: [] })
    mocked.createObject.mockClear()
    mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE, HOST, APPLICATION, DAILY, LOCKED] })
    mocked.objects.mockResolvedValue([])
    mocked.resolve.mockResolvedValue(null)
    installLinkPicker()
    editor = new TiptapEditor({ extensions: editorExtensions() })
    loadBody(editor, 'Hello \n')
    const end = editor.state.doc.firstChild!.nodeSize - 1
    act(() => useLinkPicker.getState().show(editor, { from: end, to: end }))
  })

  afterEach(() => {
    editor.destroy()
    useLinkPicker.getState().hide()
  })

  async function typeQuery(q: string): Promise<HTMLElement> {
    render(<LinkPicker />)
    const input = await screen.findByRole('textbox', { name: 'Search notes' })
    // The types arrive with the link index.
    await waitFor(() => expect(mocked.space).toHaveBeenCalled())
    fireEvent.change(input, { target: { value: q } })
    return input
  }

  const createRow = (typeId: string) => document.querySelector<HTMLElement>(`[data-create-type="${typeId}"]`)

  test("typing APP01 offers New 'APP01' as Host, suggested", async () => {
    await typeQuery('APP01')
    await waitFor(() => expect(createRow('host')).not.toBeNull())
    const row = createRow('host')!
    expect(row.textContent).toContain("New 'APP01'")
    expect(row.textContent).toContain('Host')
    expect(row.textContent).toContain('Suggested')
    const names = screen.getAllByRole('option').map((o) => o.textContent)
    expect(names).toEqual(["New 'APP01'HostSuggested", 'Other types'])
  })

  test('Other types lists the rest and creates with the picked type', async () => {
    await typeQuery('APP01')
    fireEvent.click(await screen.findByRole('button', { name: /Other types/ }))
    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Application', 'Note']))
    fireEvent.click(screen.getByRole('button', { name: /Application/ }))
    await waitFor(() => expect(serializeBody(editor)).toBe('Hello [[APP01]]\n'))
    expect(mocked.createObject.mock.calls).toEqual([['application', { title: 'APP01' }]])
    expect(useLastType.getState().typeId).toBe('application')
  })

  test("Enter on the create row calls createObject('host', { title: 'APP01' }) with no templateId and inserts [[APP01]]", async () => {
    const input = await typeQuery('APP01')
    await waitFor(() => expect(createRow('host')).not.toBeNull())
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(useLinkPicker.getState().range).toBeNull())
    expect(mocked.createObject.mock.calls).toEqual([['host', { title: 'APP01' }]])
    expect(serializeBody(editor)).toBe('Hello [[APP01]]\n')
  })

  test('no suggestion falls back to Page (shown as Note)', async () => {
    await typeQuery('Shopping list')
    await waitFor(() => expect(createRow('page')).not.toBeNull())
    expect(createRow('page')!.textContent).toBe("New 'Shopping list'Note")
    expect(createRow('host')).toBeNull()
  })

  test('the last type is set to host', async () => {
    const input = await typeQuery('SRV-02')
    await waitFor(() => expect(createRow('host')).not.toBeNull())
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(useLastType.getState().typeId).toBe('host'))
    expect(JSON.parse(localStorage.getItem('object.lastType') ?? 'null')).toEqual({ typeId: 'host' })
  })

  test('an empty query shows recents and types as before', async () => {
    render(<LinkPicker />)
    await screen.findByRole('textbox', { name: 'Search notes' })
    await waitFor(() => expect(mocked.space).toHaveBeenCalled())
    expect(document.querySelector('[data-create-type]')).toBeNull()
    expect(screen.queryByRole('option', { name: /Other types|New '/ })).toBeNull()
  })
})
