// M28 Task 9: counterpart rows on the object page (merged by key, edited through the stored side).
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ApiError } from '@/api/client'
import type { CounterpartRow, TypeDef } from '@/api/types'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { counterpartDef, counterpartRow, objectSummary, propertyDef, typeDef } from '@/test/mockApi'
import { counterpartEditor, CounterpartRows } from './CounterpartRows'
import { PropertyPanel } from './PropertyPanel'

const mocked = vi.mocked(api)

const HOST = 'Hosts/APP-TEST-01.md'
const BACKUP = 'Scripts/Backup script.md'
const PATCHING = 'Runbooks/Patching.md'
const RESTART = 'Runbooks/Restart.md'
const UPTIME = 'Commands/Uptime.md'
const INVENTORY = 'Applications/Inventory app.md'
const NOTE = 'Pages/Note.md'

const types: TypeDef[] = [
  typeDef({ id: 'host', name: 'Host', pluralName: 'Hosts' }),
  typeDef({ id: 'script', name: 'Script', pluralName: 'Scripts' }),
  typeDef({ id: 'command', name: 'Command', pluralName: 'Commands' }),
  typeDef({ id: 'runbook', name: 'Runbook', pluralName: 'Runbooks' }),
  typeDef({ id: 'application', name: 'Application', pluralName: 'Applications' }),
  typeDef({ id: 'page', name: 'Page', pluralName: 'Pages' }),
]
const objects = [
  objectSummary({ path: HOST, title: 'APP-TEST-01', type: 'host' }),
  objectSummary({ path: BACKUP, title: 'Backup script', type: 'script' }),
  objectSummary({ path: PATCHING, title: 'Patching', type: 'runbook' }),
  objectSummary({ path: RESTART, title: 'Restart', type: 'runbook' }),
  objectSummary({ path: UPTIME, title: 'Uptime', type: 'command' }),
  objectSummary({ path: INVENTORY, title: 'Inventory app', type: 'application' }),
  objectSummary({ path: NOTE, title: 'Note', type: 'page' }),
]

const documentedIn = counterpartDef({
  key: 'documentedIn',
  name: 'Documented in',
  options: {
    allowedTypes: ['script', 'command', 'runbook'],
    counterpartOf: [
      { typeId: 'script', key: 'covers' },
      { typeId: 'command', key: 'covers' },
      { typeId: 'runbook', key: 'covers' },
    ],
  },
})
const scriptRow = counterpartRow({ key: 'documentedIn', name: 'Documented in', sourceTypeId: 'script', sourcePropertyKey: 'covers', paths: [BACKUP] })
const runbookRow = counterpartRow({ key: 'documentedIn', name: 'Documented in', sourceTypeId: 'runbook', sourcePropertyKey: 'covers', paths: [PATCHING] })

/** The rows with the editor ObjectView wires: the answer's rows replace the shown ones. */
function Harness({ initial, readOnly }: { initial: CounterpartRow[]; readOnly?: boolean }) {
  const [rows, setRows] = useState(initial)
  const latest = { rows }
  return (
    <CounterpartRows
      rows={rows}
      defs={[documentedIn]}
      readOnly={readOnly}
      onEdit={counterpartEditor(HOST, () => latest.rows, setRows)}
    />
  )
}

const chips = (row: HTMLElement) =>
  within(row)
    .queryAllByText(/./, { selector: 'span.truncate' })
    .map((e) => e.textContent)

beforeEach(() => {
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  useLinkIndex.setState({ types, objects, loaded: true, revision: 1 })
})

