// M27 UI: Proposed schema, Trial, Normalise and the inbox finish, against the mock API.
// M30: the Entities step between Trial and Normalise, the trial's entity lines and the proposal's offer.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
  announceResync: vi.fn(),
}))

// M30: the Entities step itself is tested in entities.test.tsx; here a stand-in with its heading and a
// Continue that hands on the filing status, as the step's Continue does after Write.
vi.mock('./EntitiesStep', async () => {
  const { api } = await import('@/api/client')
  const { AGENT_TEXT } = await import('./text')
  return {
    EntitiesStep: ({ batch, onDone }: { batch: string; onDone: (status: FilingStatus) => void }) => (
      <section>
        <h3>{AGENT_TEXT.entitiesHeading}</h3>
        <button type="button" onClick={() => void api.filingStatus(batch).then(onDone)}>
          {AGENT_TEXT.next}
        </button>
      </section>
    ),
  }
})

import { api } from '@/api/client'
import type { FilingStatus, SchemaProposal } from '@/api/types'
import { useTabs } from '@/nav/tabs'
import { AgentFlow } from './AgentFlow'
import { NormaliseStep } from './NormaliseStep'
import { ProposalStep } from './ProposalStep'
import { AGENT_TEXT as T } from './text'
import { agentTiming, TrialStep } from './TrialStep'

const m = vi.mocked(api)

const PROPOSAL: SchemaProposal = {
  groups: [
    {
      id: 'g1',
      action: 'create',
      name: 'Meeting',
      plural: 'Meetings',
      documentCount: 24,
      examples: ['Standup 3 Nov', 'Retro'],
      properties: [
        { key: 'status', name: 'Status', kind: 'select', fillRate: 0.8, options: ['Prod', 'Dev'], mergedFrom: { Prod: ['prod', 'PRD'] } },
        { key: 'owner', name: 'Owner', kind: 'relation', fillRate: 0.5, relationTo: 'Person' },
      ],
    },
    { id: 'g2', action: 'use', typeId: 'book', name: 'Book', documentCount: 12, examples: ['Dune'], properties: [] },
  ],
}

function trialStatus(over: Partial<FilingStatus> = {}): FilingStatus {
  return {
    state: 'trial',
    trial: {
      items: [
        {
          path: 'a.md',
          title: 'Alpha',
          type: 'Meeting',
          confidence: 'high',
          verdict: null,
          values: [{ key: 'status', value: 'Prod', quote: 'We shipped to prod', ok: true }],
          tags: [{ value: 'Release', quote: 'release notes', ok: true }],
        },
        {
          path: 'b.md',
          title: 'Beta',
          type: 'Meeting',
          confidence: 'low',
          verdict: null,
          values: [{ key: 'owner', value: 'Zed', quote: 'cc Zed', ok: false }],
        },
      ],
      rightShare: null,
    },
    normalise: [],
    keepAsSources: false,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  agentTiming.pollMs = 10
})

