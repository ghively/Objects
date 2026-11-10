// M30 Task 10: the Entities step of a batch kept as Sources, against the mock API.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
  announceResync: vi.fn(),
}))

import { api } from '@/api/client'
import type { EntitiesReview, EntitiesView, EntitiesWritten, FilingStatus, ImportEntity } from '@/api/types'
import { emptyEntitiesView } from '@/test/mockApi'
import { EntitiesStep } from './EntitiesStep'
import { AGENT_TEXT as T } from './text'
import { agentTiming } from './TrialStep'

const m = vi.mocked(api)

function entity(over: Partial<ImportEntity> & Pick<ImportEntity, 'id' | 'type' | 'name'>): ImportEntity {
  return {
    typeId: over.id.split(':')[0],
    aliases: [],
    pages: [{ path: `Sources/${over.name}.md`, title: over.name }],
    mainPages: [],
    values: [],
    summary: [],
    confidence: 'high',
    joinedByAgent: false,
    existing: null,
    rule: 'pages',
    decision: null,
    ...over,
  }
}

const HOST = entity({
  id: 'host:app01',
  type: 'Host',
  name: 'APP01',
  pages: [
    { path: 'Sources/APP01.md', title: 'APP01' },
    { path: 'Sources/Old APP01 notes.md', title: 'Old APP01 notes' },
    { path: 'Sources/Rack notes.md', title: 'Rack notes' },
  ],
  mainPages: ['Sources/APP01.md'],
  values: [
    {
      key: 'ipAddress',
      name: 'IP address',
      value: '10.0.0.5',
      sources: [{ path: 'Sources/APP01.md', title: 'APP01', quote: 'IP address: 10.0.0.5' }],
      conflict: [{ value: '10.0.0.6', sources: [{ path: 'Sources/Old APP01 notes.md', title: 'Old APP01 notes', quote: 'IP 10.0.0.6' }] }],
    },
  ],
  summary: ['The Payroll server at HQ.', 'Backs up to SRV-DB01.'],
  existing: { path: 'Hosts/app01.md', title: 'app01' },
  rule: 'own',
})
const SQL = entity({
  id: 'software:sql 2019',
  type: 'Software',
  name: 'SQL Server 2019',
  aliases: ['SQL 2019'],
  pages: [
    { path: 'Sources/APP01.md', title: 'APP01' },
    { path: 'Sources/SRV-DB01.md', title: 'SRV-DB01' },
  ],
  values: [{ key: 'version', name: 'Version', value: '2019', sources: [{ path: 'Sources/SRV-DB01.md', title: 'SRV-DB01', quote: 'SQL Server 2019' }], conflict: null }],
  summary: ['The database engine Payroll uses.'],
  confidence: 'medium',
  joinedByAgent: true,
})
const SQLX = entity({ id: 'software:sqlserver 2019', type: 'Software', name: 'SQLServer 2019', confidence: 'low', rule: 'properties' })

/** Entities in the server's order (type name, then name). */
const ENTITIES = [HOST, SQL, SQLX]

function view(over: Partial<EntitiesView> = {}): EntitiesView {
  return emptyEntitiesView({ state: 'review', entities: ENTITIES, sources: 6, undecided: 3, conflicts: 1, ...over })
}

/** The server's answer to a saved review: each entity gets its decision, `undecided` counts the rest. */
function answer(base: EntitiesView) {
  return async (_batch: string, review: EntitiesReview) => {
    const entities = base.entities.map((e) => ({ ...e, decision: review.decisions[e.id] ?? null }))
    return { ok: true, view: { ...base, entities, review, undecided: entities.filter((e) => !e.decision).length } }
  }
}

function status(state: FilingStatus['state']): FilingStatus {
  return { state, trial: { items: [], rightShare: null }, normalise: [], keepAsSources: true }
}

const WRITTEN: EntitiesWritten = {
  created: 2,
  existing: 1,
  relations: 3,
  plainLinks: 1,
  relationsInbox: 0,
  sections: 3,
  sectionsLeft: 0,
  conflicts: 1,
  failed: [],
}

const lastReview = () => m.saveEntitiesReview.mock.calls.at(-1)?.[1]

beforeEach(() => {
  vi.clearAllMocks()
  agentTiming.pollMs = 10
})

