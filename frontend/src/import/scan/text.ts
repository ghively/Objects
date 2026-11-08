// The scan step's visible strings (M26; design section 6).
export const SCAN_TEXT = {
  heading: 'Check for sensitive content',
  intro: 'This scan runs on your computer. Nothing is sent anywhere, and the findings never show the matched text.',
  leaveOutLabel: 'Leave out (one folder or pattern per line)',
  leaveOutHint: 'Left-out folders and files are never read.',
  scan: 'Scan',
  scanning: 'Scanning…',
  back: 'Back',
  continue: 'Continue',
  noFindings: 'Nothing sensitive was found.',
  /** The counts line; files the scan could not read (binaries, over-size, nested zips) are never counted as clean. */
  summary: (scanned: number, flagged: number, leftOut: number, unscanned = 0) =>
    `${scanned} file${scanned === 1 ? '' : 's'} scanned, ${flagged} flagged, ${leftOut} left out` +
    `${unscanned > 0 ? `, ${unscanned} could not be checked` : ''}.`,
  uncheckedNote: 'Files that could not be checked are imported without "Exclude from AI".',
  flaggedHeading: 'Flagged files',
  choiceLabel: (file: string) => `What to do with ${file}`,
  excludeFromAi: 'Import, excluded from AI',
  leaveOut: 'Leave out',
  leftOutHeading: 'Left out',
  kinds: {
    'private-key': 'Private key',
    'api-key': 'API key or token',
    password: 'Password assignment',
    'connection-string': 'Connection string',
    'card-number': 'Card number',
  } as Record<string, string>,
  finding: (kind: string, line: number) => `${kind}, line ${line}`,
}
