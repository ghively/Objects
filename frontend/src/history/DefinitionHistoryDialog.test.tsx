import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/api/d2Api', async (orig) => ({
  ...(await orig<typeof import('@/api/d2Api')>()),
  definitionHistoryApi: { versions: vi.fn(), version: vi.fn(), restore: vi.fn() },
}))

import { ConfirmRequiredError, RevisionConflictError } from '@/api/client'
import { definitionHistoryApi, definitionPath, type DefinitionVersion } from '@/api/d2Api'
import { DEFINITION_HISTORY as S, DefinitionHistoryDialog } from './DefinitionHistoryDialog'
import { prettyDefinition, summarizeDefinition } from './definitionSummary'

const hist = vi.mocked(definitionHistoryApi)
const PATH = '.object/collections/reading-list.json'

const OLD = { schemaVersion: 1, id: 'reading-list', name: 'Reading list', typeIds: ['page'], description: '' }
const NOW = { ...OLD, name: 'Shelf', typeIds: ['page', 'book'], revision: 'rev-now' }
const TEXTS: Record<string, string> = {
  a: JSON.stringify(OLD),
  b: JSON.stringify({ ...OLD, name: 'Shelf' }),
}

function v(id: string, number: number): DefinitionVersion {
  return { id, number, at: `2026-11-0${number}T10:00:00Z`, size: 10 }
}

beforeEach(() => {
  hist.versions.mockResolvedValue([v('b', 2), v('a', 1)])
  hist.version.mockImplementation(async (_p: string, id: string) => ({ id, text: TEXTS[id] ?? '' }))
  hist.restore.mockResolvedValue({ revision: 'rev-new', rewritten: [], skipped: [] })
})

afterEach(() => {
  hist.versions.mockReset()
  hist.version.mockReset()
  hist.restore.mockReset()
  document.querySelectorAll('[data-editor-toasts]').forEach((n) => n.remove())
})

function renderDialog(props: Partial<Parameters<typeof DefinitionHistoryDialog>[0]> = {}) {
  const onOpenChange = vi.fn()
  render(
    <DefinitionHistoryDialog
      open
      onOpenChange={onOpenChange}
      kind="collections"
      id="reading-list"
      current={NOW}
      typeName={(id) => ({ page: 'Page', book: 'Book' })[id] ?? id}
      {...props}
    />,
  )
  return onOpenChange
}

