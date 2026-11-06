import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ApiError, ConflictError } from '@/api/client'
import { LEARNING_TEXT as T } from './learningText'
import { NewSkillDialog } from './NewSkillDialog'

const mocked = vi.mocked(api)
const RESEARCHER = '01JC7ZK3T9Q4M2X8B5N6R1V0WE'

describe('NewSkillDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  test('test New skill counts the description and shows a 422', async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<NewSkillDialog agentId={RESEARCHER} open onOpenChange={onOpenChange} />)
    expect(screen.getByRole('heading', { name: T.newSkill })).toBeInTheDocument()
    expect(screen.getByText('0/60')).toBeInTheDocument()
    const create = screen.getByRole('button', { name: T.createSkill })
    expect(create).toBeDisabled()

    await user.type(screen.getByRole('textbox', { name: T.skillName }), 'Rack Labels')
    await user.type(screen.getByRole('textbox', { name: new RegExp(`^${T.skillDescription}`) }), 'How to label racks')
    expect(screen.getByText('18/60')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: T.instructions }), 'Use the row letter.')

    mocked.createAgentSkill.mockRejectedValueOnce(
      new ApiError(422, 'A skill name is at most 64 characters: lower-case letters, digits and hyphens.'),
    )
    await user.click(create)
    expect(mocked.createAgentSkill).toHaveBeenCalledWith(RESEARCHER, {
      name: 'Rack Labels',
      description: 'How to label racks',
      body: 'Use the row letter.',
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('A skill name is at most 64 characters')
    expect(onOpenChange).not.toHaveBeenCalled()

    // A taken name (409) says so.
    await user.clear(screen.getByRole('textbox', { name: T.skillName }))
    await user.type(screen.getByRole('textbox', { name: T.skillName }), 'rack-labels')
    mocked.createAgentSkill.mockRejectedValueOnce(new ConflictError(''))
    await user.click(create)
    expect(await screen.findByRole('alert')).toHaveTextContent("A skill named 'rack-labels' already exists.")

    // Over 60 the count turns red.
    await user.type(screen.getByRole('textbox', { name: new RegExp(`^${T.skillDescription}`) }), ' and the slots in each row of the lab')
    const count = document.querySelector('[data-count]') as HTMLElement
    expect(count).toHaveTextContent('55/60')
    await user.type(screen.getByRole('textbox', { name: new RegExp(`^${T.skillDescription}`) }), ' all.')
    expect(count).toHaveTextContent('60/60')
    expect(count).not.toHaveClass('text-danger')
    await user.type(screen.getByRole('textbox', { name: new RegExp(`^${T.skillDescription}`) }), '!')
    expect(count).toHaveTextContent('61/60')
    expect(count).toHaveClass('text-danger')

    // Created: the dialog closes.
    await user.click(create)
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
