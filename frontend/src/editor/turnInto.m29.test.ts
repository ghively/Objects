// M29 Task 10: Turn into object uses the suggested type: `I` (no type) creates the suggestion
// (else Page), the "Turn into..." list puts the suggested type first, and creating sets the last type.
import { Editor as TiptapEditor } from '@tiptap/core'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { createAndOpen } from '@/create/createAndOpen'
import { setLastTypeSpace, useLastType } from '@/create/lastType'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { useTabs } from '@/nav/tabs'
import { editorExtensions, loadBody } from './document'
import { BlockMenu } from './handles/BlockMenu'
import { suggestedTurnType, turnIntoObject } from './turnInto'

const mocked = vi.mocked(api)
const editors: TiptapEditor[] = []

const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true })
const HOST = typeDef({ id: 'host', name: 'Host', pluralName: 'Hosts', namePatterns: ['{ip}', '@@@##'] })
const NETWORK = typeDef({ id: 'network', name: 'Network', pluralName: 'Networks', namePatterns: ['{cidr}'] })
const SOFTWARE = typeDef({ id: 'software', name: 'Software', pluralName: 'Software', namePatterns: ['{version}'] })

function headless(body: string): TiptapEditor {
  const editor = new TiptapEditor({ extensions: editorExtensions() })
  editors.push(editor)
  loadBody(editor, body)
  editor.commands.setTextSelection(1)
  return editor
}

beforeEach(async () => {
  localStorage.clear()
  await setLastTypeSpace(null)
  useTabs.getState().reset()
  resetLinkIndex()
  useLinkIndex.setState({ types: [PAGE, HOST, NETWORK, SOFTWARE], objects: [], loaded: true })
  mocked.createObject.mockClear()
})

afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

describe('Turn into object (M29)', () => {
  test('I on a block "10.20.0.0/24" creates a Network', async () => {
    const editor = headless('10.20.0.0/24\n')
    await act(async () => {
      expect(await turnIntoObject(editor)).toBe(true)
    })
    expect(mocked.createObject).toHaveBeenCalledWith('network', { title: '10.20.0.0/24' })
    expect(useLastType.getState().typeId).toBe('network')
  })

  test('I on "Shopping list" with no last type creates a Page', async () => {
    const editor = headless('Shopping list\n')
    await act(async () => {
      await turnIntoObject(editor)
    })
    expect(mocked.createObject).toHaveBeenCalledWith('page', { title: 'Shopping list' })
  })

  test('TurnIntoObjectItems puts Software first for "Python 3.12"', async () => {
    const editor = headless('Python 3.12\n')
    render(
      createElement(BlockMenu, {
        editor,
        open: true,
        onOpenChange: () => undefined,
        anchor: { left: 0, top: 0, width: 10, height: 10 },
      }),
    )
    const [menu] = await screen.findAllByRole('menu')
    const trigger = within(menu).getByRole('menuitem', { name: /^Turn into\.\.\./ })
    fireEvent.click(trigger)
    const sub = await screen.findByRole('menu', { name: (_, el) => el.id === trigger.getAttribute('aria-controls') })
    const names = within(sub)
      .getAllByRole('menuitem')
      .map((m) => m.textContent)
    expect(names.slice(0, 4)).toEqual(['SoftwareSuggested', 'Note', 'Host', 'Network']) // M32: the Page type reads "Note"
  })

  // M32 item 7, "new means a note": the type made last is not a suggestion in the editor.
  test('test I on "Shopping list" makes a Note even when another type was made last (M32)', async () => {
    useLastType.getState().set('host')
    const editor = headless('Shopping list\n')
    await act(async () => {
      await turnIntoObject(editor)
    })
    expect(mocked.createObject).toHaveBeenCalledTimes(1)
    expect(mocked.createObject).toHaveBeenCalledWith('page', { title: 'Shopping list' })
  })

  test('test a name pattern still chooses the type, whatever was made last (M32)', async () => {
    useLastType.getState().set('host')
    expect(suggestedTurnType('10.20.0.0/24')).toBe('network')
    const editor = headless('10.20.0.0/24\n')
    await act(async () => {
      await turnIntoObject(editor)
    })
    expect(mocked.createObject).toHaveBeenCalledWith('network', { title: '10.20.0.0/24' })
  })

  test('test the type made last is not marked Suggested in the Turn into list (M32)', async () => {
    useLastType.getState().set('host')
    expect(suggestedTurnType('Shopping list')).toBeNull()
    const editor = headless('Shopping list\n')
    render(
      createElement(BlockMenu, {
        editor,
        open: true,
        onOpenChange: () => undefined,
        anchor: { left: 0, top: 0, width: 10, height: 10 },
      }),
    )
    const [menu] = await screen.findAllByRole('menu')
    const trigger = within(menu).getByRole('menuitem', { name: /^Turn into\.\.\./ })
    fireEvent.click(trigger)
    const sub = await screen.findByRole('menu', { name: (_, el) => el.id === trigger.getAttribute('aria-controls') })
    const names = within(sub)
      .getAllByRole('menuitem')
      .map((m) => m.textContent)
    // The built-in Page type reads "Note" (the glossary); nothing is marked Suggested.
    expect(names.slice(0, 4)).toEqual(['Note', 'Host', 'Network', 'Software'])
  })

  test('createAndOpen sets the last type', async () => {
    await createAndOpen('host', { title: 'APP01' })
    await waitFor(() => expect(useLastType.getState().typeId).toBe('host'))
    expect(mocked.createObject).toHaveBeenCalledWith('host', { title: 'APP01' })
  })
})
