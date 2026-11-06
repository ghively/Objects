import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

// Object's editor reports its Markdown after typing and on blur; a textarea stands in for it here.
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

import { api, RevisionConflictError } from '@/api/client'
import { agent } from '@/test/mockApi'
import { INSTRUCTIONS_SAVE_MS, INSTRUCTIONS_TEXT, InstructionsTab } from './InstructionsTab'

const mocked = vi.mocked(api)
const RESEARCHER = '01JC7ZK3T9Q4M2X8B5N6R1V0WE'

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('InstructionsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: false })
  })
  afterEach(() => vi.useRealTimers())

  test('test Instructions autosaves and keeps the text on 409', async () => {
    mocked.agentInstructions.mockResolvedValue({ text: 'You read papers.', revision: 'i1' })
    mocked.saveAgentInstructions.mockResolvedValueOnce({ revision: 'i2' })
    render(<InstructionsTab agent={agent({ id: RESEARCHER })} />)
    await settle()
    const editor = screen.getByRole('textbox', { name: INSTRUCTIONS_TEXT.editor })
    expect(editor).toHaveValue('You read papers.')
    expect(mocked.agentInstructions).toHaveBeenCalledWith(RESEARCHER)

    // 1,000 ms after the last change, not before.
    fireEvent.change(editor, { target: { value: 'You read papers. Be brief.' } })
    await act(async () => {
      vi.advanceTimersByTime(INSTRUCTIONS_SAVE_MS - 1)
    })
    expect(mocked.saveAgentInstructions).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    await settle()
    expect(mocked.saveAgentInstructions).toHaveBeenCalledWith(RESEARCHER, 'You read papers. Be brief.', 'i1')

    // On blur at once, with the new revision; a 409 keeps the text and offers a reload.
    mocked.saveAgentInstructions.mockRejectedValueOnce(new RevisionConflictError('i9'))
    fireEvent.change(editor, { target: { value: 'You read papers. Be very brief.' } })
    fireEvent.blur(editor)
    await settle()
    expect(mocked.saveAgentInstructions).toHaveBeenLastCalledWith(RESEARCHER, 'You read papers. Be very brief.', 'i2')
    expect(screen.getByRole('alert')).toHaveTextContent(INSTRUCTIONS_TEXT.conflict)
    expect(screen.getByRole('textbox', { name: INSTRUCTIONS_TEXT.editor })).toHaveValue('You read papers. Be very brief.')
    // Nothing more is saved over the other change until the user reloads.
    fireEvent.change(editor, { target: { value: 'You read papers. Be very, very brief.' } })
    await act(async () => {
      vi.advanceTimersByTime(INSTRUCTIONS_SAVE_MS * 2)
    })
    await settle()
    expect(mocked.saveAgentInstructions).toHaveBeenCalledTimes(2)

    mocked.agentInstructions.mockResolvedValueOnce({ text: 'Changed in another editor.', revision: 'i9' })
    fireEvent.click(screen.getByRole('button', { name: INSTRUCTIONS_TEXT.reload }))
    await settle()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('textbox', { name: INSTRUCTIONS_TEXT.editor })).toHaveValue('Changed in another editor.')
  })
})
