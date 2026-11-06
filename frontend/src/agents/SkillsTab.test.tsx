import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

vi.mock('@/editor/StringEditor', () => ({
  StringEditor: (props: { value: string; onChange(v: string): void; onBlur?(): void; readOnly?: boolean; ariaLabel?: string }) => (
    <textarea
      aria-label={props.ariaLabel}
      defaultValue={props.value}
      readOnly={props.readOnly}
      onChange={(e) => props.onChange(e.target.value)}
      onBlur={() => props.onBlur?.()}
    />
  ),
}))

import { api, ConflictError } from '@/api/client'
import type { ChangeEvent } from '@/api/types'
import { agent, learningState, ledgerSummary, skillSummary } from '@/test/mockApi'
import { useLearningFocus } from './learningFocus'
import { LEARNING_TEXT as T } from './learningText'
import { SkillsTab, TIDY_BUSY } from './SkillsTab'

const mocked = vi.mocked(api)
const RESEARCHER = '01JC7ZK3T9Q4M2X8B5N6R1V0WE'

function emit(e: Partial<ChangeEvent>) {
  for (const [cb] of mocked.onChange.mock.calls) cb({ kind: 'agentLearning', path: RESEARCHER, version: null, ...e } as ChangeEvent)
}

describe('SkillsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useLearningFocus.getState().clear()
  })

  test('test the list shows state, pinned, uses, last used and who made it', async () => {
    mocked.agentSkills.mockResolvedValue([
      skillSummary({ name: 'rack-labels', uses: 3, lastUsed: '2026-11-04T10:00:00.000Z', pinned: true }),
      skillSummary({ name: 'old-notes', description: 'Old notes', state: 'stale', createdBy: 'user' }),
    ])
    const user = userEvent.setup()
    render(<SkillsTab agent={agent({ id: RESEARCHER })} />)
    const table = await screen.findByRole('table', { name: T.skillsTab })
    expect(mocked.agentSkills).toHaveBeenCalledWith(RESEARCHER)
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual([T.skillName, T.skillDescription, T.skillState, T.skillPinned, T.skillUses, T.skillLastUsed, T.skillMadeBy])

    const [, rack, old] = within(table).getAllByRole('row')
    expect(rack).toHaveTextContent('rack-labels')
    expect(rack).toHaveTextContent('How to label server racks')
    expect(rack).toHaveTextContent('Active')
    expect(within(rack).getByRole('img', { name: T.skillPinned })).toBeInTheDocument()
    expect(within(rack).getAllByRole('cell')[4]).toHaveTextContent('3')
    expect(within(rack).getAllByRole('cell')[5]).not.toHaveTextContent(T.never)
    expect(rack).toHaveTextContent('Agent')

    expect(old).toHaveTextContent('Stale')
    expect(within(old).queryByRole('img', { name: T.skillPinned })).toBeNull()
    expect(within(old).getAllByRole('cell')[5]).toHaveTextContent(T.never)
    expect(old).toHaveTextContent('You')

    // The filter narrows by name or description.
    await user.type(screen.getByRole('searchbox', { name: T.filterSkills }), 'old')
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(within(table).queryByText('rack-labels')).toBeNull()
  })

  test('test Show archived lists archived skills and Restore brings one back', async () => {
    mocked.agentSkills.mockImplementation(async (_id, archived) =>
      archived
        ? [skillSummary({ name: 'narrow-skill', state: 'archived', absorbedInto: 'broad-skill' })]
        : [skillSummary({ name: 'broad-skill' })],
    )
    mocked.agentSkill.mockResolvedValue({
      ...skillSummary({ name: 'narrow-skill', state: 'archived', absorbedInto: 'broad-skill' }),
      text: '---\nname: narrow-skill\n---\nBody',
      revision: 'r1',
      files: [{ path: 'SKILL.md', size: 30 }],
    })
    const user = userEvent.setup()
    render(<SkillsTab agent={agent({ id: RESEARCHER })} />)
    const table = await screen.findByRole('table', { name: T.skillsTab })
    expect(within(table).queryByText('narrow-skill')).toBeNull()

    await user.click(screen.getByRole('switch', { name: T.showArchived }))
    await waitFor(() => expect(mocked.agentSkills).toHaveBeenCalledWith(RESEARCHER, true))
    const row = (await within(table).findByText('narrow-skill')).closest('tr') as HTMLElement
    expect(row).toHaveTextContent('Archived')

    await user.click(within(row).getByRole('button', { name: 'narrow-skill' }))
    await waitFor(() => expect(mocked.agentSkill).toHaveBeenCalledWith(RESEARCHER, 'narrow-skill', true))
    expect(await screen.findByText(T.absorbedInto('broad-skill'))).toBeInTheDocument()
    // An archived skill isn't edited.
    expect(screen.getByRole('textbox', { name: 'SKILL.md' })).toHaveAttribute('readonly')

    await user.click(screen.getByRole('button', { name: T.restore }))
    expect(mocked.restoreAgentSkill).toHaveBeenCalledWith(RESEARCHER, 'narrow-skill')
    // Restored, it shows as active: Archive is offered again and the skill is read as active.
    expect(await screen.findByRole('button', { name: T.archive })).toBeInTheDocument()
    await waitFor(() => expect(mocked.agentSkill).toHaveBeenLastCalledWith(RESEARCHER, 'narrow-skill', false))
  })

  test('test Tidy up now shows Tidying up and then the report', async () => {
    const user = userEvent.setup()
    render(<SkillsTab agent={agent({ id: RESEARCHER })} />)
    const button = await screen.findByRole('button', { name: T.tidyUp })
    expect(document.querySelector('[data-tidy-report]')).toBeNull()

    await user.click(button)
    expect(mocked.tidyAgentSkills).toHaveBeenCalledWith(RESEARCHER)
    expect(screen.getByRole('button', { name: T.tidying })).toBeDisabled()

    // An event while it runs keeps the label.
    mocked.agentLearning.mockResolvedValueOnce(learningState({ curator: { lastRunAt: null, nextDueAt: null, running: true, report: null } }))
    await act(async () => emit({}))
    expect(await screen.findByRole('button', { name: T.tidying })).toBeInTheDocument()

    // The run's end: the report shows under the list.
    const at = '2026-11-05T10:00:00.000Z'
    mocked.agentLearning.mockResolvedValue(
      learningState({
        curator: { lastRunAt: at, nextDueAt: null, running: false, report: { at, runId: '01JTIDY0000000000000000000', text: 'Merged narrow-skill into broad-skill.' } },
      }),
    )
    await act(async () => emit({}))
    expect(await screen.findByRole('button', { name: T.tidyUp })).toBeEnabled()
    const report = document.querySelector('[data-tidy-report]') as HTMLElement
    expect(report).toHaveTextContent('Last tidy-up,')
    expect(report).toHaveTextContent('Merged narrow-skill into broad-skill.')

    // A 409 shows its text.
    mocked.tidyAgentSkills.mockRejectedValueOnce(new ConflictError(''))
    await user.click(screen.getByRole('button', { name: T.tidyUp }))
    expect(await screen.findByRole('alert')).toHaveTextContent(TIDY_BUSY)
    expect(screen.getByRole('button', { name: T.tidyUp })).toBeEnabled()
  })

  test('test a learning-line focus opens the changed skill', async () => {
    mocked.agentSkills.mockResolvedValue([skillSummary({ name: 'rack-labels' })])
    mocked.agentLedgerEntry.mockResolvedValue({
      ...ledgerSummary({ id: '01JLEDGER00000000000000002', target: 'skill', action: 'patch', skill: 'rack-labels', line: "Patched 'rack-labels'" }),
      before: 'a',
      after: 'b',
      encoding: 'text',
    })
    mocked.agentSkill.mockResolvedValue({
      ...skillSummary({ name: 'rack-labels' }),
      text: '---\nname: rack-labels\n---\nBody',
      revision: 'r1',
      files: [{ path: 'SKILL.md', size: 30 }],
    })
    mocked.agentLedger.mockResolvedValue({
      entries: [ledgerSummary({ id: '01JLEDGER00000000000000002', target: 'skill', action: 'patch', skill: 'rack-labels', line: "Patched 'rack-labels'" })],
      more: false,
    })
    useLearningFocus.getState().set(RESEARCHER, ['01JLEDGER00000000000000002'])
    render(<SkillsTab agent={agent({ id: RESEARCHER })} />)
    await waitFor(() => expect(mocked.agentSkill).toHaveBeenCalledWith(RESEARCHER, 'rack-labels', false))
    expect(mocked.agentLedgerEntry).toHaveBeenCalledWith(RESEARCHER, '01JLEDGER00000000000000002')
    expect(await screen.findByRole('heading', { name: 'rack-labels' })).toBeInTheDocument()
    const row = await waitFor(() => {
      const r = document.querySelector('[data-entry="01JLEDGER00000000000000002"]')
      expect(r).not.toBeNull()
      return r as HTMLElement
    })
    expect(row).toHaveAttribute('data-highlighted')
  })
})
