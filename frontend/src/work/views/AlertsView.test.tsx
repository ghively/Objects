// M23 Task 13: Alerts: grouped by severity with counts, cleared ones folded, the source strip,
// Check now, the no-folder line and All quiet.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import type { AlertRow, WorkAlerts } from '@/api/types'
import { workAlerts, workBoard } from '@/test/mockApi'
import { resetWorkData, useWorkData } from '../state/useWorkData'
import { AlertsView } from './AlertsView'

const mocked = vi.mocked(api)
const NOW = new Date('2026-11-05T10:00:00.000Z')

function alert(over: Partial<AlertRow>): AlertRow {
  return {
    path: 'Alerts/Tray 2 jammed.md',
    title: 'Tray 2 jammed',
    source: 'printer-watch',
    severity: 'Critical',
    message: 'PRN-TEST-01: tray 2 reports a jam',
    raisedAt: '2026-11-05T09:40:00.000Z',
    clearedAt: null,
    link: 'https://example.test/printers/PRN-TEST-01',
    active: true,
    ...over,
  }
}

const ALERTS: WorkAlerts = workAlerts({
  folder: 'C:/Monitoring',
  typeExists: true,
  alerts: [
    alert({}),
    alert({ path: 'Alerts/Toner low.md', title: 'Toner low', severity: 'Warning', message: 'PRN-TEST-01: toner at 8%' }),
    alert({ path: 'Alerts/Nightly ok.md', title: 'Nightly report sent', severity: 'Info', message: null, link: null }),
    alert({ path: 'Alerts/Old jam.md', title: 'Old jam', active: false, clearedAt: '2026-11-04T12:00:00.000Z' }),
  ],
  counts: { Critical: 1, Warning: 1, Info: 1 },
  sources: [
    { source: 'printer-watch', file: 'printer-watch.json', generated: '2026-11-05T09:50:00.000Z', ok: true, error: null, stale: false, staleAfterMinutes: 30 },
    { source: 'backup-check', file: 'backup-check.json', generated: '2026-11-03T06:00:00.000Z', ok: true, error: null, stale: true, staleAfterMinutes: 2880 },
    { source: 'broken', file: 'broken.json', generated: null, ok: false, error: "Can't read broken.json: not a JSON object", stale: true, staleAfterMinutes: 2880 },
  ],
})

function show(alerts: WorkAlerts = ALERTS) {
  useWorkData.setState({ board: workBoard([]), alerts })
  return render(<AlertsView data={useWorkData.getState()} now={NOW} />)
}

describe('AlertsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkData()
  })

  test('test critical before warning before info with counts', () => {
    show()
    const groups = [...document.querySelectorAll('[data-alert-group]')].map((g) => g.getAttribute('data-alert-group'))
    expect(groups).toEqual(['Critical', 'Warning', 'Info'])
    const critical = screen.getByRole('region', { name: 'Critical' })
    expect(within(critical).getByText('1')).toBeInTheDocument()
    const row = within(critical).getByText('Tray 2 jammed').closest('[data-alert]') as HTMLElement
    expect(within(row).getByText('printer-watch')).toBeInTheDocument()
    expect(within(row).getByText('PRN-TEST-01: tray 2 reports a jam')).toBeInTheDocument()
    expect(within(row).getByRole('link')).toHaveAttribute('href', 'https://example.test/printers/PRN-TEST-01')
    expect(within(row).getByText('09:40')).toBeInTheDocument()
    expect(row.querySelector('[data-tone="critical"]')).not.toBeNull()
  })

  test('test an unsafe link renders no anchor', () => {
    show(workAlerts({ alerts: [alert({ link: 'javascript:alert(1)' }), alert({ path: 'Alerts/b.md', title: 'B', link: 'https://example.test/b' })] }))
    const unsafe = screen.getByText('Tray 2 jammed').closest('[data-alert]') as HTMLElement
    expect(within(unsafe).queryByRole('link')).toBeNull()
    const ok = screen.getByText('B').closest('[data-alert]') as HTMLElement
    expect(within(ok).getByRole('link')).toHaveAttribute('href', 'https://example.test/b')
  })

  test('test cleared alerts are folded', () => {
    show()
    const cleared = document.querySelector('details[data-alerts-cleared]') as HTMLDetailsElement
    expect(cleared).not.toBeNull()
    expect(cleared.open).toBe(false)
    expect(within(cleared).getByText('Cleared')).toBeInTheDocument()
    expect(within(cleared).getByText('Old jam')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Critical' })).not.toHaveTextContent('Old jam')
  })

  test('test the stale and failing sources show', () => {
    show()
    const strip = document.querySelector('[data-alert-sources]') as HTMLElement
    expect(within(strip).getByText(/^backup-check isn't fresh: last report /)).toBeInTheDocument()
    expect(within(strip).getByText("Can't read broken.json: not a JSON object")).toBeInTheDocument()
    expect(strip).not.toHaveTextContent('printer-watch')
  })

  test('test check now scans and shows the new list', async () => {
    mocked.scanAlerts.mockResolvedValueOnce({
      report: { files: 1, created: 1, updated: 0, cleared: 0, unchanged: 0, errors: [] },
      alerts: workAlerts({ folder: 'C:/Monitoring', alerts: [alert({ title: 'Tray 3 jammed', path: 'Alerts/Tray 3 jammed.md' })], counts: { Critical: 1, Warning: 0, Info: 0 } }),
    })
    show(workAlerts({ folder: 'C:/Monitoring' }))
    expect(screen.getByText('All quiet')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
    })
    expect(mocked.scanAlerts).toHaveBeenCalledTimes(1)
    expect(useWorkData.getState().alerts?.alerts[0].title).toBe('Tray 3 jammed')
    expect(screen.getByText('Tray 3 jammed')).toBeInTheDocument()
    expect(screen.queryByText('All quiet')).toBeNull()
  })

  test('test all quiet and the folder line', () => {
    show(workAlerts())
    expect(screen.getByText('All quiet')).toBeInTheDocument()
    expect(screen.getByText('Pick a monitoring folder in Settings > Work.')).toBeInTheDocument()
  })
})