describe('ProposalStep', () => {
  test('shows evidence and enables Apply only when every item is decided', async () => {
    m.importProposal.mockResolvedValue({ proposal: PROPOSAL, review: null })
    m.applyProposal.mockResolvedValue({ created: ['meeting'], extended: [] })
    const onApplied = vi.fn()
    const user = userEvent.setup()
    render(<ProposalStep batch="b1" onApplied={onApplied} />)
    const card = await screen.findByRole('group', { name: T.itemLabel('Meeting') })
    expect(within(card).getByText(T.actions.create)).toBeInTheDocument()
    expect(within(card).getByText(T.documents(24))).toBeInTheDocument()
    expect(within(card).getByText(/Standup 3 Nov, Retro/)).toBeInTheDocument()
    expect(within(card).getByText(/80% have a value/)).toBeInTheDocument()
    expect(within(card).getByText(/Prod, Dev/)).toBeInTheDocument()
    expect(within(card).getByText(T.mergedLabel('Prod', ['prod', 'PRD']))).toBeInTheDocument()
    expect(within(card).getByText(/Relation to Person/)).toBeInTheDocument()
    const apply = screen.getByRole('button', { name: T.apply })
    expect(apply).toBeDisabled()
    expect(screen.getByText(T.undecidedCount(2))).toBeInTheDocument()

    await user.click(within(card).getByRole('button', { name: T.accept }))
    expect(apply).toBeDisabled()
    const book = screen.getByRole('group', { name: T.itemLabel('Book') })
    await user.click(within(book).getByRole('button', { name: T.reject }))
    expect(apply).toBeEnabled()
    expect(m.saveProposalReview).toHaveBeenLastCalledWith('b1', [
      { id: 'g1', status: 'accepted' },
      { id: 'g2', status: 'rejected' },
    ])
    await user.click(apply)
    expect(m.applyProposal).toHaveBeenCalledWith('b1')
    expect(await screen.findByText(T.applied(1, 0))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: T.next }))
    expect(onApplied).toHaveBeenCalled()
  })

  test('says why an item will be skipped and which properties were left out; the summary names the skipped (fix pass H)', async () => {
    const memo = {
      id: 'g3',
      action: 'create' as const,
      name: 'Memo',
      documentCount: 3,
      examples: ['Memo 1'],
      properties: [],
      problems: ['A new type needs at least 10 documents (3 here); use or extend an existing type instead.'],
      dropped: [{ key: 'mood', name: 'Mood', reason: 'It has a value in 10% of the group; a property needs at least 30%.' }],
    }
    m.importProposal.mockResolvedValue({ proposal: { groups: [memo, PROPOSAL.groups[1]] }, review: null })
    m.applyProposal.mockResolvedValue({
      created: [],
      extended: [],
      skipped: [
        { id: 'g3', reason: memo.problems[0] },
        { id: 'g2', reason: 'Turned down.' },
      ],
    })
    const user = userEvent.setup()
    render(<ProposalStep batch="b1" onApplied={vi.fn()} />)
    const card = await screen.findByRole('group', { name: T.itemLabel('Memo') })
    expect(within(card).getByText(T.willSkip(memo.problems[0]))).toBeInTheDocument()
    expect(within(card).getByText(T.droppedLine('Mood', memo.dropped[0].reason))).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: T.accept }))
    await user.click(within(screen.getByRole('group', { name: T.itemLabel('Book') })).getByRole('button', { name: T.reject }))
    await user.click(screen.getByRole('button', { name: T.apply }))
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Skipped: Memo (A new type needs at least 10 documents (3 here); use or extend an existing type instead).')
    expect(status).not.toHaveTextContent('Book')
  })

  test('edit saves the new name and the dropped properties', async () => {
    m.importProposal.mockResolvedValue({ proposal: PROPOSAL, review: null })
    const user = userEvent.setup()
    render(<ProposalStep batch="b1" onApplied={vi.fn()} />)
    const card = await screen.findByRole('group', { name: T.itemLabel('Meeting') })
    await user.click(within(card).getByRole('button', { name: T.edit }))
    await user.click(within(card).getByRole('checkbox', { name: T.keepProperty('Owner') }))
    const name = within(card).getByRole('textbox', { name: T.nameLabel })
    await user.clear(name)
    await user.type(name, 'Sync')
    const last = m.saveProposalReview.mock.lastCall?.[1]
    expect(last).toEqual([{ id: 'g1', status: 'edited', edited: { name: 'Sync', plural: 'Meetings', dropProperties: ['owner'] } }])
  })

  test('a saved review is restored, and no proposal says so', async () => {
    m.importProposal.mockResolvedValueOnce({ proposal: null, review: null })
    render(<ProposalStep batch="b1" onApplied={vi.fn()} />)
    expect(await screen.findByText(T.noProposal)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: T.apply })).toBeDisabled()
    m.importProposal.mockResolvedValueOnce({
      proposal: PROPOSAL,
      review: { items: [{ id: 'g1', status: 'accepted' }, { id: 'g2', status: 'accepted' }] },
    })
    await userEvent.setup().click(screen.getByRole('button', { name: T.refresh }))
    await screen.findByRole('group', { name: T.itemLabel('Meeting') })
    expect(screen.getByRole('button', { name: T.apply })).toBeEnabled()
  })
})