describe('EntitiesStep', () => {
  test('groups entities by type with counts and badges', async () => {
    m.importEntities.mockResolvedValue(view())
    render(<EntitiesStep batch="b1" onDone={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: T.typeGroup('Software', 2) })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: T.typeGroup('Host', 1) })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: T.entitiesHeading })).toBeInTheDocument()
    expect(screen.getByText(T.sourcesNote(6))).toBeInTheDocument()

    const sql = screen.getByRole('group', { name: 'SQL Server 2019' })
    expect(within(sql).getByText(T.sourcesCount(2))).toBeInTheDocument()
    expect(within(sql).getByText(T.alsoCalled(['SQL 2019']))).toBeInTheDocument()
    expect(within(sql).getByText(T.joinedByAgent)).toBeInTheDocument()
    expect(within(sql).getByText('The database engine Payroll uses.')).toBeInTheDocument()
    expect(within(sql).getByText('Version: 2019')).toBeInTheDocument()
    expect(within(sql).getByText('(SRV-DB01)')).toBeInTheDocument()
    expect(sql.querySelector('blockquote')).toHaveTextContent(`${T.quote}: SQL Server 2019`)
    expect(within(sql).getByText(T.status.undecided)).toBeInTheDocument()

    const host = screen.getByRole('group', { name: 'APP01' })
    expect(within(host).getByText(T.sourcesCount(3))).toBeInTheDocument()
    expect(within(host).getByText(T.mainSubject)).toBeInTheDocument()
    expect(within(host).getByText(T.alreadyHere)).toBeInTheDocument()
    expect(within(host).getByText(T.disagree)).toBeInTheDocument()
    expect(within(host).getByText(T.keptValue('10.0.0.5', ['10.0.0.6']))).toBeInTheDocument()
    expect(within(host).getByText('The Payroll server at HQ.')).toBeInTheDocument()
    expect(within(host).queryByText('Backs up to SRV-DB01.')).not.toBeInTheDocument()
    expect(within(host).queryByText(T.joinedByAgent)).not.toBeInTheDocument()

    const low = screen.getByRole('group', { name: 'SQLServer 2019' })
    expect(within(low).getByText(T.confidence.low)).toBeInTheDocument()
    expect(within(low).getByText(T.sourcesCount(1))).toBeInTheDocument()
    // Split is offered only where there are other spellings.
    expect(within(low).queryByRole('button', { name: T.split })).not.toBeInTheDocument()
    expect(within(sql).getByRole('button', { name: T.split })).toBeInTheDocument()
  })

  test('accept, rename and turn down save the review', async () => {
    const base = view()
    m.importEntities.mockResolvedValue(base)
    m.saveEntitiesReview.mockImplementation(answer(base))
    const user = userEvent.setup()
    render(<EntitiesStep batch="b1" onDone={vi.fn()} />)
    const host = await screen.findByRole('group', { name: 'APP01' })
    await user.click(within(host).getByRole('button', { name: T.accept }))
    expect(m.saveEntitiesReview).toHaveBeenLastCalledWith('b1', {
      decisions: { 'host:app01': { status: 'accepted' } },
      merges: [],
      splits: [],
    })
    expect(await within(host).findByText(T.entityStatus.accepted)).toBeInTheDocument()

    const sql = screen.getByRole('group', { name: 'SQL Server 2019' })
    await user.click(within(sql).getByRole('button', { name: T.rename }))
    const field = within(sql).getByRole('textbox', { name: T.renameLabel })
    expect(field).toHaveValue('SQL Server 2019')
    await user.type(field, ' Std{Enter}')
    expect(lastReview()?.decisions['software:sql 2019']).toEqual({ status: 'renamed', name: 'SQL Server 2019 Std' })
    expect(lastReview()?.decisions['host:app01']).toEqual({ status: 'accepted' })
    expect(await within(sql).findByText(T.entityStatus.renamed)).toBeInTheDocument()

    const low = screen.getByRole('group', { name: 'SQLServer 2019' })
    await user.click(within(low).getByRole('button', { name: T.reject }))
    expect(lastReview()?.decisions['software:sqlserver 2019']).toEqual({ status: 'rejected' })
    expect(await within(low).findByText(T.entityStatus.rejected)).toBeInTheDocument()
    expect(m.saveEntitiesReview).toHaveBeenCalledTimes(3)
  })

  test('merge selected and split send their ops', async () => {
    const base = view({ suggestedMerges: [{ ids: ['software:sql 2019', 'software:sqlserver 2019'], names: ['SQL Server 2019', 'SQLServer 2019'] }] })
    m.importEntities.mockResolvedValue(base)
    m.saveEntitiesReview.mockImplementation(answer(base))
    const user = userEvent.setup()
    render(<EntitiesStep batch="b1" onDone={vi.fn()} />)

    // The suggested merge's Merge sends its ids.
    const suggested = await screen.findByRole('region', { name: T.suggestedHeading })
    expect(within(suggested).getByText('SQL Server 2019, SQLServer 2019')).toBeInTheDocument()
    await user.click(within(suggested).getByRole('button', { name: T.mergeSuggestion }))
    expect(lastReview()).toEqual({ decisions: {}, merges: [['software:sql 2019', 'software:sqlserver 2019']], splits: [] })

    // Selecting two rows offers Merge 2 selected in their type.
    expect(screen.queryByRole('button', { name: T.mergeSelected(2) })).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: T.selectLabel('SQLServer 2019') }))
    expect(screen.queryByRole('button', { name: T.mergeSelected(1) })).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: T.selectLabel('SQL Server 2019') }))
    await user.click(screen.getByRole('button', { name: T.mergeSelected(2) }))
    expect(lastReview()?.merges).toEqual([
      ['software:sql 2019', 'software:sqlserver 2019'],
      ['software:sql 2019', 'software:sqlserver 2019'],
    ])
    await waitFor(() => expect(screen.getByRole('checkbox', { name: T.selectLabel('SQL Server 2019') })).not.toBeChecked())

    // Split: the spellings as checkboxes under the intro.
    const sql = screen.getByRole('group', { name: 'SQL Server 2019' })
    await user.click(within(sql).getByRole('button', { name: T.split }))
    expect(within(sql).getByText(T.splitIntro)).toBeInTheDocument()
    await user.click(within(sql).getByRole('checkbox', { name: 'SQL 2019' }))
    await user.click(within(sql).getByRole('button', { name: T.split }))
    expect(lastReview()?.splits).toEqual([{ id: 'software:sql 2019', names: ['SQL 2019'] }])
    expect(within(sql).queryByText(T.splitIntro)).not.toBeInTheDocument()
  })

  test("the server's answer replaces the review that was sent", async () => {
    const base = view()
    m.importEntities.mockResolvedValue(base)
    // After the split the server drops the split entity's decision and keeps only the split.
    m.saveEntitiesReview.mockResolvedValueOnce({
      ok: true,
      view: { ...base, review: { decisions: {}, merges: [], splits: [{ id: 'software:sql 2019', names: ['SQL 2019'] }] } },
    })
    m.saveEntitiesReview.mockImplementation(answer(base))
    const user = userEvent.setup()
    render(<EntitiesStep batch="b1" onDone={vi.fn()} />)
    const sql = await screen.findByRole('group', { name: 'SQL Server 2019' })
    await user.click(within(sql).getByRole('button', { name: T.accept }))
    expect(within(sql).getByText(T.status.undecided)).toBeInTheDocument()
    await user.click(within(screen.getByRole('group', { name: 'APP01' })).getByRole('button', { name: T.reject }))
    expect(lastReview()).toEqual({
      decisions: { 'host:app01': { status: 'rejected' } },
      merges: [],
      splits: [{ id: 'software:sql 2019', names: ['SQL 2019'] }],
    })
  })

  test('write waits for every decision', async () => {
    const base = view({
      entities: [{ ...HOST, decision: { status: 'accepted' } }, { ...SQL, decision: { status: 'renamed', name: 'SQL Server 2019 Std' } }, SQLX],
      review: { decisions: { 'host:app01': { status: 'accepted' }, 'software:sql 2019': { status: 'renamed', name: 'SQL Server 2019 Std' } }, merges: [], splits: [] },
      undecided: 1,
    })
    m.importEntities.mockResolvedValueOnce(base).mockResolvedValue({ ...base, state: 'written', undecided: 0, written: WRITTEN })
    m.saveEntitiesReview.mockImplementation(answer(base))
    let posted: () => void = () => {}
    m.writeEntities.mockImplementation(() => new Promise((ok) => (posted = () => ok({ ok: true }))))
    m.filingStatus.mockResolvedValueOnce(status('writing')).mockResolvedValue(status('done'))
    const onDone = vi.fn()
    const user = userEvent.setup()
    render(<EntitiesStep batch="b1" onDone={onDone} />)

    const write = await screen.findByRole('button', { name: T.write })
    expect(write).toBeDisabled()
    expect(screen.getByText(T.undecidedEntities(1))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: T.acceptRest }))
    expect(lastReview()?.decisions).toEqual({
      'host:app01': { status: 'accepted' },
      'software:sql 2019': { status: 'renamed', name: 'SQL Server 2019 Std' },
      'software:sqlserver 2019': { status: 'accepted' },
    })
    await waitFor(() => expect(write).toBeEnabled())
    expect(screen.queryByText(T.undecidedEntities(1))).not.toBeInTheDocument()

    await user.click(write)
    expect(m.writeEntities).toHaveBeenCalledWith('b1')
    expect(screen.getByRole('button', { name: T.writing })).toBeDisabled()
    expect(m.filingStatus).not.toHaveBeenCalled()
    posted()

    expect(await screen.findByText(T.written(WRITTEN))).toBeInTheDocument()
    expect(screen.getByText(T.conflictsWritten(1))).toBeInTheDocument()
    expect(screen.queryByText(T.sectionsLeft(0))).not.toBeInTheDocument()
    expect(screen.queryByText(T.relationsInbox(0))).not.toBeInTheDocument()
    expect(m.filingStatus).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: T.write })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: T.next }))
    expect(onDone).toHaveBeenCalledWith(status('done'))
  })

  test('no entities still offers Write', async () => {
    m.importEntities.mockResolvedValue(emptyEntitiesView({ state: 'review', sources: 4 }))
    render(<EntitiesStep batch="b1" onDone={vi.fn()} />)
    expect(await screen.findByText(T.entitiesNone)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: T.write })).toBeEnabled()
    expect(screen.getByRole('button', { name: T.acceptRest })).toBeDisabled()
  })

  test('a failed write can be run again', async () => {
    const base = view({ entities: ENTITIES.map((e) => ({ ...e, decision: { status: 'accepted' as const } })), undecided: 0 })
    m.importEntities.mockResolvedValue(base)
    m.writeEntities.mockResolvedValue({ ok: true })
    m.filingStatus.mockResolvedValue(status('failed'))
    const user = userEvent.setup()
    render(<EntitiesStep batch="b1" onDone={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: T.write }))
    expect(await screen.findByText(T.writeFailed)).toBeInTheDocument()
    const again = screen.getByRole('button', { name: T.write })
    expect(again).toBeEnabled()
    m.filingStatus.mockResolvedValue(status('writing'))
    await user.click(again)
    expect(m.writeEntities).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(T.writeFailed)).not.toBeInTheDocument()
  })

  test('a step opened while writing keeps polling until done', async () => {
    const base = view({ state: 'writing', entities: ENTITIES.map((e) => ({ ...e, decision: { status: 'accepted' as const } })), undecided: 0 })
    m.importEntities.mockResolvedValueOnce(base).mockResolvedValue({ ...base, state: 'written', written: { ...WRITTEN, sectionsLeft: 1, relationsInbox: 2 } })
    m.filingStatus.mockResolvedValueOnce(status('writing')).mockResolvedValue(status('done'))
    const onDone = vi.fn()
    const user = userEvent.setup()
    render(<EntitiesStep batch="b1" onDone={onDone} />)
    expect(await screen.findByRole('button', { name: T.writing })).toBeDisabled()
    for (const b of screen.getAllByRole('button', { name: T.accept })) expect(b).toBeDisabled()
    expect(await screen.findByText(T.sectionsLeft(1))).toBeInTheDocument()
    expect(screen.getByText(T.relationsInbox(2))).toBeInTheDocument()
    expect(m.writeEntities).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: T.next }))
    expect(onDone).toHaveBeenCalledWith(status('done'))
  })

  test('left-out entities are listed with their reason', async () => {
    m.importEntities.mockResolvedValue(
      view({
        leftOut: [
          { id: 'location:hq', type: 'Location', name: 'HQ', pages: 1, reason: 'text' },
          { id: 'host:server', type: 'Host', name: 'Server', pages: 4, reason: 'category' },
        ],
      }),
    )
    const user = userEvent.setup()
    render(<EntitiesStep batch="b1" onDone={vi.fn()} />)
    const toggle = await screen.findByRole('button', { name: T.leftOutHeading })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(T.leftOutReason.text)).not.toBeInTheDocument()
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const list = screen.getByRole('list', { name: T.leftOutHeading })
    const hq = within(list).getByText('HQ').closest('li')!
    expect(hq).toHaveTextContent('Location')
    expect(hq).toHaveTextContent(T.leftOutReason.text)
    const server = within(list).getByText('Server').closest('li')!
    expect(server).toHaveTextContent(T.leftOutReason.category)
    expect(server).toHaveTextContent(T.sourcesCount(4))
    // Not accepted on its own, but it can be merged into an entity of its type.
    expect(within(list).queryByRole('button', { name: T.accept })).not.toBeInTheDocument()
    await user.click(within(list).getByRole('checkbox', { name: T.selectLabel('Server') }))
    await user.click(screen.getByRole('checkbox', { name: T.selectLabel('APP01') }))
    m.saveEntitiesReview.mockResolvedValue({ ok: true, view: view() })
    await user.click(screen.getByRole('button', { name: T.mergeSelected(2) }))
    expect(lastReview()?.merges).toEqual([['host:app01', 'host:server']])
  })
})
