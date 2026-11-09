// M24 Task 10: the Captures view.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import { captureItem } from '@/test/mockApi'
import { resetWorkData, useWorkData } from '../state/useWorkData'
import { resetWorkToasts, useWorkToasts } from '../state/workToasts'
import { workViews } from '../views/registry'
import { CapturesView } from './CapturesView'
import './registerView'
import { resetCaptures, useCaptures } from './useCaptures'

const mocked = vi.mocked(api)
const NOW = new Date('2026-11-05T10:00:00.000Z')
const NEW = captureItem()
const ASK = captureItem({ path: 'Captures/b.md', title: 'Order toner', status: 'needsYou', question: 'Which line?', version: 'v7' })
const DONE = captureItem({ path: 'Captures/c.md', title: 'Fix lamp', status: 'filed', filedTo: { path: 'Tasks/Fix lamp.md', title: 'Fix lamp task' } })

const show = () => render(<CapturesView data={useWorkData.getState()} now={NOW} />)

describe('CapturesView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkData()
    resetWorkToasts()
    resetCaptures()
    mocked.captureItems.mockResolvedValue([NEW, ASK, DONE])
  })

  test('lists captures and filters by status', async () => {
    show()
    expect(await screen.findByText('Tray 2 jams again')).toBeTruthy()
    expect(screen.getByText('Order toner')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Filed' }))
    expect(screen.queryByText('Tray 2 jams again')).toBeNull()
    expect(screen.getByText('Fix lamp')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Filed to Fix lamp task/ })).toBeTruthy()
  })

  // Fix pass H: a parked dump picked on Now opens here on Needs you with its reply box focused.
  test('a capture asked for by Now opens on Needs you with its reply box focused', async () => {
    useCaptures.getState().reply(ASK.path)
    show()
    const box = await screen.findByRole('textbox', { name: 'Reply to the agent' })
    await waitFor(() => expect(document.activeElement).toBe(box))
    expect(screen.getByRole('button', { name: 'Needs you' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Tray 2 jams again')).toBeNull()
    expect(useCaptures.getState().replyTo).toBeNull()
  })

  test('empty state', async () => {
    mocked.captureItems.mockResolvedValue([])
    show()
    expect(await screen.findByText('Nothing waiting to be filed.')).toBeTruthy()
  })

  test('Needs you shows the question; Send posts the reply with the row version', async () => {
    mocked.replyCapture.mockResolvedValue(captureItem({ ...ASK, status: 'new' }))
    show()
    expect(await screen.findByText(/Which line\?/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Reply to the agent'), { target: { value: 'Line 3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(mocked.replyCapture).toHaveBeenCalledWith('Captures/b.md', 'v7', 'Line 3'))
  })

  test('Mark filed posts, then the reload shows Filed', async () => {
    mocked.markCaptureFiled.mockResolvedValue(captureItem({ ...ASK, status: 'filed' }))
    show()
    await screen.findByText(/Which line\?/)
    mocked.captureItems.mockResolvedValue([NEW, { ...ASK, status: 'filed', question: null }, DONE])
    fireEvent.click(screen.getByRole('button', { name: 'Mark filed' }))
    await waitFor(() => expect(mocked.markCaptureFiled).toHaveBeenCalledWith('Captures/b.md', 'v7'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark filed' })).toBeNull())
    const row = document.querySelector('[data-capture-row="Captures/b.md"]') as HTMLElement
    expect(within(row).getByText('Filed')).toBeTruthy()
  })

  test('a conflict reloads and toasts', async () => {
    mocked.markCaptureFiled.mockRejectedValue(new ConflictError('v8'))
    show()
    await screen.findByText(/Which line\?/)
    fireEvent.click(screen.getByRole('button', { name: 'Mark filed' }))
    await waitFor(() => expect(useWorkToasts.getState().toasts).toHaveLength(1))
    expect(mocked.captureItems).toHaveBeenCalledTimes(2)
  })

  test('registered as Captures with its count', async () => {
    const def = workViews().find((v) => v.id === 'captures')!
    expect(def.label).toBe('Captures')
    show()
    await screen.findByText('Order toner')
    expect(def.count(useWorkData.getState(), NOW)).toBe(2)
  })
})
