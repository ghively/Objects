import { act, fireEvent, render, screen, within } from '@testing-library/react'
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
import type { ChangeEvent, MemoryFile } from '@/api/types'
import { agent, ledgerSummary } from '@/test/mockApi'
import { useLearningFocus } from './learningFocus'
import { LEARNING_TEXT as T } from './learningText'
import { MEMORY_SAVE_MS, MemoryTab } from './MemoryTab'

const mocked = vi.mocked(api)
const RESEARCHER = '01JC7ZK3T9Q4M2X8B5N6R1V0WE'

function file(target: MemoryFile['target'], text: string, revision: string | null, cap?: number): MemoryFile {
  const entries = text ? text.split('\n§\n') : []
  return { target, text, entries, chars: Array.from(text).length, cap: cap ?? (target === 'memory' ? 2200 : 1375), revision }
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

describe('MemoryTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useLearningFocus.getState().clear()
    vi.useFakeTimers({ shouldAdvanceTime: false })
  })
  afterEach(() => vi.useRealTimers())

  test('test Memory shows both files with their size against the cap', async () => {
    mocked.agentMemory.mockResolvedValue({
      memory: file('memory', 'Racks are labelled by row.\n§\nThe lab is in building 2.', 'm1'),
      user: file('user', 'Prefers short answers.', 'u1'),
    })
    render(<MemoryTab agent={agent({ id: RESEARCHER })} />)
    await settle()
    expect(mocked.agentMemory).toHaveBeenCalledWith(RESEARCHER)

    const memory = screen.getByRole('region', { name: T.memory })
    expect(within(memory).getByText(T.memoryIntro)).toBeInTheDocument()
    expect(within(memory).getByRole('textbox', { name: T.memory })).toHaveValue('Racks are labelled by row.\n§\nThe lab is in building 2.')
    expect(within(memory).getByText('54 / 2,200 characters')).toBeInTheDocument()

    const user = screen.getByRole('region', { name: T.user })
    expect(within(user).getByText(T.userIntro)).toBeInTheDocument()
    expect(within(user).getByRole('textbox', { name: T.user })).toHaveValue('Prefers short answers.')
    expect(within(user).getByText('22 / 1,375 characters')).toBeInTheDocument()

    // History of both files.
    expect(mocked.agentLedger).toHaveBeenCalledWith(RESEARCHER, expect.objectContaining({ target: 'memory' }))
    expect(mocked.agentLedger).toHaveBeenCalledWith(RESEARCHER, expect.objectContaining({ target: 'user' }))
    expect(screen.getByRole('heading', { name: T.history })).toBeInTheDocument()
  })

  test('test editing memory autosaves with the revision and reloads on 409', async () => {
    mocked.agentMemory.mockResolvedValue({ memory: file('memory', 'One.', 'm1'), user: file('user', '', null) })
    mocked.saveAgentMemory.mockResolvedValueOnce(file('memory', 'One.\n§\nTwo.', 'm2'))
    render(<MemoryTab agent={agent({ id: RESEARCHER })} />)
    await settle()
    const editor = screen.getByRole('textbox', { name: T.memory })

    // 1,000 ms after the last change, not before.
    fireEvent.change(editor, { target: { value: 'One.\n§\nTwo.' } })
    await act(async () => {
      vi.advanceTimersByTime(MEMORY_SAVE_MS - 1)
    })
    expect(mocked.saveAgentMemory).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    await settle()
    expect(mocked.saveAgentMemory).toHaveBeenCalledWith(RESEARCHER, 'memory', 'One.\n§\nTwo.', 'm1')

    // On blur at once, with the new revision; a 409 keeps the text and offers a reload.
    mocked.saveAgentMemory.mockRejectedValueOnce(new RevisionConflictError('m9'))
    fireEvent.change(editor, { target: { value: 'One.\n§\nTwo.\n§\nThree.' } })
    fireEvent.blur(editor)
    await settle()
    expect(mocked.saveAgentMemory).toHaveBeenLastCalledWith(RESEARCHER, 'memory', 'One.\n§\nTwo.\n§\nThree.', 'm2')
    const memory = screen.getByRole('region', { name: T.memory })
    expect(within(memory).getByRole('alert')).toHaveTextContent(T.conflict)
    expect(screen.getByRole('textbox', { name: T.memory })).toHaveValue('One.\n§\nTwo.\n§\nThree.')

    // An event doesn't replace unsaved text.
    mocked.agentMemory.mockResolvedValue({ memory: file('memory', 'Changed by a review.', 'm9'), user: file('user', '', null) })
    const listener = mocked.onChange.mock.calls.map((c) => c[0])
    await act(async () => {
      for (const cb of listener) cb({ kind: 'agentLearning', path: RESEARCHER, version: null } as ChangeEvent)
    })
    await settle()
    expect(screen.getByRole('textbox', { name: T.memory })).toHaveValue('One.\n§\nTwo.\n§\nThree.')

    // Reload shows the file's text and saves next with its revision.
    fireEvent.click(within(memory).getByRole('button', { name: T.reload }))
    await settle()
    expect(within(memory).queryByRole('alert')).toBeNull()
    expect(screen.getByRole('textbox', { name: T.memory })).toHaveValue('Changed by a review.')
    mocked.saveAgentMemory.mockResolvedValueOnce(file('memory', 'Changed by a review. Kept.', 'm10'))
    fireEvent.change(screen.getByRole('textbox', { name: T.memory }), { target: { value: 'Changed by a review. Kept.' } })
    fireEvent.blur(screen.getByRole('textbox', { name: T.memory }))
    await settle()
    expect(mocked.saveAgentMemory).toHaveBeenLastCalledWith(RESEARCHER, 'memory', 'Changed by a review. Kept.', 'm9')
  })

  test('test over the cap the size turns red and says why', async () => {
    mocked.agentMemory.mockResolvedValue({ memory: file('memory', 'é'.repeat(200), 'm1', 200), user: file('user', '', null) })
    render(<MemoryTab agent={agent({ id: RESEARCHER })} />)
    await settle()
    const memory = screen.getByRole('region', { name: T.memory })
    // Characters, not bytes: 200 two-byte characters are at the cap, not over it.
    const size = memory.querySelector('[data-size]') as HTMLElement
    expect(size).toHaveTextContent('200 / 200 characters')
    expect(size).not.toHaveAttribute('data-over')
    expect(within(memory).queryByText(T.overCap)).toBeNull()

    fireEvent.change(within(memory).getByRole('textbox', { name: T.memory }), { target: { value: 'é'.repeat(201) } })
    expect(size).toHaveTextContent('201 / 200 characters')
    expect(size).toHaveAttribute('data-over')
    expect(size).toHaveClass('text-danger')
    expect(within(memory).getByText(T.overCap)).toBeInTheDocument()
  })

  test('test highlighted entries from a learning line are marked', async () => {
    mocked.agentLedger.mockImplementation(async (_id, q) => ({
      entries:
        q?.target === 'memory'
          ? [ledgerSummary({ id: '01JLEDGER00000000000000002', at: '2026-11-05T09:02:00.000Z' }), ledgerSummary({ id: '01JLEDGER00000000000000001' })]
          : [ledgerSummary({ id: '01JLEDGER00000000000000003', target: 'user', line: 'Saved a memory about you', at: '2026-11-05T09:01:00.000Z' })],
      more: false,
    }))
    useLearningFocus.getState().set(RESEARCHER, ['01JLEDGER00000000000000003'])
    render(<MemoryTab agent={agent({ id: RESEARCHER })} />)
    await settle()
    const rows = [...document.querySelectorAll('[data-entry]')]
    // Both files' entries, newest first.
    expect(rows.map((r) => r.getAttribute('data-entry'))).toEqual([
      '01JLEDGER00000000000000002',
      '01JLEDGER00000000000000003',
      '01JLEDGER00000000000000001',
    ])
    expect(rows.filter((r) => r.hasAttribute('data-highlighted')).map((r) => r.getAttribute('data-entry'))).toEqual([
      '01JLEDGER00000000000000003',
    ])
    expect(rows[1]).toHaveTextContent('Saved a memory about you')

    // Another agent's focus highlights nothing here.
    act(() => useLearningFocus.getState().set('assistant', ['01JLEDGER00000000000000003']))
    expect(document.querySelectorAll('[data-highlighted]')).toHaveLength(0)
  })
})
