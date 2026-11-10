// M30 T12: "Keep pages as Sources" in the import wizard, against the mock API. The box sits in the
// review step's options for every source kind and target, starts checked for every import (Gene,
// 2026-11-09), and its value goes to every preview and to the start; unchecked, pages are filed into
// their mapped types as before.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
  announceResync: vi.fn(),
}))
vi.mock('./scan/scanApi', () => ({
  scanSource: vi.fn(async () => ({
    findings: {},
    leftOut: [],
    counts: { scanned: 1, unscanned: 0, flagged: 0, findings: 0, leftOut: 0 },
    defaultChoice: 'excludeFromAi',
  })),
}))

import { api } from '@/api/client'
import type { ImportPlannedType, ImportPreview, ImportPreviewRequest, TypeDef } from '@/api/types'
import { resetSpaceInfo } from '@/settings/useSpaceInfo'
import { IMPORT_TEXT, ImportDialog, importTiming } from './ImportDialog'
import { resetImportDialog, useImportDialog } from './useImportDialog'

const T = IMPORT_TEXT
const mocked = vi.mocked(api)
const saved = { ...importTiming }

const SPACE = {
  name: 'Work',
  root: '/home/gene/Spaces/Work',
  types: [{ id: 't-host', name: 'Host', pluralName: 'Hosts' } as TypeDef],
  icon: null,
  description: null,
  hideTaskManagement: false,
  revision: '',
}

function planned(key: string, name: string, pluralName: string, originLabel: string, objectCount: number): ImportPlannedType {
  return {
    key,
    name,
    pluralName,
    origin: key === 'page' ? 'page' : 'folder',
    originLabel,
    objectCount,
    existingTypeId: null,
    skip: false,
    properties: [],
  }
}

/** The server's preview: one planned type, Source, when the pages are kept as Sources; else the mapped types. */
function preview(req: ImportPreviewRequest): ImportPreview {
  const types = req.keepAsSources
    ? [planned('source', 'Source', 'Sources', 'Every page', 6)]
    : [planned('folder:Servers', 'Server', 'Servers', 'Folder Servers', 4), planned('page', 'Page', 'Pages', 'Files at the top', 2)]
  return {
    previewId: 'preview-30',
    sourcePath: req.source.path,
    kind: 'obsidian',
    detected: 'obsidian',
    container: 'folder',
    suggestedName: 'Ops',
    counts: {
      objects: 6,
      types: types.length,
      properties: 0,
      attachments: 0,
      attachmentBytes: 0,
      links: 0,
      resolvedLinks: 0,
      unresolvedLinks: 0,
      renamed: 0,
      skipped: 0,
    },
    types,
    mapping: { typeSource: req.mapping?.typeSource ?? 'folder', typeKey: req.mapping?.typeKey ?? null, types: {}, properties: {} },
    frontmatterKeys: [],
    folders: [['Servers', 4]],
    samples: [],
    skipped: [],
    warnings: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetImportDialog()
  resetSpaceInfo()
  importTiming.pollMs = 5
  importTiming.debounceMs = 5
  mocked.space.mockResolvedValue(SPACE)
  mocked.importPreview.mockImplementation(async (req) => preview(req))
})

afterEach(() => {
  Object.assign(importTiming, saved)
})

/** Open the dialog, preview the folder and pass the scan; resolves on the review step. */
async function review() {
  const user = userEvent.setup()
  render(<ImportDialog />)
  act(() => useImportDialog.getState().open({}))
  await screen.findByRole('dialog', { name: T.title })
  await user.type(screen.getByRole('textbox', { name: T.source }), '/home/gene/Downloads/ops{Enter}')
  await user.click(await screen.findByRole('button', { name: 'Scan' }))
  await user.click(await screen.findByRole('button', { name: 'Continue' }))
  await screen.findByRole('heading', { name: T.summaryHeading })
  return user
}

function box() {
  return screen.getByRole('checkbox', { name: T.keepAsSources })
}

/** The planned types the mapping lists, by their origin label. */
function typeRows() {
  const list = screen.getByRole('list', { name: T.types })
  return within(list)
    .queryAllByRole('group')
    .map((g) => document.getElementById(g.getAttribute('aria-labelledby') ?? '')?.textContent ?? '')
}

async function startImport(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByRole('button', { name: T.import })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: T.import }))
  await waitFor(() => expect(mocked.startImport).toHaveBeenCalledTimes(1))
  return mocked.startImport.mock.lastCall?.[0]
}

describe('M30: Keep pages as Sources in the import wizard', () => {
  test('on by default for every import', async () => {
    const user = await review()
    // A plain mapped import into a new space (no originals, no copy) still shows the box, checked, with its help.
    expect(box()).toBeChecked()
    expect(box()).toHaveAccessibleDescription(T.keepAsSourcesHelp)
    expect(screen.getByText(T.keepAsSourcesHelp)).toBeInTheDocument()
    // The first preview already asked for Sources, so the review shows what will be written.
    expect(mocked.importPreview.mock.calls[0][0]).toMatchObject({ keepAsSources: true })
    expect(typeRows()).toEqual(['Every page'])
    // Into this space, too.
    await user.click(screen.getByRole('radio', { name: T.thisSpaceNamed('Work') }))
    await waitFor(() => expect(mocked.importPreview.mock.lastCall?.[0]).toMatchObject({ target: 'currentSpace', keepAsSources: true }))
    expect(box()).toBeChecked()
    expect(await startImport(user)).toMatchObject({ keepAsSources: true })
  })

  test('on sends true and re-previews', async () => {
    const user = await review()
    await user.click(box())
    await waitFor(() => expect(typeRows()).toEqual(['Folder Servers', 'Files at the top']))
    const before = mocked.importPreview.mock.calls.length
    await user.click(box())
    expect(box()).toBeChecked()
    await waitFor(() => expect(mocked.importPreview.mock.calls.length).toBe(before + 1))
    expect(mocked.importPreview.mock.lastCall?.[0]).toMatchObject({ keepAsSources: true })
    // The re-preview's one planned type, Source, is the line under the mapping.
    await waitFor(() => expect(typeRows()).toEqual(['Every page']))
    expect(await startImport(user)).toMatchObject({ keepAsSources: true })
  })

  test('unchecking sends false', async () => {
    const user = await review()
    await user.click(box())
    expect(box()).not.toBeChecked()
    await waitFor(() => expect(mocked.importPreview.mock.lastCall?.[0]).toMatchObject({ keepAsSources: false }))
    // The re-preview shows the mapped types again.
    await waitFor(() => expect(typeRows()).toEqual(['Folder Servers', 'Files at the top']))
    const req = await startImport(user)
    expect(req).toMatchObject({ keepAsSources: false, previewId: 'preview-30' })
  })
})
