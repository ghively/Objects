import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { parsePatterns, ScanStep } from './ScanStep'
import type { ScanReport } from './scanApi'

const REPORT: ScanReport = {
  findings: { 'Notes/bad.md': [{ kind: 'card-number', line: 2 }], 'a.env': [{ kind: 'password', line: 1 }, { kind: 'api-key', line: 4 }] },
  leftOut: ['Credentials/keys.txt'],
  counts: { scanned: 5, unscanned: 0, flagged: 2, findings: 3, leftOut: 1 },
  defaultChoice: 'excludeFromAi',
}

describe('ScanStep', () => {
  test('parsePatterns trims and drops empty lines', () => {
    expect(parsePatterns(' Credentials \n\n*.local\r\n')).toEqual(['Credentials', '*.local'])
  })

  test('scans with the leave-out list, shows findings without values and defaults to excluded from AI', async () => {
    const scan = vi.fn(async () => REPORT)
    const onDone = vi.fn()
    const user = userEvent.setup()
    render(<ScanStep sourcePath="/src" scan={scan} onDone={onDone} />)
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await user.type(screen.getByLabelText(/Leave out \(one folder/), 'Credentials{enter}*.local')
    await user.click(screen.getByRole('button', { name: 'Scan' }))
    expect(scan).toHaveBeenCalledWith('/src', ['Credentials', '*.local'])
    expect(await screen.findByText('5 files scanned, 2 flagged, 1 left out.')).toBeInTheDocument()
    expect(screen.getByText('Card number, line 2')).toBeInTheDocument()
    expect(screen.getByText('Password assignment, line 1')).toBeInTheDocument()
    expect(screen.getByLabelText('What to do with Notes/bad.md')).toHaveValue('excludeFromAi')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onDone).toHaveBeenCalledWith({
      leaveOut: ['Credentials', '*.local'],
      leaveOutFiles: [],
      excludeFromAi: ['Notes/bad.md', 'a.env'],
      report: REPORT,
    })
  })

  test('files that could not be checked are counted and said to import unmarked', async () => {
    const user = userEvent.setup()
    const report = { ...REPORT, counts: { ...REPORT.counts, unscanned: 3 } }
    render(<ScanStep sourcePath="/src" scan={async () => report} onDone={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Scan' }))
    expect(await screen.findByText('5 files scanned, 2 flagged, 1 left out, 3 could not be checked.')).toBeInTheDocument()
    expect(screen.getByText('Files that could not be checked are imported without "Exclude from AI".')).toBeInTheDocument()
  })

  test('a per-file Leave out choice is passed on', async () => {
    const onDone = vi.fn()
    const user = userEvent.setup()
    render(<ScanStep sourcePath="/src" scan={async () => REPORT} onDone={onDone} />)
    await user.click(screen.getByRole('button', { name: 'Scan' }))
    await user.selectOptions(await screen.findByLabelText('What to do with a.env'), 'leaveOut')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    const out = onDone.mock.calls[0][0]
    expect(out.leaveOutFiles).toEqual(['a.env'])
    expect(out.excludeFromAi).toEqual(['Notes/bad.md'])
  })

  test('no findings and errors', async () => {
    const user = userEvent.setup()
    const scan = vi
      .fn()
      .mockRejectedValueOnce(new Error('No such file or folder'))
      .mockResolvedValueOnce({ ...REPORT, findings: {}, leftOut: [], counts: { scanned: 1, unscanned: 0, flagged: 0, findings: 0, leftOut: 0 } })
    render(<ScanStep sourcePath="/x" scan={scan} onDone={() => {}} onBack={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Scan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No such file or folder')
    await user.click(screen.getByRole('button', { name: 'Scan' }))
    expect(await screen.findByText('Nothing sensitive was found.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
  })
})
