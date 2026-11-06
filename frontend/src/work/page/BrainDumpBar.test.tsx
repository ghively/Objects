// M23 Task 9: the brain-dump bar: Enter posts the text and the view; success clears; the M23 seam's
// 501 keeps the text and says why; empty Enter sends nothing; no toast on success.
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { CaptureSummary } from '@/api/types'
import { resetWorkToasts, useWorkToasts } from '../state/workToasts'
import { BrainDumpBar } from './BrainDumpBar'

const mocked = vi.mocked(api)
const box = () => screen.getByRole('textbox', { name: 'Brain dump' })

const saved: CaptureSummary = {
  path: 'Captures/Tray 2.md',
  text: 'Tray 2 squeaks',
  status: 'new',
  question: null,
  capturedAt: '2026-11-05T10:00:00Z',
  linkedPath: null,
}

describe('BrainDumpBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkToasts()
  })

  test('test enter posts the text and the view', async () => {
    const user = userEvent.setup()
    mocked.workCapture.mockResolvedValueOnce(saved)
    render(<BrainDumpBar view="flow" />)
    expect(box()).toHaveAttribute('placeholder', 'Brain dump: type and press Enter')
    await user.type(box(), 'Tray 2 squeaks{Enter}')
    expect(mocked.workCapture).toHaveBeenCalledTimes(1)
    expect(mocked.workCapture).toHaveBeenCalledWith({ text: 'Tray 2 squeaks', fromView: 'flow' })
  })

  test('test success clears the field and shows no toast', async () => {
    const user = userEvent.setup()
    mocked.workCapture.mockResolvedValueOnce(saved)
    render(<BrainDumpBar view="now" />)
    await user.type(box(), 'Tray 2 squeaks{Enter}')
    await act(async () => {})
    expect(box()).toHaveValue('')
    expect(useWorkToasts.getState().toasts).toEqual([])
  })

  test('test the M23 seam keeps the text and says why', async () => {
    const user = userEvent.setup()
    render(<BrainDumpBar view="now" />)
    await user.type(box(), 'Tray 2 squeaks{Enter}')
    await act(async () => {})
    expect(box()).toHaveValue('Tray 2 squeaks')
    expect(screen.getByText('Saving a brain dump comes with M24.')).toBeInTheDocument()
    expect(useWorkToasts.getState().toasts).toEqual([])
  })

  test('test empty enter sends nothing', async () => {
    const user = userEvent.setup()
    render(<BrainDumpBar view="now" />)
    await user.type(box(), '{Enter}')
    await user.type(box(), '   {Enter}')
    expect(mocked.workCapture).not.toHaveBeenCalled()
  })
})