describe('TrialStep', () => {
  test('shows values with quotes, marks them, shows accuracy and continues with the rest', async () => {
    m.filingStatus.mockResolvedValue(trialStatus())
    const onDone = vi.fn()
    const user = userEvent.setup()
    render(<TrialStep batch="b1" onDone={onDone} />)
    const alpha = await screen.findByRole('group', { name: 'Alpha' })
    expect(within(alpha).getByText('We shipped to prod')).toBeInTheDocument()
    expect(within(alpha).getByText(T.confidence.high)).toBeInTheDocument()
    // the tags a result adds, with their quote (fix pass H)
    expect(within(alpha).getByText(T.tagsLabel)).toBeInTheDocument()
    expect(within(alpha).getByText(/Release/)).toBeInTheDocument()
    expect(within(alpha).getByText('release notes')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Beta' })).getByText(`(${T.valueRejected})`)).toBeInTheDocument()
    expect(screen.getByText(T.noMarks)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: T.markLabel(T.right, 'Alpha') }))
    await user.click(screen.getByRole('button', { name: T.markLabel(T.wrong, 'Beta') }))
    expect(m.markFiling).toHaveBeenCalledWith('b1', 'a.md', 'right')
    expect(m.markFiling).toHaveBeenCalledWith('b1', 'b.md', 'wrong')
    expect(screen.getByText(T.accuracy(1, 2, 50))).toBeInTheDocument()

    m.filingStatus.mockResolvedValue(trialStatus({ state: 'done', normalise: [{ kind: 'tag', values: ['Prod', 'PRD'], suggested: 'Prod' }] }))
    await user.click(screen.getByRole('button', { name: T.continueRest }))
    expect(m.continueFiling).toHaveBeenCalledWith('b1')
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(onDone.mock.calls[0][0].normalise).toHaveLength(1)
  })

  test('an idle pass offers to start the trial, then polls while it runs', async () => {
    m.filingStatus.mockResolvedValueOnce(trialStatus({ state: 'idle', trial: { items: [], rightShare: null } }))
    const user = userEvent.setup()
    render(<TrialStep batch="b1" onDone={vi.fn()} />)
    m.filingStatus.mockResolvedValue(trialStatus({ state: 'running', trial: { items: [], rightShare: null } }))
    await user.click(await screen.findByRole('button', { name: T.startTrial }))
    expect(m.startFiling).toHaveBeenCalledWith('b1', true)
    expect(await screen.findByText(T.trialRunning)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: T.continueRest })).toBeDisabled()
    m.filingStatus.mockResolvedValue(trialStatus())
    await screen.findByRole('group', { name: 'Alpha' })
    expect(screen.getByRole('button', { name: T.continueRest })).toBeEnabled()
  })

  test('a failed run says so', async () => {
    m.filingStatus.mockResolvedValue(trialStatus({ state: 'failed' }))
    render(<TrialStep batch="b1" onDone={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(T.failed)
  })

  // Audit 2026-11-07 #42: a failed first status load is retried, so the Start button comes.
  test('a failed first load is tried again until it answers', async () => {
    m.filingStatus
      .mockRejectedValueOnce(new Error('Server not reachable'))
      .mockRejectedValueOnce(new Error('Server not reachable'))
      .mockResolvedValue(trialStatus({ state: 'idle', trial: { items: [], rightShare: null } }))
    render(<TrialStep batch="b1" onDone={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Server not reachable')
    expect(await screen.findByRole('button', { name: T.startTrial })).toBeEnabled()
    expect(screen.queryByRole('alert')).toBeNull()
    // The next try starts only after the last one failed, and none follows the answer: exactly 3.
    expect(m.filingStatus).toHaveBeenCalledTimes(3)
  })

  // Fix-pass L1: a retry never starts while the last try is still waiting for its answer.
  test('a retry of the first load never overlaps a pending request', async () => {
    let answer: (s: FilingStatus) => void = () => {}
    m.filingStatus
      .mockRejectedValueOnce(new Error('Server not reachable'))
      .mockImplementationOnce(() => new Promise<FilingStatus>((resolve) => (answer = resolve)))
    render(<TrialStep batch="b1" onDone={vi.fn()} />)
    await waitFor(() => expect(m.filingStatus).toHaveBeenCalledTimes(2))
    // Many poll periods pass while the second try waits: no third request starts.
    await new Promise((r) => setTimeout(r, agentTiming.pollMs * 8))
    expect(m.filingStatus).toHaveBeenCalledTimes(2)
    answer(trialStatus({ state: 'idle', trial: { items: [], rightShare: null } }))
    expect(await screen.findByRole('button', { name: T.startTrial })).toBeEnabled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // Fix-pass L1: a failed status load's error goes once a later load answers.
  test('a failed poll error goes once a later poll answers', async () => {
    const running = trialStatus({ state: 'running', trial: { items: [], rightShare: null } })
    m.filingStatus
      .mockResolvedValueOnce(running)
      .mockRejectedValueOnce(new Error('Server not reachable'))
      .mockResolvedValue(running)
    render(<TrialStep batch="b1" onDone={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Server not reachable')
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})

describe('NormaliseStep', () => {
  test('merges the accepted groups into the chosen value', async () => {
    const onDone = vi.fn()
    const user = userEvent.setup()
    render(
      <NormaliseStep
        batch="b1"
        suggestions={[
          { kind: 'tag', values: ['Prod', 'Production', 'PRD'], suggested: 'Production' },
          { kind: 'option', values: ['Dev', 'dev'], suggested: 'Dev' },
        ]}
        onDone={onDone}
      />,
    )
    await user.click(screen.getByRole('checkbox', { name: T.mergeLabel(['Dev', 'dev']) }))
    await user.click(screen.getByRole('button', { name: T.mergeCount(1) }))
    expect(m.normaliseFiling).toHaveBeenCalledWith('b1', [{ from: ['Prod', 'PRD'], to: 'Production' }])
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  test('nothing to merge offers Continue', async () => {
    const onDone = vi.fn()
    render(<NormaliseStep batch="b1" suggestions={[]} onDone={onDone} />)
    expect(screen.getByText(T.normaliseNone)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: T.next }))
    expect(onDone).toHaveBeenCalled()
  })
})

describe('AgentFlow finish', () => {
  test('the Import inbox count links to that collection', async () => {
    m.collections.mockResolvedValue([{ id: 'inbox', name: 'Import inbox' } as never])
    m.rows.mockResolvedValue([{}, {}, {}] as never)
    const onClose = vi.fn()
    const open = vi.spyOn(useTabs.getState(), 'open')
    const user = userEvent.setup()
    render(<AgentFlow batch="b1" initial="done" onClose={onClose} />)
    expect(await screen.findByText(T.inboxCount(3))).toBeInTheDocument()
    expect(m.rows).toHaveBeenCalledWith({ collectionIds: ['inbox'], preview: false })
    await user.click(screen.getByRole('button', { name: T.openInbox }))
    expect(onClose).toHaveBeenCalled()
    expect(open).toHaveBeenCalledWith({ kind: 'collection', id: 'inbox' })
  })

  test('walks proposal, trial, normalise, done', async () => {
    m.importProposal.mockResolvedValue({ proposal: { groups: [PROPOSAL.groups[1]] }, review: { items: [{ id: 'g2', status: 'accepted' }] } })
    m.applyProposal.mockResolvedValue({ created: [], extended: [] })
    m.filingStatus.mockResolvedValue(trialStatus({ state: 'done' }))
    m.collections.mockResolvedValue([])
    const user = userEvent.setup()
    render(<AgentFlow batch="b1" onClose={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: T.apply }))
    await user.click(await screen.findByRole('button', { name: T.next }))
    await screen.findByRole('heading', { name: T.normaliseHeading })
    await user.click(screen.getByRole('button', { name: T.next }))
    expect(await screen.findByText(T.inboxEmpty)).toBeInTheDocument()
  })
})

describe('M30 the Entities step in the agent flow', () => {
  const merge = { kind: 'tag' as const, values: ['Prod', 'PRD'], suggested: 'Prod' }

  test('trial status entities goes to the Entities step', async () => {
    m.importProposal.mockResolvedValue({ proposal: null, review: null })
    m.filingStatus.mockResolvedValue(trialStatus({ keepAsSources: true }))
    const user = userEvent.setup()
    render(<AgentFlow batch="b1" onClose={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: T.skip }))
    await screen.findByRole('group', { name: 'Alpha' })
    m.filingStatus.mockResolvedValue(trialStatus({ state: 'entities', keepAsSources: true }))
    await user.click(screen.getByRole('button', { name: T.continueRest }))
    expect(await screen.findByRole('heading', { name: T.entitiesHeading })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: T.trialHeading })).toBeNull()

    m.filingStatus.mockResolvedValue(trialStatus({ state: 'done', keepAsSources: true, normalise: [merge] }))
    await user.click(screen.getByRole('button', { name: T.next }))
    await screen.findByRole('heading', { name: T.normaliseHeading })
    expect(screen.getByRole('checkbox', { name: T.mergeLabel(['Prod', 'PRD']) })).toBeInTheDocument()
  })

  test('done without Sources skips the step', async () => {
    m.importProposal.mockResolvedValue({ proposal: null, review: null })
    m.filingStatus.mockResolvedValue(trialStatus())
    const user = userEvent.setup()
    render(<AgentFlow batch="b1" onClose={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: T.skip }))
    await screen.findByRole('group', { name: 'Alpha' })
    m.filingStatus.mockResolvedValue(trialStatus({ state: 'done', keepAsSources: false, normalise: [merge] }))
    await user.click(screen.getByRole('button', { name: T.continueRest }))
    await screen.findByRole('heading', { name: T.normaliseHeading })
    expect(screen.getByRole('checkbox', { name: T.mergeLabel(['Prod', 'PRD']) })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: T.entitiesHeading })).toBeNull()
  })

  test('a reopened dialog in entities state resumes there', async () => {
    m.filingStatus.mockResolvedValue(trialStatus({ state: 'entities', keepAsSources: true }))
    const onDone = vi.fn()
    const step = render(<TrialStep batch="b1" onDone={onDone} />)
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(onDone.mock.calls[0][0].state).toBe('entities')
    step.unmount()

    m.importProposal.mockResolvedValue({ proposal: null, review: null })
    const user = userEvent.setup()
    render(<AgentFlow batch="b1" onClose={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: T.skip }))
    expect(await screen.findByRole('heading', { name: T.entitiesHeading })).toBeInTheDocument()
  })

  test('trial items show main entity and mentions', async () => {
    const [alphaItem, betaItem] = trialStatus().trial.items
    m.filingStatus.mockResolvedValue(
      trialStatus({
        keepAsSources: true,
        trial: {
          items: [
            {
              ...alphaItem,
              mainEntity: { type: 'Host', name: 'APP01' },
              entities: [
                { type: 'Software', name: 'SQL Server 2019', ok: true },
                { type: 'Location', name: 'HQ', ok: true },
                { type: 'Host', name: 'Rack 4', ok: false },
              ],
            },
            { ...betaItem, mainEntity: null, entities: [] },
          ],
          rightShare: null,
        },
      }),
    )
    render(<TrialStep batch="b1" onDone={vi.fn()} />)
    const alpha = await screen.findByRole('group', { name: 'Alpha' })
    expect(within(alpha).getByText(T.mainEntity('Host', 'APP01'))).toBeInTheDocument()
    expect(within(alpha).getByText(T.mentions(['SQL Server 2019', 'HQ']))).toBeInTheDocument()
    const beta = screen.getByRole('group', { name: 'Beta' })
    expect(within(beta).queryByText(/^About:/)).toBeNull()
    expect(within(beta).queryByText(/^Mentions:/)).toBeNull()
  })

  test('polling stops in entities and writing', async () => {
    const onDone = vi.fn()
    m.filingStatus.mockResolvedValue(trialStatus({ state: 'running', keepAsSources: true, trial: { items: [], rightShare: null } }))
    const step = render(<TrialStep batch="b1" onDone={onDone} />)
    await waitFor(() => expect(m.filingStatus.mock.calls.length).toBeGreaterThan(2))
    m.filingStatus.mockResolvedValue(trialStatus({ state: 'entities', keepAsSources: true }))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    const settled = m.filingStatus.mock.calls.length
    await new Promise((r) => setTimeout(r, agentTiming.pollMs * 8))
    expect(m.filingStatus).toHaveBeenCalledTimes(settled)
    step.unmount()

    // Continue with the rest into a Write already running: no poll either (EntitiesStep owns it), handed over once.
    vi.clearAllMocks()
    const later = vi.fn()
    m.filingStatus.mockResolvedValue(trialStatus({ keepAsSources: true }))
    const user = userEvent.setup()
    render(<TrialStep batch="b2" onDone={later} />)
    await screen.findByRole('group', { name: 'Alpha' })
    m.filingStatus.mockResolvedValue(trialStatus({ state: 'writing', keepAsSources: true }))
    await user.click(screen.getByRole('button', { name: T.continueRest }))
    await waitFor(() => expect(later).toHaveBeenCalledTimes(1))
    const calls = m.filingStatus.mock.calls.length
    await new Promise((r) => setTimeout(r, agentTiming.pollMs * 8))
    expect(m.filingStatus).toHaveBeenCalledTimes(calls)
    expect(later).toHaveBeenCalledTimes(1)
  })
})

