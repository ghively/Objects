// M18: the chat's "Learning" line.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import { useLearningFocus } from '@/agents/learningFocus'
import { currentTarget, useTabs } from '@/nav/tabs'
import { reviewStatus } from '@/test/mockApi'
import { LEARNING_LINE_TEXT, LearningLine, memoryOnly } from './LearningLine'

const RESEARCHER = '01JRESEARCHER0000000000000'

beforeEach(() => {
  useTabs.getState().reset()
  useLearningFocus.getState().clear()
})

describe('LearningLine', () => {
  test('test running shows a spinner and Learning…', () => {
    const { container } = render(<LearningLine review={reviewStatus({ id: 'r1', state: 'running', summary: null })} agentId={RESEARCHER} />)
    expect(screen.getByRole('status')).toHaveTextContent(LEARNING_LINE_TEXT.running)
    expect(container.querySelector('[data-icon="ph-spinner-gap"]')).not.toBeNull()
    expect(container.firstElementChild).toHaveClass('text-xs', 'text-fg-muted')
  })

  test('test a done summary opens the skills tab with the entries focused', async () => {
    const user = userEvent.setup()
    render(<LearningLine review={reviewStatus({ id: 'r1', entryIds: ['e1'] })} agentId={RESEARCHER} />)
    await user.click(screen.getByRole('button', { name: 'Saved 1 memory, updated 1 skill' }))
    expect(useLearningFocus.getState()).toMatchObject({ agentId: RESEARCHER, entryIds: ['e1'] })
    expect(currentTarget(useTabs.getState())).toEqual({ kind: 'agent', id: RESEARCHER, tab: 'skills' })
  })

  test('test failed shows its message and nothing learned is plain text', () => {
    const { rerender } = render(
      <LearningLine review={reviewStatus({ id: 'r1', state: 'failed', summary: null, message: 'Timed out.' })} agentId={RESEARCHER} />,
    )
    expect(screen.getByText('Learning stopped: Timed out.')).toBeInTheDocument()
    rerender(<LearningLine review={reviewStatus({ id: 'r1', summary: 'Nothing new to learn', entryIds: [] })} agentId={RESEARCHER} />)
    expect(screen.getByText(LEARNING_LINE_TEXT.nothing)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('test memoryOnly reads the kinds and the summary', () => {
    expect(memoryOnly(reviewStatus({ id: 'r', kinds: ['memory'], summary: 'Saved 1 memory' }))).toBe(true)
    expect(memoryOnly(reviewStatus({ id: 'r', summary: 'Saved 2 memories, changed 1 memory' }))).toBe(true)
    expect(memoryOnly(reviewStatus({ id: 'r', summary: 'Saved 1 memory, updated 1 skill' }))).toBe(false)
    expect(memoryOnly(reviewStatus({ id: 'r', summary: 'Created 1 skill' }))).toBe(false)
  })
})
