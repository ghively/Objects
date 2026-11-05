import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { automationRule, objectSummary, propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetAutomations } from '@/automations/useAutomations'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { TemplateManager, templatesAllowed } from './TemplateManager'

const mocked = vi.mocked(api)
const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
const DAILYNOTE = typeDef({
  id: 'dailynote',
  name: 'DailyNote',
  basic: true,
  revision: 'rd',
  propertyDefinitions: [TITLE],
  templates: { ids: ['t-plan'], defaultTemplateId: null },
})
const TAG = typeDef({ id: 'tag', name: 'Tag', basic: true, propertyDefinitions: [TITLE] })

beforeEach(() => {
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  useLinkIndex.setState({ types: [DAILYNOTE, TAG], objects: [], loaded: true })
  mocked.templates.mockImplementation(async (typeId: string) =>
    typeId === 'dailynote'
      ? [objectSummary({ path: 'Templates/DailyNotes/Plan.md', id: 't-plan', type: 'dailynote', template: 'Plan' })]
      : [],
  )
})

describe('TemplateManager', () => {
  test('templatesAllowed includes DailyNote, not Tag', () => {
    expect(templatesAllowed(DAILYNOTE)).toBe(true)
    expect(templatesAllowed(TAG)).toBe(false)
    expect(templatesAllowed({ basic: true, name: 'Page' })).toBe(true)
    expect(templatesAllowed({ basic: true, name: 'Task' })).toBe(true)
  })

  test('test DailyNote template group enabled with Empty Note and Mark as Default', async () => {
    const user = userEvent.setup()
    render(<TemplateManager typeId="dailynote" />)
    const plan = await screen.findByRole('listitem', { name: 'Plan' })
    const empty = screen.getByRole('listitem', { name: 'Empty Note' })
    // "Empty Note" comes first and is the default while no template is marked.
    expect(screen.getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Empty Note', 'Plan'])
    expect(within(empty).getByText('Default')).toBeInTheDocument()
    expect(within(empty).queryByRole('button', { name: 'Mark as Default' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New Template' })).toBeEnabled()
    await user.click(within(plan).getByRole('button', { name: 'Mark as Default' }))
    await waitFor(() => expect(mocked.saveType).toHaveBeenCalledTimes(1))
    expect(mocked.saveType.mock.calls[0][0].templates).toEqual({ ids: ['t-plan'], defaultTemplateId: 't-plan' })
    // Back to the empty note.
    const emptyAgain = await screen.findByRole('listitem', { name: 'Empty Note' })
    await waitFor(() => expect(within(emptyAgain).getByRole('button', { name: 'Mark as Default' })).toBeInTheDocument())
    await user.click(within(emptyAgain).getByRole('button', { name: 'Mark as Default' }))
    await waitFor(() => expect(mocked.saveType).toHaveBeenCalledTimes(2))
    expect(mocked.saveType.mock.calls[1][0].templates).toEqual({ ids: ['t-plan'], defaultTemplateId: null })
  })

  test('Tag still has no templates', () => {
    render(<TemplateManager typeId="tag" />)
    expect(screen.getByText('Templates are not available for this object type.')).toBeInTheDocument()
    expect(screen.queryByRole('listitem', { name: 'Empty Note' })).not.toBeInTheDocument()
  })

  test('M14: a repeating template shows "Repeats"; Repeat opens its dialog', async () => {
    resetAutomations()
    mocked.automations.mockResolvedValueOnce([
      automationRule({
        id: 'rep',
        name: 'Repeat “Plan”',
        trigger: { kind: 'schedule', repeat: 'every day', time: '07:00', start: '2026-11-05' },
        templateRepeat: { typeId: 'dailynote', templateId: 't-plan' },
      }),
    ])
    const user = userEvent.setup()
    render(<TemplateManager typeId="dailynote" />)
    const plan = await screen.findByRole('listitem', { name: 'Plan' })
    await waitFor(() => expect(within(plan).getByText('Repeats')).toBeInTheDocument())
    expect(within(screen.getByRole('listitem', { name: 'Empty Note' })).queryByRole('button', { name: 'Repeat' })).toBeNull()
    await user.click(within(plan).getByRole('button', { name: 'Repeat' }))
    const dialog = await screen.findByRole('dialog', { name: 'Repeat template' })
    expect(within(dialog).getByRole('button', { name: 'Remove repeat' })).toBeInTheDocument()
  })
})