describe('M30 the proposal offer', () => {
  test('the proposal offers the existing type', async () => {
    const server = {
      id: 'g9',
      action: 'create' as const,
      name: 'Server',
      documentCount: 14,
      examples: ['APP01'],
      properties: [],
      problems: ['Host has the same properties.'],
      offer: { label: 'Use Host, with a category', typeId: 'host', category: 'Server' },
    }
    m.importProposal.mockResolvedValue({ proposal: { groups: [server, PROPOSAL.groups[1]] }, review: null })
    const user = userEvent.setup()
    render(<ProposalStep batch="b1" onApplied={vi.fn()} />)
    const card = await screen.findByRole('group', { name: T.itemLabel('Server') })
    expect(within(card).getByText(T.willSkip(server.problems[0]))).toBeInTheDocument()
    const offer = within(card).getByRole('button', { name: 'Use Host, with a category' })
    await user.click(offer)
    expect(m.saveProposalReview).toHaveBeenLastCalledWith('b1', [{ id: 'g9', status: 'edited', edited: { useType: 'host', category: 'Server' } }])
    expect(offer).toHaveAttribute('aria-pressed', 'true')
    expect(within(card).getByText(T.status.edited)).toBeInTheDocument()
    const book = screen.getByRole('group', { name: T.itemLabel('Book') })
    expect(within(book).queryByRole('button', { name: /with a category/ })).toBeNull()
  })
})
