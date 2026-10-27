import { Editor as TiptapEditor } from '@tiptap/core'
import { fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, DailyNoteExistsError } from '@/api/client'
import { resetLinkIndex } from '@/links/linkIndex'
import { currentTarget, useTabs } from '@/nav/tabs'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { editorExtensions, loadBody, serializeBody } from '../document'

const mocked = vi.mocked(api)
const editors: TiptapEditor[] = []

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
})
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
  document.body.innerHTML = ''
  useSettings.setState({ settings: settingsDefaults })
})

function mounted(body: string): TiptapEditor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new TiptapEditor({ element, extensions: editorExtensions() })
  loadBody(editor, body)
  editors.push(editor)
  return editor
}

const BODY = 'Due <time datetime="2026-10-30">2026-10-30</time> for review.\n'

describe('date token chip', () => {
  test('shows the day in the user date format and keeps the file text', () => {
    const editor = mounted(BODY)
    const chip = editor.view.dom.querySelector<HTMLElement>('.date-token-chip')!
    expect(chip).toHaveAttribute('datetime', '2026-10-30')
    expect(chip.textContent).toBe('Oct 30, 2026')
    useSettings.setState({ settings: { ...settingsDefaults, dateFormatting: 'DMY' } })
    expect(chip.textContent).toBe('30-10-2026')
    expect(serializeBody(editor)).toBe(BODY)
  })

  test('test date token chip opens its daily note', async () => {
    mocked.resolve.mockResolvedValue('DailyNotes/2026-10-30.md')
    const editor = mounted(BODY)
    fireEvent.click(editor.view.dom.querySelector('.date-token-chip')!)
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'DailyNotes/2026-10-30.md' }))
    expect(mocked.resolve).toHaveBeenCalledWith('2026-10-30', undefined)
    expect(mocked.createDailyNote).not.toHaveBeenCalled()
    expect(serializeBody(editor)).toBe(BODY)
  })

  test('a day without a note gets one, or the existing one on 409', async () => {
    const editor = mounted(BODY)
    fireEvent.click(editor.view.dom.querySelector('.date-token-chip')!)
    await waitFor(() => expect(mocked.createDailyNote).toHaveBeenCalledWith('2026-10-30'))
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'DailyNotes/2026-10-30.md' }))

    resetLinkIndex()
    useTabs.getState().reset()
    mocked.createDailyNote.mockRejectedValueOnce(new DailyNoteExistsError('exists', 'Daily/2026-10-30.md'))
    fireEvent.click(editor.view.dom.querySelector('.date-token-chip')!)
    await waitFor(() => expect(currentTarget(useTabs.getState())).toEqual({ kind: 'object', path: 'Daily/2026-10-30.md' }))
  })
})
