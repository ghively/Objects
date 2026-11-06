import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import { ledgerSummary } from '@/test/mockApi'
import { LEDGER_PAGE, LedgerList } from './LedgerList'
import { LEARNING_TEXT as T } from './learningText'

const mocked = vi.mocked(api)
const RESEARCHER = '01JC7ZK3T9Q4M2X8B5N6R1V0WE'
const A = '01JLEDGER00000000000000001'
const B = '01JLEDGER00000000000000002'

describe('LedgerList', () => {
  beforeEach(() => vi.clearAllMocks())

  test('test History undo calls the route and shows a 409 message in the row', async () => {
    mocked.agentLedger.mockResolvedValue({
      entries: [
        ledgerSummary({ id: B, target: 'skill', action: 'patch', skill: 'rack-labels', line: "Patched 'rack-labels'", source: { kind: 'review', run: 'r1' } }),
        ledgerSummary({ id: A, source: { kind: 'user' } }),
      ],
      more: false,
    })
    const user = userEvent.setup()
    render(<LedgerList agentId={RESEARCHER} query={{ skill: 'rack-labels' }} />)
    const list = await screen.findByRole('list', { name: T.history })
    expect(mocked.agentLedger).toHaveBeenCalledWith(RESEARCHER, expect.objectContaining({ skill: 'rack-labels', limit: LEDGER_PAGE }))
    const rows = within(list).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent("Patched 'rack-labels'")
    expect(rows[0]).toHaveTextContent('by a review')
    expect(rows[1]).toHaveTextContent('by you')

    await user.click(within(rows[1]).getByRole('button', { name: `${T.undo}: Saved a memory` }))
    expect(mocked.undoLedgerEntry).toHaveBeenCalledWith(RESEARCHER, A)
    // A successful undo reloads the list.
    await waitFor(() => expect(mocked.agentLedger).toHaveBeenCalledTimes(2))

    mocked.undoLedgerEntry.mockRejectedValueOnce(new ConflictError(''))
    await user.click(within(within(screen.getByRole('list', { name: T.history })).getAllByRole('listitem')[0]).getByRole('button', { name: /Undo/ }))
    const row = within(screen.getByRole('list', { name: T.history })).getAllByRole('listitem')[0]
    expect(await within(row).findByRole('alert')).toHaveTextContent(T.undoConflict)
    expect(mocked.undoLedgerEntry).toHaveBeenLastCalledWith(RESEARCHER, B)
  })

  test('test Show more pages with before and readOnly disables Undo', async () => {
    mocked.agentLedger
      .mockResolvedValueOnce({ entries: [ledgerSummary({ id: B })], more: true })
      .mockResolvedValueOnce({ entries: [ledgerSummary({ id: A, line: 'Changed a memory' })], more: false })
    const user = userEvent.setup()
    render(<LedgerList agentId={RESEARCHER} query={{ target: 'memory' }} readOnly />)
    await user.click(await screen.findByRole('button', { name: T.showMore }))
    expect(mocked.agentLedger).toHaveBeenLastCalledWith(RESEARCHER, expect.objectContaining({ target: 'memory', before: B }))
    expect(await screen.findByText('Changed a memory')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: T.showMore })).toBeNull()
    for (const b of screen.getAllByRole('button', { name: /Undo/ })) expect(b).toBeDisabled()
  })
})