describe('definition summary', () => {
  test('summarizes a type, a collection and a query version, with what changed since', () => {
    const prop = (id: string, name: string, type = 'text') => ({ id, key: id, name, type })
    const type = summarizeDefinition(
      'types',
      { name: 'Person', pluralName: 'People', propertyDefinitions: [prop('title', 'Title', 'entity_title'), prop('a', 'Email'), prop('b', 'Phone')] },
      { name: 'Contact', pluralName: 'People', propertyDefinitions: [prop('a', 'E-mail'), prop('c', 'Team')] },
    )
    expect(type.rows).toEqual([
      { label: 'Name', value: 'Person' },
      { label: 'Plural name', value: 'People' },
      { label: 'Properties', value: 'Email, Phone' },
    ])
    expect(type.changes).toEqual([
      'Renamed from “Person” to “Contact”',
      'Properties added since: Team',
      'Properties removed since: Phone',
      'Property “Email” renamed to “E-mail”',
    ])

    const col = summarizeDefinition('collections', OLD, NOW, (id) => id.toUpperCase())
    expect(col.rows).toEqual([
      { label: 'Name', value: 'Reading list' },
      { label: 'Types', value: 'PAGE' },
    ])
    expect(col.changes).toEqual(['Renamed from “Reading list” to “Shelf”', 'Types added since: BOOK'])

    const filterGroup = { type: 'filterGroup', operator: 'and', elements: [{ key: 'x' }, { type: 'filterGroup', elements: [{ key: 'y' }] }] }
    const q = summarizeDefinition(
      'queries',
      { name: 'Open', definition: { types: [{ id: 'task' }], filterGroup, sorts: [], search: { searchTerms: [{ text: 'urgent' }] } } },
      { name: 'Open', definition: { types: [{ id: 'task' }], filterGroup: { ...filterGroup, elements: [] }, sorts: [] } },
    )
    expect(q.rows).toEqual([
      { label: 'Name', value: 'Open' },
      { label: 'Types', value: 'task' },
      { label: 'Search', value: 'urgent' },
      { label: 'Filters', value: '2' },
      { label: 'Sorts', value: '0' },
    ])
    expect(q.changes).toEqual(['Search changed', 'Filters changed'])
    expect(summarizeDefinition('collections', OLD, null).changes).toEqual([])
    expect(prettyDefinition('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(prettyDefinition('not json')).toBe('not json')
  })
})

describe('DefinitionHistoryDialog', () => {
  test('lists the versions newest first and previews the picked one', async () => {
    const user = userEvent.setup()
    renderDialog()
    expect(screen.getByRole('heading', { name: S.title })).toBeInTheDocument()
    const list = await screen.findByRole('listbox', { name: S.versions })
    const options = within(list).getAllByRole('option')
    expect(options.map((o) => o.querySelector('.font-medium')?.textContent)).toEqual(['Version 2', 'Version 1'])
    expect(hist.versions).toHaveBeenCalledWith(PATH)
    expect(screen.getByText(S.selectTitle)).toBeInTheDocument()

    await user.click(options[1])
    expect(await screen.findByText('Reading list')).toBeInTheDocument()
    expect(hist.version).toHaveBeenCalledWith(PATH, 'a')
    const changes = screen.getByRole('list', { name: S.changedSince })
    expect(within(changes).getByText('Renamed from “Reading list” to “Shelf”')).toBeInTheDocument()
    expect(within(changes).getByText('Types added since: Book')).toBeInTheDocument()
    expect(screen.getByText(S.file)).toBeInTheDocument()
    expect(screen.getByTestId('definition-json').textContent).toBe(prettyDefinition(TEXTS.a))
  })

  test('says so when there are no versions yet, or they did not load', async () => {
    hist.versions.mockResolvedValueOnce([])
    const person = { name: 'Person', revision: 'r' }
    const { unmount } = render(<DefinitionHistoryDialog open onOpenChange={vi.fn()} kind="types" id="person" current={person} />)
    expect(await screen.findByText(S.empty)).toBeInTheDocument()
    expect(screen.getByText(S.emptyDescription('types'))).toBeInTheDocument()
    unmount()
    hist.versions.mockRejectedValueOnce(new Error('offline'))
    renderDialog()
    expect(await screen.findByText(S.fetchError)).toBeInTheDocument()
    expect(hist.versions).toHaveBeenCalledWith(definitionPath('types', 'person'))
  })

  test('restore this version asks, restores on the current revision and closes', async () => {
    const user = userEvent.setup()
    const onOpenChange = renderDialog()
    await user.click((await screen.findAllByRole('option'))[1])
    await user.click(await screen.findByRole('button', { name: S.restore }))
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText(S.restoreConfirmTitle)).toBeInTheDocument()
    expect(within(confirm).getByText(S.restoreConfirmDescription(1))).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: S.restoreConfirmConfirm }))
    await waitFor(() => expect(hist.restore).toHaveBeenCalledWith(PATH, 'a', 'rev-now', false))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(document.body.textContent).toContain(S.restoreSuccess)
  })

  test('a version that would remove values is confirmed, then sent again', async () => {
    const user = userEvent.setup()
    hist.restore.mockRejectedValueOnce(new ConfirmRequiredError('This removes the values of Email.', 3))
    const onOpenChange = renderDialog()
    await user.click((await screen.findAllByRole('option'))[1])
    await user.click(await screen.findByRole('button', { name: S.restore }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: S.restoreConfirmConfirm }))
    const ask = await screen.findByText('Apply changes?')
    const dialog = ask.closest('[role="alertdialog"]') as HTMLElement
    expect(within(dialog).getByText('This removes the values of Email.')).toBeInTheDocument()
    expect(within(dialog).getByText(/^3 (objects|notes) will change\.$/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(hist.restore).toHaveBeenLastCalledWith(PATH, 'a', 'rev-now', true))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  test('a definition changed elsewhere reloads the list and says so', async () => {
    const user = userEvent.setup()
    hist.restore.mockRejectedValueOnce(new RevisionConflictError('rev-other'))
    const onOpenChange = renderDialog()
    await user.click((await screen.findAllByRole('option'))[1])
    await user.click(await screen.findByRole('button', { name: S.restore }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: S.restoreConfirmConfirm }))
    expect(await screen.findByText(S.changedElsewhere)).toBeInTheDocument()
    expect(hist.versions).toHaveBeenCalledTimes(2)
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  test('a read-only definition can be previewed but not restored', async () => {
    const user = userEvent.setup()
    renderDialog({ readOnly: true })
    await user.click((await screen.findAllByRole('option'))[0])
    await act(async () => undefined)
    expect(await screen.findByRole('button', { name: S.restore })).toBeDisabled()
  })
})

describe('strings', () => {
  test('the object dialog strings it shares are the same', async () => {
    const { VERSION_HISTORY: O } = await import('./VersionHistoryDialog')
    for (const k of ['title', 'empty', 'fetchError', 'previewError', 'selectTitle', 'restoreConfirmTitle', 'restoreSuccess', 'changedElsewhere'] as const) {
      expect(S[k]).toBe(O[k])
    }
    expect(S.versions).toBe(O.backToList)
    expect(S.restoreConfirmDescription(3)).toBe(O.restoreConfirmDescription(3))
  })
})