describe('test M28 CounterpartRows', () => {
  test('test rows with the same key merge into one row with chips from each source', () => {
    render(<Harness initial={[scriptRow, runbookRow]} />)
    expect(screen.getAllByText('Documented in')).toHaveLength(1)
    const row = document.querySelector('[data-counterpart="documentedIn"]') as HTMLElement
    expect(chips(row)).toEqual(['Backup script', 'Patching'])
  })

  test('test the picker offers only the merged sources and a pick writes the picked type', async () => {
    const user = userEvent.setup()
    mocked.editCounterpart.mockResolvedValueOnce({
      counterparts: [scriptRow, { ...runbookRow, paths: [PATCHING, RESTART] }],
      written: [{ path: RESTART, version: 'v2' }],
      skipped: [],
    })
    render(<Harness initial={[scriptRow, runbookRow]} />)
    await user.click(screen.getByRole('button', { name: 'Edit Documented in' }))
    const list = await screen.findByRole('listbox', { name: 'Documented in' })
    const offered = within(list).getAllByRole('option').map((o) => o.textContent)
    expect(offered.sort()).toEqual(['Backup script', 'Patching', 'Restart', 'Uptime'])
    await user.click(within(list).getByRole('option', { name: /Restart/ }))
    expect(mocked.editCounterpart).toHaveBeenCalledWith({
      path: HOST,
      key: 'documentedIn',
      sourceTypeId: 'runbook',
      add: [RESTART],
      remove: [],
    })
    // The answer's rows are shown without reading the object again.
    const row = document.querySelector('[data-counterpart="documentedIn"]') as HTMLElement
    await waitFor(() => expect(chips(row)).toContain('Restart'))
    expect(mocked.object).not.toHaveBeenCalled()
  })

  test('test removing a chip sends remove with the source of the row holding it', async () => {
    const user = userEvent.setup()
    mocked.editCounterpart.mockResolvedValueOnce({ counterparts: [runbookRow], written: [{ path: BACKUP, version: 'v2' }], skipped: [] })
    render(<Harness initial={[scriptRow, runbookRow]} />)
    await user.click(screen.getByRole('button', { name: 'Edit Documented in' }))
    const list = await screen.findByRole('listbox', { name: 'Documented in' })
    await user.click(within(list).getByRole('option', { name: /Backup script/ }))
    expect(mocked.editCounterpart).toHaveBeenCalledWith({
      path: HOST,
      key: 'documentedIn',
      sourceTypeId: 'script',
      add: [],
      remove: [BACKUP],
    })
    const row = document.querySelector('[data-counterpart="documentedIn"]') as HTMLElement
    await waitFor(() => expect(chips(row)).toEqual(['Patching']))
  })

  test('test a 422 shows its text in the row', async () => {
    const user = userEvent.setup()
    mocked.editCounterpart.mockRejectedValueOnce(new ApiError(422, 'This object has no "documentedIn" relation from Runbook.'))
    render(<Harness initial={[scriptRow, runbookRow]} />)
    await user.click(screen.getByRole('button', { name: 'Edit Documented in' }))
    const list = await screen.findByRole('listbox', { name: 'Documented in' })
    await user.click(within(list).getByRole('option', { name: /Restart/ }))
    const row = document.querySelector('[data-counterpart="documentedIn"]') as HTMLElement
    expect(await within(row).findByRole('alert')).toHaveTextContent('This object has no "documentedIn" relation from Runbook.')
  })

  test('test read only shows the chips only', () => {
    render(<Harness initial={[scriptRow, runbookRow]} readOnly />)
    expect(screen.queryByRole('button', { name: 'Edit Documented in' })).toBeNull()
    const row = document.querySelector('[data-counterpart="documentedIn"]') as HTMLElement
    expect(chips(row)).toEqual(['Backup script', 'Patching'])
  })
})

describe('test M28 counterpart rows in the property panel', () => {
  const runs = counterpartDef({
    key: 'runs',
    name: 'Runs',
    options: { allowedTypes: ['application'], counterpartOf: [{ typeId: 'application', key: 'runsOn' }] },
  })
  const configuredBy = counterpartDef({
    key: 'configuredBy',
    name: 'Configured by',
    options: { allowedTypes: ['configuration'], counterpartOf: [{ typeId: 'configuration', key: 'appliesTo' }] },
  })
  const host = typeDef({
    id: 'host',
    name: 'Host',
    propertyDefinitions: [
      propertyDef({ id: 'title', type: 'entity_title' }),
      propertyDef({ id: 'fqdn', name: 'FQDN', type: 'text' }),
      propertyDef({ id: 'backlinks', name: 'Backlinks', type: 'entity_backlinks' }),
    ],
    counterparts: [runs, configuredBy],
  })

  test('test an empty counterpart waits under Hidden and a filled one shows before Backlinks', async () => {
    const user = userEvent.setup()
    const onEditCounterpart = vi.fn(async () => undefined)
    render(
      <PropertyPanel
        type={host}
        frontmatter={{ title: 'APP-TEST-01', fqdn: 'app-test-01.example.test' }}
        summary={objects[0]}
        counterparts={[
          counterpartRow({ paths: [INVENTORY] }),
          counterpartRow({ key: 'configuredBy', name: 'Configured by', sourceTypeId: 'configuration', sourcePropertyKey: 'appliesTo' }),
        ]}
        onEditCounterpart={onEditCounterpart}
        onChange={() => undefined}
      />,
    )
    const order = [...document.querySelectorAll('[data-property-row]')].map((e) => e.getAttribute('data-property-row'))
    expect(order).toEqual(['FQDN', 'Runs', 'Backlinks'])
    expect(screen.queryByText('Configured by')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Hidden (1)' }))
    expect(screen.getByText('Configured by')).toBeInTheDocument()
    // The rows are editable from this side.
    expect(screen.getByRole('button', { name: 'Edit Runs' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Configured by' })).toBeInTheDocument()
  })
})
