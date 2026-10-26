import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement, type ReactElement } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { TypeDef } from '@/api/types'
import { typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConfirmRequiredError, RevisionConflictError } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { useTypeEditor, type TypeEditor } from './useTypeEditor'

const mocked = vi.mocked(api)
const PROJECT = typeDef({ id: 'project', name: 'Project', revision: 'r1' })

let editor: TypeEditor

function Harness(): ReactElement {
  editor = useTypeEditor('project')
  return createElement('div', null, editor.dialog, createElement('p', { 'data-testid': 'rev' }, editor.type?.revision))
}

beforeEach(() => {
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  useLinkIndex.setState({ types: [PROJECT], objects: [], loaded: true })
  mocked.saveType.mockImplementation(async (t: TypeDef) => ({
    type: { ...t, revision: 'r2' },
    rewritten: [],
    skipped: [],
  }))
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [{ ...PROJECT, revision: 'r9' }] })
  mocked.objects.mockResolvedValue([])
})

describe('useTypeEditor', () => {
  test('save sends baseRevision and adopts the returned revision', async () => {
    render(createElement(Harness))
    let res: unknown
    await act(async () => {
      res = await editor.save({ ...PROJECT, description: 'x' })
    })
    expect(res).toBeTruthy()
    expect(mocked.saveType).toHaveBeenCalledWith(expect.objectContaining({ description: 'x' }), { baseRevision: 'r1' })
    expect(screen.getByTestId('rev')).toHaveTextContent('r2')
    // The next save is based on the adopted revision.
    await act(async () => {
      await editor.save({ ...PROJECT, description: 'y' })
    })
    expect(mocked.saveType).toHaveBeenLastCalledWith(expect.objectContaining({ description: 'y' }), { baseRevision: 'r2' })
  })

  test('test useTypeEditor 428 dialog resends with confirm; 409 reloads', async () => {
    render(createElement(Harness))
    mocked.saveType.mockRejectedValueOnce(new ConfirmRequiredError('Removing values from 3 objects.', 3))
    let pending!: Promise<unknown>
    act(() => {
      pending = editor.save({ ...PROJECT, description: 'z' })
    })
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Removing values from 3 objects.')
    expect(dialog).toHaveTextContent('3 objects will change.')
    expect(mocked.saveType).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await act(async () => {
      await pending
    })
    expect(mocked.saveType).toHaveBeenCalledTimes(2)
    expect(mocked.saveType).toHaveBeenLastCalledWith(expect.anything(), { baseRevision: 'r1', confirm: true })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    // 409: the index reloads and the error is reported.
    mocked.saveType.mockRejectedValueOnce(new RevisionConflictError('r9'))
    let res: unknown = 'unset'
    await act(async () => {
      res = await editor.save({ ...PROJECT, description: 'w' })
    })
    expect(res).toBeNull()
    expect(mocked.space).toHaveBeenCalled()
    expect(editor.error).toMatch(/changed elsewhere/)
    await waitFor(() => expect(screen.getByTestId('rev')).toHaveTextContent('r9'))
  })

  test('cancelling the 428 dialog sends nothing more', async () => {
    render(createElement(Harness))
    mocked.saveType.mockRejectedValueOnce(new ConfirmRequiredError('Deleting a label in use.', 1))
    let pending!: Promise<unknown>
    act(() => {
      pending = editor.save({ ...PROJECT })
    })
    await screen.findByRole('alertdialog')
    expect(screen.getByText('1 object will change.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    let res: unknown = 'unset'
    await act(async () => {
      res = await pending
    })
    expect(res).toBeNull()
    expect(mocked.saveType).toHaveBeenCalledTimes(1)
  })
})
