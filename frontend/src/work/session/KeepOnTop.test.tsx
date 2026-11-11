// M23 Task 15: Keep on top: the Object window's on-top window when the server can open it, else
// Document Picture-in-Picture where the browser has it, else no button at all.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { WorkBoard } from '@/api/types'
import boardJson from '../__fixtures__/board.json'
import { resetWorkData, useWorkData } from '../state/useWorkData'
import { resetWorkToasts } from '../state/workToasts'
import { KeepOnTopButton } from './KeepOnTopButton'
import { WorkMini } from './WorkMini'
import { setWorkOn } from '@/test/workOn'

// M32: Work is on for the space in these tests (while it is off, nothing of the Work page runs).
beforeEach(() => setWorkOn())

const mocked = vi.mocked(api)
const BOARD = boardJson as unknown as WorkBoard

type PipWindow = Window & { documentPictureInPicture?: unknown }

describe('KeepOnTop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkData()
    resetWorkToasts()
  })
  afterEach(() => {
    delete (window as PipWindow).documentPictureInPicture
  })

  test('test the object window opens the on-top window', async () => {
    mocked.keepOnTopInfo.mockResolvedValueOnce({ window: true })
    mocked.openKeepOnTop.mockResolvedValueOnce(undefined)
    render(<KeepOnTopButton />)
    const button = await screen.findByRole('button', { name: 'Keep on top' })
    await act(async () => {
      fireEvent.click(button)
    })
    expect(mocked.openKeepOnTop).toHaveBeenCalledTimes(1)
    expect(mocked.keepOnTopInfo).toHaveBeenCalledTimes(1)
  })

  test('test no window and no picture in picture renders nothing', async () => {
    const { container } = render(<KeepOnTopButton />)
    await waitFor(() => expect(mocked.keepOnTopInfo).toHaveBeenCalled())
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('test picture in picture renders the mini page into its window', async () => {
    useWorkData.setState({ board: BOARD })
    const doc = document.implementation.createHTMLDocument('pip')
    const pipWindow = { document: doc, addEventListener: vi.fn() }
    const requestWindow = vi.fn(async () => pipWindow)
    ;(window as PipWindow).documentPictureInPicture = { requestWindow }
    document.documentElement.setAttribute('data-theme', 'lightDimmed')
    render(<KeepOnTopButton />)
    const button = await screen.findByRole('button', { name: 'Keep on top' })
    await act(async () => {
      fireEvent.click(button)
    })
    expect(requestWindow).toHaveBeenCalledWith({ width: 340, height: 430 })
    expect(mocked.openKeepOnTop).not.toHaveBeenCalled()
    expect(doc.documentElement.getAttribute('data-theme')).toBe('lightDimmed')
    const mini = doc.querySelector('[data-work-mini]')
    expect(mini).not.toBeNull()
    expect(mini?.textContent).toContain('Printer jams on line 3')
    document.documentElement.removeAttribute('data-theme')
  })

  test('test the mini page shows the focus line, the top item and a brain dump box', async () => {
    const { focusDay } = await import('@/test/mockApi')
    const focus = focusDay(['Get line 3 printing [[Printer jams on line 3|the printer]]'])
    focus.lines[0].links = [{ target: 'Printer jams on line 3', path: 'Tasks/Printer jams on line 3.md' }]
    useWorkData.setState({ board: BOARD, focus })
    render(<WorkMini />)
    // No line is selected: the current one (holding Now's top item) shows.
    expect(screen.getByText('1. Get line 3 printing the printer')).toBeInTheDocument()
    expect(screen.getByText('Printer jams on line 3')).toBeInTheDocument()
    expect(screen.getByText('Restart the print spooler on PRN-TEST-01')).toBeInTheDocument()
    const box = screen.getByRole('textbox', { name: 'Brain dump' })
    fireEvent.change(box, { target: { value: 'tray 2 again' } })
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' })
    })
    expect(mocked.workCapture).toHaveBeenCalledWith({ text: 'tray 2 again', fromView: 'keepOnTop' })
  })

  test('test the standalone mini page loads its own data', async () => {
    render(<WorkMini standalone />)
    await waitFor(() => expect(mocked.workBoard).toHaveBeenCalled())
    expect(mocked.workFocus).toHaveBeenCalled()
  })
})
