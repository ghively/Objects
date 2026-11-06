import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, RevisionConflictError } from '@/api/client'
import type { ChangeEvent } from '@/api/types'
import { resetAgents } from '@/agents/useAgents'
import { resetAutomations } from '@/automations/useAutomations'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { agent, agentSchedule, automationRule, automationRun, objectSummary, typeDef } from '@/test/mockApi'
import { resetSettingsModal } from '@/settings/useSettingsModal'
import { AutomationsSection } from './Automations'

const mocked = vi.mocked(api)
const TASK = typeDef({ id: 'task', name: 'Task' })

const BUTTON = automationRule({ id: 'r1', name: 'Stamp done', revision: 'a1' })
const CREATED = automationRule({
  id: 'r2',
  name: 'Tag new tasks',
  enabled: false,
  trigger: { kind: 'objectCreated', scope: { kind: 'type', id: 'task' } },
  lastRun: automationRun({ ruleId: 'r2', at: new Date(Date.now() - 5 * 60_000).toISOString(), status: 'failed', error: 'Tag not found' }),
})
const BROKEN = automationRule({ id: 'r3', name: 'Broken', readOnlyReason: 'This automation was written by a newer version.' })
const REPEAT = automationRule({
  id: 'r4',
  name: 'Repeat “Weekly review”',
  trigger: { kind: 'schedule', repeat: 'every week on mon', time: '09:00', start: '2026-11-09' },
  actions: [{ kind: 'createFromTemplate', typeId: 'task', templateId: 'tpl1', title: '', relateVia: null }],
  templateRepeat: { typeId: 'task', templateId: 'tpl1' },
})

beforeEach(() => {
  vi.clearAllMocks()
  resetAutomations()
  resetLinkIndex()
  resetSettingsModal()
  resetAgents()
  useLinkIndex.setState({ types: [TASK] })
  mocked.automations.mockResolvedValue([BUTTON, CREATED, BROKEN, REPEAT])
  mocked.templates.mockResolvedValue([objectSummary({ path: 'Templates/Weekly review.md', id: 'tpl1', title: 'Weekly review', template: 'Weekly review' })])
})

async function row(name: string) {
  return within(await screen.findByRole('listitem', { name }))
}

async function menu(name: string, item: string) {
  const user = userEvent.setup()
  await user.click((await row(name)).getByRole('button', { name: 'Automation menu' }))
  await user.click(await screen.findByRole('menuitem', { name: item }))
}

