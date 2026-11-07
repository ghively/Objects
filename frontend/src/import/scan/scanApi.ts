// M26: the sensitive-content scan route (`POST /api/import/scan`); reads only. Kept here so the
// shared API client stays untouched while the import files are being changed elsewhere.
export interface ScanFinding {
  kind: string
  line: number
}

export interface ScanReport {
  /** Relative path -> what was found (kind and line, never the value). */
  findings: Record<string, ScanFinding[]>
  leftOut: string[]
  counts: { scanned: number; unscanned: number; flagged: number; findings: number; leftOut: number }
  defaultChoice: 'excludeFromAi' | 'leaveOut'
}

export type ScanChoice = 'excludeFromAi' | 'leaveOut'

export async function scanSource(path: string, leaveOut: string[]): Promise<ScanReport> {
  const res = await fetch('/api/import/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ path, leaveOut }),
  })
  if (!res.ok) {
    let msg = `Scan failed (${res.status})`
    try {
      const d = await res.json()
      if (typeof d?.error === 'string') msg = d.error
      else if (typeof d?.detail === 'string') msg = d.detail
    } catch {
      /* keep the status message */
    }
    throw new Error(msg)
  }
  return (await res.json()) as ScanReport
}