describe('AutomationsSection', () => {
  test('lists each rule with its switch, summary and last run', async () => {
    render(<AutomationsSection />)
    const button = await row('Stamp done')
    expect(button.getByRole('switch', { name: 'Turned on: Stamp done' })).toHaveAttribute('aria-checked', 'true')
    expect(button.getByTestId('rule-summary')).toHaveTextContent('When pressed')
    expect(button.getByTestId('rule-last-run')).toHaveTextContent('Never ran')

    const created = await row('Tag new tasks')
    expect(created.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    expect(created.getByTestId('rule-summary')).toHaveTextContent('When a Task is created')
    expect(created.getByTestId('rule-last-run')).toHaveTextContent('Failed 5 minutes ago: Tag not found')

    const repeat = await row('Repeat “Weekly review”')
    await waitFor(() => expect(repeat.getByTestId('rule-summary')).toHaveTextContent('Repeats template “Weekly review” · Every week on Monday at'))
  })

  test('an empty space says so', async () => {
    mocked.automations.mockResolvedValue([])
    render(<AutomationsSection />)
    expect(await screen.findByText('No automations yet')).toBeInTheDocument()
  })

  test('the switch saves the whole rule with enabled flipped', async () => {
    const user = userEvent.setup()
    render(<AutomationsSection />)
    await user.click((await row('Stamp done')).getByRole('switch'))
    await waitFor(() => expect(mocked.saveAutomation).toHaveBeenCalledWith({ ...BUTTON, enabled: false }, { baseRevision: 'a1' }))
    await waitFor(() => expect(mocked.automations).toHaveBeenCalledTimes(2))
  })

  test('a 409 on the switch reloads the rule and tries once more', async () => {
    const user = userEvent.setup()
    const fresh = { ...BUTTON, name: 'Stamp done!', revision: 'a2' }
    mocked.saveAutomation.mockRejectedValueOnce(new RevisionConflictError('a2'))
    mocked.automation.mockResolvedValue(fresh)
    render(<AutomationsSection />)
    await user.click((await row('Stamp done')).getByRole('switch'))
    await waitFor(() => expect(mocked.saveAutomation).toHaveBeenCalledTimes(2))
    expect(mocked.automation).toHaveBeenCalledWith('r1')
    expect(mocked.saveAutomation).toHaveBeenLastCalledWith({ ...fresh, enabled: false }, { baseRevision: 'a2' })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('a second failure is shown', async () => {
    const user = userEvent.setup()
    mocked.saveAutomation.mockRejectedValue(new RevisionConflictError('a2'))
    render(<AutomationsSection />)
    await user.click((await row('Stamp done')).getByRole('switch'))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(mocked.saveAutomation).toHaveBeenCalledTimes(2)
  })

  test('a rule that cannot be read shows why, with no switch, edit or delete', async () => {
    const user = userEvent.setup()
    render(<AutomationsSection />)
    const broken = await row('Broken')
    expect(broken.queryByRole('switch')).toBeNull()
    expect(broken.getByTestId('rule-summary')).toHaveTextContent('This automation was written by a newer version.')
    await user.click(broken.getByRole('button', { name: 'Automation menu' }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual(['Run log'])
  })

  test('Delete moves the rule to the trash', async () => {
    render(<AutomationsSection />)
    await menu('Stamp done', 'Delete')
    await waitFor(() => expect(mocked.deleteAutomation).toHaveBeenCalledWith('r1'))
  })

  test('Edit opens the rule editor with the rule', async () => {
    render(<AutomationsSection />)
    await menu('Stamp done', 'Edit')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByDisplayValue('Stamp done')).toBeInTheDocument()
  })

  test('Edit on a template repeat opens its Repeat dialog', async () => {
    render(<AutomationsSection />)
    await waitFor(async () => expect((await row('Repeat “Weekly review”')).getByTestId('rule-summary')).toHaveTextContent('Weekly review'))
    await menu('Repeat “Weekly review”', 'Edit')
    expect(await screen.findByRole('dialog', { name: 'Repeat template' })).toBeInTheDocument()
  })

  test('the run log lists runs newest first and follows run events', async () => {
    const listeners: ((e: ChangeEvent) => void)[] = []
    mocked.onChange.mockImplementation((cb) => {
      listeners.push(cb)
      return () => undefined
    })
    mocked.automationRuns.mockResolvedValue([
      automationRun({ ruleId: 'r2', id: 'run2', status: 'failed', error: 'Tag not found', trigger: { kind: 'objectCreated', path: 'Tasks/A.md', scheduledFor: null, catchUp: false } }),
      automationRun({ ruleId: 'r2', id: 'run1', status: 'ok', actions: [{ index: 0, kind: 'addTag', status: 'ok', path: 'Tasks/B.md', detail: null }] }),
    ])
    const user = userEvent.setup()
    render(<AutomationsSection />)
    await menu('Tag new tasks', 'Run log')
    expect(mocked.automationRuns).toHaveBeenCalledWith('r2')
    const log = await screen.findByRole('list', { name: 'Run log' })
    const entries = within(log).getAllByRole('listitem').filter((li) => li.hasAttribute('data-run'))
    expect(entries.map((e) => e.getAttribute('data-run'))).toEqual(['run2', 'run1'])
    expect(entries[0]).toHaveTextContent('Failed')
    expect(entries[0]).toHaveTextContent('Tag not found')
    expect(within(entries[0]).getByRole('button', { name: 'A' })).toBeInTheDocument()
    expect(entries[1]).toHaveTextContent('Add a tag')

    listeners.forEach((l) => l({ kind: 'automationRuns', path: 'r2' } as ChangeEvent))
    await waitFor(() => expect(mocked.automationRuns).toHaveBeenCalledTimes(2))

    await user.click(screen.getByRole('button', { name: 'Automations' }))
    expect(await screen.findByRole('listitem', { name: 'Stamp done' })).toBeInTheDocument()
  })

  // M21: agent schedules.
  const RESEARCHER = '01JC7ZK3T9Q4M2X8B5N6R1V0WE'
  const SCHEDULE = agentSchedule({
    id: 'r5',
    name: 'Weekly review',
    revision: 's1',
    actions: [{ kind: 'runAgent', agentId: RESEARCHER, prompt: 'Review last week.', model: null }],
  })
  const ORPHAN = agentSchedule({
    id: 'r6',
    name: 'Old digest',
    actions: [{ kind: 'runAgent', agentId: '01JC7ZK3T9Q4M2X8B5N6R1V0ZZ', prompt: 'Digest.', model: null }],
  })

  test('test an agent schedule row names its agent', async () => {
    mocked.automations.mockResolvedValue([BUTTON, SCHEDULE])
    mocked.agents.mockResolvedValue([agent({ id: 'assistant' }), agent({ id: RESEARCHER, name: 'Researcher' })])
    render(<AutomationsSection />)
    const sched = await row('Weekly review')
    await waitFor(() => expect(sched.getByTestId('rule-summary')).toHaveTextContent('Runs “Researcher” · Every week on Monday at'))
    expect(sched.getByRole('switch', { name: 'Turned on: Weekly review' })).toBeInTheDocument()
  })

  test('test Edit of an agent schedule opens the schedule dialog', async () => {
    mocked.automations.mockResolvedValue([SCHEDULE])
    mocked.agents.mockResolvedValue([agent({ id: RESEARCHER, name: 'Researcher' })])
    render(<AutomationsSection />)
    const sched = await row('Weekly review')
    await waitFor(() => expect(sched.getByTestId('rule-summary')).toHaveTextContent('Runs “Researcher”'))
    await menu('Weekly review', 'Edit')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Edit schedule')).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: 'Prompt' })).toHaveValue('Review last week.')
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  test('test a schedule of an unlisted agent says so', async () => {
    mocked.automations.mockResolvedValue([ORPHAN])
    mocked.agents.mockResolvedValue([agent({ id: RESEARCHER, name: 'Researcher' })])
    render(<AutomationsSection />)
    const sched = await row('Old digest')
    await waitFor(() => expect(sched.getByTestId('rule-summary')).toHaveTextContent("Runs an agent that isn't listed · Every week on Monday at"))
    await menu('Old digest', 'Edit')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Edit schedule')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(within(dialog).getByRole('alert')).toHaveTextContent("That agent isn't listed any more.")
  })
})
