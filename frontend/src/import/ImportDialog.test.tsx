// M15 Lane U: the import dialog, against the mock API (source, preview summary, mapping step,
// target, progress with stop, finish).
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
vi.mock('@/spaces/switchSpace', async (orig) => ({
  ...(await orig()),
  switchSpace: vi.fn(async () => true),
}))
vi.mock('@/create/createAndOpen', async (orig) => ({
  ...(await orig()),
  openObject: vi.fn(() => 'current'),
}))

import { announceResync, api, ApiError } from '@/api/client'
import type { ImportJob, ImportMapping, ImportPlannedType, ImportPreview, ImportPreviewRequest, TypeDef } from '@/api/types'
import { openObject } from '@/create/createAndOpen'
import { resetSpaceInfo } from '@/settings/useSpaceInfo'
import { switchSpace } from '@/spaces/switchSpace'
import { IMPORT_TEXT, ImportDialog, importTiming } from './ImportDialog'
import { resetImportDialog, useImportDialog, type ImportDialogPreset } from './useImportDialog'

const T = IMPORT_TEXT
const mocked = vi.mocked(api)
const saved = { ...importTiming }

const BOOK_TYPE = { id: 't-book', name: 'Book', pluralName: 'Books' } as TypeDef
const PAGE_TYPE = { id: 'page', name: 'Page', pluralName: 'Pages', basic: true } as TypeDef

/**
 * The server's effective mapping, as `planner.py` answers it: every planned type's name, plural,
 * skip and (into this space) existing type, and every property's kind, multiple values, name and
 * skip, filled in.
 */
function served(req: ImportPreviewRequest, types: ImportPlannedType[]): ImportMapping {
  const here = req.target === 'currentSpace'
  return {
    typeSource: req.mapping?.typeSource ?? 'folder',
    typeKey: req.mapping?.typeKey ?? null,
    types: Object.fromEntries(
      types.map((t) => [
        t.key,
        { name: t.name, pluralName: t.pluralName, skip: t.skip, existingTypeId: here ? (t.existingTypeId ?? null) : null },
      ]),
    ),
    properties: Object.fromEntries(
      types.map((t) => [
        t.key,
        Object.fromEntries(t.properties.map((p) => [p.key, { kind: p.kind, isArray: p.isArray, name: p.name, skip: p.skip }])),
      ]),
    ),
  }
}

function vaultPreview(req: ImportPreviewRequest): ImportPreview {
  const p = rawVaultPreview(req)
  return { ...p, mapping: served(req, p.types) }
}

function rawVaultPreview(req: ImportPreviewRequest): ImportPreview {
  const here = req.target === 'currentSpace'
  return {
    previewId: 'preview-7',
    sourcePath: req.source.path,
    kind: 'obsidian',
    detected: 'obsidian',
    container: 'zip',
    suggestedName: 'Vault',
    counts: {
      objects: 12,
      types: 2,
      properties: 3,
      attachments: 4,
      attachmentBytes: 3 * 1024 * 1024,
      links: 20,
      resolvedLinks: 18,
      unresolvedLinks: 2,
      renamed: 1,
      skipped: 2,
    },
    types: [
      {
        key: 'folder:Books',
        name: 'Book',
        pluralName: 'Books',
        origin: 'folder',
        originLabel: 'Folder Books',
        objectCount: 7,
        existingTypeId: here ? 't-book' : null,
        skip: false,
        properties: [
          {
            key: 'title',
            sourceName: 'title',
            name: 'Title',
            kind: 'text',
            guessedKind: 'text',
            isArray: false,
            systemKey: 'title',
            valueCount: 7,
            unconvertible: 0,
            samples: [],
            options: [],
            skip: false,
          },
          {
            key: 'rating',
            sourceName: 'rating',
            name: 'rating',
            kind: 'number',
            guessedKind: 'number',
            isArray: false,
            systemKey: null,
            valueCount: 7,
            unconvertible: 0,
            samples: ['4', '5'],
            options: [],
            skip: false,
          },
          {
            key: 'genre',
            sourceName: 'genre',
            name: 'genre',
            kind: 'label',
            guessedKind: 'label',
            isArray: false,
            systemKey: null,
            valueCount: 6,
            unconvertible: 2,
            samples: ['Fiction', 'History'],
            options: ['Fiction', 'History'],
            skip: false,
          },
        ],
      },
      {
        key: 'page',
        name: 'Page',
        pluralName: 'Pages',
        origin: 'page',
        originLabel: 'Files at the top',
        objectCount: 5,
        existingTypeId: null,
        skip: false,
        properties: [],
      },
    ],
    mapping: req.mapping ?? { typeSource: 'folder', typeKey: null, types: {}, properties: {} },
    frontmatterKeys: [
      ['kind', 9],
      ['status', 3],
    ],
    folders: [['Books', 7]],
    samples: [],
    skipped: [
      { path: '.obsidian', reason: 'appSettings', detail: '' },
      { path: 'Canvas.canvas', reason: 'unsupported', detail: 'Canvas' },
    ],
    warnings: ['Nested frontmatter in 1 file is kept as written.'],
  }
}

function job(over: Partial<ImportJob>): ImportJob {
  return {
    id: 'import-job-1',
    phase: 'objects',
    done: 0,
    total: 0,
    targetPath: '/home/gene/Spaces/Vault',
    currentPath: null,
    result: null,
    error: null,
    ...over,
  }
}

const RESULT = {
  targetPath: '/home/gene/Spaces/Vault',
  spaceName: 'Vault',
  objects: 12,
  types: 2,
  attachments: 4,
  tags: 3,
  skipped: 2,
  reportPath: 'Pages/Import report.md',
  cancelled: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  resetImportDialog()
  resetSpaceInfo()
  importTiming.pollMs = 5
  importTiming.debounceMs = 5
  mocked.space.mockResolvedValue(SPACE)
})

afterEach(() => {
  Object.assign(importTiming, saved)
})

/** The scan step sits between the preview and the review: scan, then continue. */
async function passScan(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Scan' }))
  await user.click(await screen.findByRole('button', { name: 'Continue' }))
}

async function openDialog(preset: ImportDialogPreset = {}) {
  const user = userEvent.setup()
  render(<ImportDialog />)
  act(() => useImportDialog.getState().open(preset))
  await screen.findByRole('dialog', { name: T.title })
  return user
}

/** Open, type a path and preview the vault; resolves on the review step. */
async function previewVault(preset: ImportDialogPreset = {}) {
  mocked.importPreview.mockImplementation(async (req) => vaultPreview(req))
  const user = await openDialog(preset)
  await user.type(screen.getByRole('textbox', { name: T.source }), '/home/gene/Downloads/vault.zip{Enter}')
  await passScan(user)
  await screen.findByRole('heading', { name: T.summaryHeading })
  return user
}

const SPACE = {
  name: 'Work',
  root: '/home/gene/Spaces/Work',
  types: [BOOK_TYPE],
  icon: null,
  description: null,
  hideTaskManagement: false,
  revision: '',
}

/**
 * The vault with a top-level `Pages` folder. A new space has its own Page type, so there the folder
 * becomes "Page (2)"; into this space the server matches the Page type by name, unless the request
 * names the type otherwise or asks for a new one.
 */
function pagesPreview(req: ImportPreviewRequest): ImportPreview {
  const base = rawVaultPreview(req)
  const here = req.target === 'currentSpace'
  const o = req.mapping?.types['folder:Pages'] ?? {}
  const matched = here && o.existingTypeId !== '' && (o.name == null || o.name.toLowerCase() === 'page')
  const pages: ImportPlannedType = {
    key: 'folder:Pages',
    name: matched ? 'Page' : (o.name ?? 'Page (2)'),
    pluralName: matched ? 'Pages' : (o.pluralName ?? 'Pages (2)'),
    origin: 'folder',
    originLabel: 'Folder Pages',
    objectCount: 3,
    existingTypeId: here && o.existingTypeId ? o.existingTypeId : matched ? 'page' : null,
    skip: false,
    properties: [],
  }
  const types = [base.types[0], pages, ...base.types.slice(1)]
  return { ...base, types, mapping: served(req, types) }
}

async function previewWith(fn: (req: ImportPreviewRequest) => ImportPreview) {
  mocked.importPreview.mockImplementation(async (req) => fn(req))
  const user = await openDialog()
  await user.type(screen.getByRole('textbox', { name: T.source }), '/home/gene/Downloads/vault.zip{Enter}')
  await passScan(user)
  await screen.findByRole('heading', { name: T.summaryHeading })
  return user
}

function typeRow(label: string) {
  return screen.getByRole('group', { name: label })
}

describe('ImportDialog: source and preview', () => {
  test('test preview reads the path with the chosen source and writes nothing', async () => {
    const user = await openDialog({ kind: 'notion' })
    expect(screen.getByRole('combobox', { name: T.kind })).toHaveValue('notion')
    expect(screen.getByRole('textbox', { name: T.source })).toHaveFocus()
    const preview = screen.getByRole('button', { name: T.preview })
    expect(preview).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: T.source }), '/home/gene/Downloads/export.zip')
    await user.click(preview)
    await waitFor(() =>
      expect(mocked.importPreview).toHaveBeenCalledWith({ source: { path: '/home/gene/Downloads/export.zip', kind: 'notion' } }),
    )
    await passScan(user)
    expect(await screen.findByRole('status')).toHaveTextContent(T.summary(0, 0, 0))
    expect(mocked.startImport).not.toHaveBeenCalled()
  })

  test('test exported from lists detect automatically, the three apps and Files', async () => {
    await openDialog()
    const select = screen.getByRole('combobox', { name: T.kind })
    expect(select).toHaveValue('auto')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Detect automatically',
      'Notion',
      'Obsidian',
      'Anytype',
      T.kinds.files,
    ])
  })

  test('test a missing path and an unreadable file show our messages and stay on the source step', async () => {
    mocked.importPreview.mockRejectedValueOnce(new ApiError(404, 'not found'))
    const user = await openDialog()
    await user.type(screen.getByRole('textbox', { name: T.source }), '/nope{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(T.notFound)
    mocked.importPreview.mockRejectedValueOnce(new ApiError(415, 'bad'))
    await user.click(screen.getByRole('button', { name: T.preview }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(T.notZip))
    expect(screen.getByRole('textbox', { name: T.source })).toBeInTheDocument()
  })

  test('test summary shows counts, links, attachments, skipped items and warnings; focus moves to it', async () => {
    const user = await previewVault()
    const heading = screen.getByRole('heading', { name: T.summaryHeading })
    expect(heading).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent(T.summary(12, 2, 4))
    expect(screen.getByText(T.sourceLine('Obsidian', 'zip', true))).toBeInTheDocument()
    expect(screen.getByText(T.links(18, 20))).toBeInTheDocument()
    expect(screen.getByText(T.attachments(4, '3.0 MB'))).toBeInTheDocument()
    expect(screen.getByText(T.renamed(1))).toBeInTheDocument()
    expect(screen.getByText(T.skippedCount(2))).toBeInTheDocument()
    expect(screen.getByRole('region', { name: T.warningsHeading })).toHaveTextContent('Nested frontmatter')
    await user.click(screen.getByText(`${T.skippedHeading} (2)`))
    expect(screen.getByText('Canvas.canvas')).toBeInTheDocument()
    expect(screen.getByText(/Not supported · Canvas/)).toBeInTheDocument()
    // Objects per type.
    expect(within(typeRow('Folder Books')).getByText(T.objectCount(7))).toBeInTheDocument()
    expect(within(typeRow('Files at the top')).getByText(T.objectCount(5))).toBeInTheDocument()
  })

  test('test a path pasted with quotes around it (copy as path) is read without them', async () => {
    const user = await openDialog()
    await user.click(screen.getByRole('textbox', { name: T.source }))
    await user.paste('  "C:\\Users\\gene\\Downloads\\Export.zip" ')
    await user.click(screen.getByRole('button', { name: T.preview }))
    await waitFor(() =>
      expect(mocked.importPreview).toHaveBeenCalledWith({ source: { path: 'C:\\Users\\gene\\Downloads\\Export.zip', kind: 'auto' } }),
    )
  })

  test('test back returns to the source step with the path kept', async () => {
    const user = await previewVault()
    await user.click(screen.getByRole('button', { name: T.back }))
    const field = screen.getByRole('textbox', { name: T.source })
    expect(field).toHaveValue('/home/gene/Downloads/vault.zip')
    expect(field).toHaveFocus()
  })
})

describe('ImportDialog: mapping step', () => {
  test('test editing a type name re-previews with the mapping', async () => {
    const user = await previewVault()
    const row = typeRow('Folder Books')
    const name = within(row).getByRole('textbox', { name: T.typeName })
    expect(name).toHaveValue('Book')
    await user.clear(name)
    await user.type(name, 'Novel')
    await waitFor(() =>
      expect(mocked.importPreview).toHaveBeenLastCalledWith({
        source: { path: '/home/gene/Downloads/vault.zip', kind: 'auto' },
        mapping: { typeSource: 'folder', typeKey: null, types: { 'folder:Books': { name: 'Novel' } }, properties: {} },
        target: 'newSpace',
      }),
    )
    await waitFor(() => expect(screen.getByRole('button', { name: T.import })).toBeEnabled())
    // Skipping a type.
    await user.click(within(typeRow('Files at the top')).getByRole('checkbox', { name: T.skip }))
    await waitFor(() =>
      expect(mocked.importPreview.mock.lastCall?.[0].mapping?.types).toEqual({
        'folder:Books': { name: 'Novel' },
        page: { skip: true },
      }),
    )
  })

  test('test import waits while the preview updates', async () => {
    const user = await previewVault()
    let answer!: () => void
    mocked.importPreview.mockImplementation(
      (req) =>
        new Promise((r) => {
          answer = () => r(vaultPreview(req))
        }),
    )
    await user.click(within(typeRow('Files at the top')).getByRole('checkbox', { name: T.skip }))
    expect(screen.getByRole('status')).toHaveTextContent(T.updating)
    expect(screen.getByRole('button', { name: T.import })).toBeDisabled()
    await waitFor(() => expect(answer).toBeDefined())
    act(() => answer())
    await waitFor(() => expect(screen.getByRole('button', { name: T.import })).toBeEnabled())
    expect(screen.getByRole('status')).not.toHaveTextContent(T.updating)
  })

  test('test property kinds: guessed marked, overridable, multiple values for labels, unconvertible shown', async () => {
    const user = await previewVault()
    const row = typeRow('Folder Books')
    const toggle = within(row).getByRole('button', { name: T.showProperties(3) })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(row).getByText(T.fills('Title'))).toBeInTheDocument()

    const rating = within(row).getByRole('group', { name: 'rating' })
    const kind = within(rating).getByRole('combobox', { name: T.propertyKind })
    expect(kind).toHaveValue('number')
    expect(within(kind).getByRole('option', { name: T.guessed('Number') })).toBeInTheDocument()
    expect(within(rating).getByText(`${T.samples} 4, 5`)).toBeInTheDocument()
    expect(within(rating).queryByRole('checkbox', { name: T.multiple })).toBeNull()
    await user.selectOptions(kind, 'label')
    expect(within(rating).getByRole('checkbox', { name: T.multiple })).not.toBeChecked()
    await user.click(within(rating).getByRole('checkbox', { name: T.multiple }))

    const genre = within(row).getByRole('group', { name: 'genre' })
    expect(within(genre).getByText(T.unconvertible(2))).toBeInTheDocument()
    await user.click(within(genre).getByRole('checkbox', { name: T.skip }))
    expect(within(genre).queryByText(T.unconvertible(2))).toBeNull()

    await waitFor(() =>
      expect(mocked.importPreview.mock.lastCall?.[0].mapping?.properties).toEqual({
        'folder:Books': { rating: { kind: 'label', isArray: true }, genre: { skip: true } },
      }),
    )
  })

  test('test make types from a frontmatter key picks a key and drops the old overrides', async () => {
    const user = await previewVault()
    const group = screen.getByRole('group', { name: T.typesFrom })
    expect(within(group).getByRole('radio', { name: T.typesFromFolder })).toBeChecked()
    await user.clear(within(typeRow('Folder Books')).getByRole('textbox', { name: T.typeName }))
    await user.click(within(group).getByRole('radio', { name: T.typesFromKey }))
    const key = within(group).getByRole('combobox', { name: T.typeKey })
    expect(key).toHaveValue('kind')
    await waitFor(() =>
      expect(mocked.importPreview.mock.lastCall?.[0].mapping).toEqual({
        typeSource: 'key',
        typeKey: 'kind',
        types: {},
        properties: {},
      }),
    )
    await user.selectOptions(key, 'status')
    await waitFor(() => expect(mocked.importPreview.mock.lastCall?.[0].mapping?.typeKey).toBe('status'))
    await user.click(within(group).getByRole('radio', { name: T.typesFromNone }))
    await waitFor(() =>
      expect(mocked.importPreview.mock.lastCall?.[0].mapping).toMatchObject({ typeSource: 'none', typeKey: null }),
    )
  })

  test('test types and properties are lists of labelled groups', async () => {
    const user = await previewVault()
    const list = screen.getByRole('list', { name: T.types })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    const books = typeRow('Folder Books')
    expect(books.tagName).not.toBe('LI')
    expect(items[0]).toContainElement(books)
    await user.click(within(books).getByRole('button', { name: T.showProperties(3) }))
    const props = within(books).getByRole('list', { name: T.showProperties(3) })
    expect(within(props).getAllByRole('listitem')).toHaveLength(3)
    const rating = within(props).getByRole('group', { name: 'rating' })
    expect(rating.tagName).not.toBe('LI')
    expect(rating.parentElement?.tagName).toBe('LI')
  })

  test('test notion has no make types from choice', async () => {
    mocked.importPreview.mockImplementation(async (req) => ({ ...vaultPreview(req), kind: 'notion', detected: 'notion' }))
    const user = await openDialog()
    await user.type(screen.getByRole('textbox', { name: T.source }), '/x.zip{Enter}')
    await passScan(user)
    await screen.findByRole('heading', { name: T.summaryHeading })
    expect(screen.queryByRole('group', { name: T.typesFrom })).toBeNull()
  })

  test('test enter in a name field does not start the import; the keyboard reaches import', async () => {
    const user = await previewVault()
    const name = within(screen.getByRole('group', { name: T.target })).getByRole('textbox', { name: T.name })
    await user.click(name)
    await user.keyboard('{Enter}')
    expect(mocked.startImport).not.toHaveBeenCalled()
    screen.getByRole('button', { name: T.import }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(mocked.startImport).toHaveBeenCalledTimes(1))
  })

  test('test a refused re-preview shows the error and keeps import disabled', async () => {
    const user = await previewVault()
    mocked.importPreview.mockRejectedValueOnce(new ApiError(422, 'Unknown property key'))
    await user.type(within(typeRow('Folder Books')).getByRole('textbox', { name: T.pluralName }), 'x')
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown property key')
    expect(screen.getByRole('button', { name: T.import })).toBeDisabled()
  })
})

describe('ImportDialog: target, progress and finish', () => {
  test('test new space by default with the suggested name and the parent folder; progress; switch space', async () => {
    let release!: () => void
    mocked.importJob
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            release = () => r(job({ phase: 'attachments', done: 1, total: 17, currentPath: 'Books/cover.png' }))
          }),
      )
      .mockResolvedValueOnce(job({ phase: 'objects', done: 9, total: 17, currentPath: 'Books/Dune.md' }))
      .mockResolvedValue(job({ phase: 'done', done: 17, total: 17, result: RESULT }))
    const user = await previewVault()
    const target = screen.getByRole('group', { name: T.target })
    expect(within(target).getByRole('radio', { name: T.newSpace })).toBeChecked()
    expect(within(target).getByRole('radio', { name: T.thisSpaceNamed('Work') })).not.toBeChecked()
    expect(within(target).getByRole('textbox', { name: T.name })).toHaveValue('Vault')
    await waitFor(() => expect(within(target).getByRole('textbox', { name: T.location })).toHaveValue('/home/gene/Spaces'))

    await user.click(screen.getByRole('button', { name: T.import }))
    await waitFor(() =>
      expect(mocked.startImport).toHaveBeenCalledWith({
        previewId: 'preview-7',
        mapping: { typeSource: 'folder', typeKey: null, types: {}, properties: {} },
        target: { kind: 'newSpace', name: 'Vault', location: '/home/gene/Spaces' },
      }),
    )
    expect(await screen.findByRole('heading', { name: T.importing })).toHaveFocus()
    // While a job runs the dialog can't be closed (no close button, Escape ignored).
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: T.title })).toBeInTheDocument()
    expect(useImportDialog.getState().isOpen).toBe(true)
    act(() => release())
    await waitFor(() => {
      expect(screen.getByText(T.importingCount(1, 17))).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent(T.progressStatus(T.phases.attachments, 1, 17))
    })
    expect(screen.getByRole('progressbar', { name: T.progress })).toHaveAttribute('aria-valuemax', '17')

    expect(await screen.findByRole('heading', { name: T.finished })).toHaveFocus()
    expect(screen.getByText(T.result(RESULT))).toBeInTheDocument()
    expect(screen.getByText(T.resultSkipped(2))).toBeInTheDocument()
    expect(mocked.importJob.mock.calls.length).toBeGreaterThanOrEqual(3)
    // Another space: this window has nothing to reload.
    expect(announceResync).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: T.switchNow }))
    expect(switchSpace).toHaveBeenCalledWith('/home/gene/Spaces/Vault')
    expect(useImportDialog.getState().isOpen).toBe(false)
  })

  test('test name and location carried over from create new space', async () => {
    await previewVault({ name: 'Archive', location: '/data' })
    const target = screen.getByRole('group', { name: T.target })
    expect(within(target).getByRole('textbox', { name: T.name })).toHaveValue('Archive')
    expect(within(target).getByRole('textbox', { name: T.location })).toHaveValue('/data')
  })

  test('test import needs a name for a new space', async () => {
    const user = await previewVault()
    await user.clear(within(screen.getByRole('group', { name: T.target })).getByRole('textbox', { name: T.name }))
    expect(screen.getByRole('button', { name: T.import })).toBeDisabled()
  })

  test('test this space only when picked; existing type choice; open import report', async () => {
    mocked.importJob.mockResolvedValue(
      job({ phase: 'done', done: 17, total: 17, targetPath: '/home/gene/Spaces/Work', result: RESULT }),
    )
    const user = await previewVault()
    expect(within(typeRow('Folder Books')).queryByRole('combobox', { name: T.existingType })).toBeNull()
    await user.click(screen.getByRole('radio', { name: T.thisSpaceNamed('Work') }))
    await user.click(await screen.findByRole('checkbox', { name: T.tryCopy })) // M25: a first run starts on a copy
    expect(screen.getByText(T.thisSpaceNote)).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: T.target })).queryByRole('textbox')).toBeNull()
    await waitFor(() => expect(mocked.importPreview.mock.lastCall?.[0].target).toBe('currentSpace'))
    const into = await within(typeRow('Folder Books')).findByRole('combobox', { name: T.existingType })
    await waitFor(() => expect(into).toHaveValue('t-book'))
    expect(within(typeRow('Folder Books')).getByRole('textbox', { name: T.typeName })).toBeDisabled()
    await user.selectOptions(into, T.newType)
    await waitFor(() =>
      expect(mocked.importPreview.mock.lastCall?.[0].mapping?.types).toEqual({ 'folder:Books': { existingTypeId: '' } }),
    )
    await waitFor(() => expect(screen.getByRole('button', { name: T.import })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: T.import }))
    await waitFor(() =>
      expect(mocked.startImport).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { kind: 'currentSpace' },
          mapping: expect.objectContaining({ types: { 'folder:Books': { existingTypeId: '' } } }),
        }),
      ),
    )
    await screen.findByRole('heading', { name: T.finishedHere })
    // This window reloads its objects and types once (finding 2).
    expect(announceResync).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: T.switchNow })).toBeNull()
    await user.click(screen.getByRole('button', { name: T.openReport }))
    expect(openObject).toHaveBeenCalledWith('Pages/Import report.md')
    expect(useImportDialog.getState().isOpen).toBe(false)
    expect(switchSpace).not.toHaveBeenCalled()
  })

  test('test switching to this space shows the server matches, not the new space guesses (finding 4)', async () => {
    mocked.space.mockResolvedValue({ ...SPACE, types: [BOOK_TYPE, PAGE_TYPE] })
    const user = await previewWith(pagesPreview)
    expect(within(typeRow('Folder Pages')).getByRole('textbox', { name: T.typeName })).toHaveValue('Page (2)')
    await user.click(screen.getByRole('radio', { name: T.thisSpaceNamed('Work') }))
    await waitFor(() => expect(mocked.importPreview.mock.lastCall?.[0].target).toBe('currentSpace'))
    // Nothing the user didn't choose is sent: the server matches the folder to the Page type.
    expect(mocked.importPreview.mock.lastCall?.[0].mapping).toEqual({
      typeSource: 'folder',
      typeKey: null,
      types: {},
      properties: {},
    })
    const into = await within(typeRow('Folder Pages')).findByRole('combobox', { name: T.existingType })
    await waitFor(() => expect(into).toHaveValue('page'))
    expect(within(typeRow('Folder Pages')).getByRole('textbox', { name: T.typeName })).toHaveValue('Page')
    expect(within(typeRow('Folder Books')).getByRole('combobox', { name: T.existingType })).toHaveValue('t-book')

    // A new kind sends the kind alone, not the old "Multiple values".
    const books = typeRow('Folder Books')
    await user.click(within(books).getByRole('button', { name: T.showProperties(3) }))
    const rating = within(books).getByRole('group', { name: 'rating' })
    await user.selectOptions(within(rating).getByRole('combobox', { name: T.propertyKind }), 'label')
    await waitFor(() =>
      expect(mocked.importPreview.mock.lastCall?.[0].mapping?.properties).toEqual({ 'folder:Books': { rating: { kind: 'label' } } }),
    )
    await user.click(screen.getByRole('checkbox', { name: T.tryCopy })) // M25: not the scratch copy
    await waitFor(() => expect(screen.getByRole('button', { name: T.import })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: T.import }))
    await waitFor(() =>
      expect(mocked.startImport).toHaveBeenCalledWith({
        previewId: 'preview-7',
        mapping: { typeSource: 'folder', typeKey: null, types: {}, properties: { 'folder:Books': { rating: { kind: 'label' } } } },
        target: { kind: 'currentSpace' },
      }),
    )
  })

  test('test add to lists only types that take imported notes (finding 5)', async () => {
    const basic = (id: string, name: string) => ({ id, name, pluralName: `${name}s`, basic: true, readOnlyReason: null }) as TypeDef
    mocked.space.mockResolvedValue({
      ...SPACE,
      types: [
        PAGE_TYPE,
        basic('task', 'Task'),
        basic('tag', 'Tag'),
        basic('dailynote', 'DailyNote'),
        basic('whiteboard', 'Whiteboard'),
        basic('image', 'Image'),
        basic('file', 'File'),
        basic('audio', 'Audio'),
        BOOK_TYPE,
        { id: 'broken', name: 'Broken', pluralName: 'Brokens', basic: false, readOnlyReason: 'Not valid JSON.' } as TypeDef,
      ],
    })
    const user = await previewVault()
    await user.click(screen.getByRole('radio', { name: T.thisSpaceNamed('Work') }))
    const into = await within(typeRow('Folder Books')).findByRole('combobox', { name: T.existingType })
    expect(within(into).getAllByRole('option').map((o) => o.textContent)).toEqual([T.newType, 'Page', 'Task', 'Book'])
  })

  test('test going back to a new space drops the existing type choices', async () => {
    const user = await previewVault()
    await user.click(screen.getByRole('radio', { name: T.thisSpaceNamed('Work') }))
    const into = await within(typeRow('Folder Books')).findByRole('combobox', { name: T.existingType })
    await user.selectOptions(into, T.newType)
    await user.click(screen.getByRole('radio', { name: T.newSpace }))
    await waitFor(() => expect(mocked.importPreview.mock.lastCall?.[0]).toMatchObject({ target: 'newSpace' }))
    expect(mocked.importPreview.mock.lastCall?.[0].mapping?.types).toEqual({})
  })

  test('test the scan step runs before the review and its choices go to the import (M27)', async () => {
    const { scanSource } = await import('./scan/scanApi')
    vi.mocked(scanSource).mockResolvedValueOnce({
      findings: { 'a.md': [{ kind: 'api-key', line: 3 }], 'b.md': [{ kind: 'password', line: 1 }] },
      leftOut: [],
      counts: { scanned: 2, unscanned: 0, flagged: 2, findings: 2, leftOut: 0 },
      defaultChoice: 'excludeFromAi',
    })
    mocked.importPreview.mockImplementation(async (req) => vaultPreview(req))
    const user = await openDialog()
    await user.type(screen.getByRole('textbox', { name: T.source }), '/home/gene/Downloads/vault.zip{Enter}')
    expect(await screen.findByRole('heading', { name: 'Check for sensitive content' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: T.summaryHeading })).toBeNull()
    await user.type(screen.getByRole('textbox'), 'Credentials')
    await user.click(screen.getByRole('button', { name: 'Scan' }))
    await user.selectOptions(await screen.findByRole('combobox', { name: /b\.md/ }), 'leaveOut')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: T.summaryHeading })
    await user.click(screen.getByRole('button', { name: T.import }))
    await waitFor(() =>
      expect(mocked.startImport).toHaveBeenCalledWith(
        expect.objectContaining({ scan: { leaveOut: ['Credentials'], leaveOutFiles: ['b.md'], excludeFromAi: ['a.md'] } }),
      ),
    )
  })

  test('test an import into this space with a batch offers the agent workflow (M27)', async () => {
    mocked.importJob.mockResolvedValue(job({ phase: 'done', result: { ...RESULT, batch: 'batch-1' } }))
    mocked.importProposal.mockResolvedValue({ proposal: null, review: null })
    const user = await previewVault()
    await user.click(screen.getByRole('radio', { name: T.thisSpaceNamed('Work') }))
    await user.click(screen.getByRole('checkbox', { name: T.tryCopy }))
    await waitFor(() => expect(screen.getByRole('button', { name: T.import })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: T.import }))
    await user.click(await screen.findByRole('button', { name: 'Review proposed schema' }))
    expect(await screen.findByRole('heading', { name: 'Proposed schema' })).toBeInTheDocument()
    expect(mocked.importProposal).toHaveBeenCalledWith('batch-1')
  })

  test('test stop import cancels the job and the finish says it stopped', async () => {
    let cancelled = false
    mocked.importJob.mockImplementation(async () =>
      cancelled
        ? job({ phase: 'cancelled', done: 5, total: 17, result: { ...RESULT, objects: 4, cancelled: true } })
        : job({ phase: 'objects', done: 5, total: 17, currentPath: 'Books/Dune.md' }),
    )
    mocked.cancelImport.mockImplementation(async () => {
      cancelled = true
      return { ok: true }
    })
    const user = await previewVault()
    await user.click(screen.getByRole('button', { name: T.import }))
    await screen.findByText(/Books\/Dune\.md/)
    await user.click(screen.getByRole('button', { name: T.stop }))
    expect(mocked.cancelImport).toHaveBeenCalledWith('import-job-1')
    expect(await screen.findByRole('heading', { name: T.stopped })).toBeInTheDocument()
    // What was written stays: the new space is still offered.
    expect(screen.getByRole('button', { name: T.switchNow })).toBeInTheDocument()
  })

  test('test a failed job shows its error', async () => {
    mocked.importJob.mockResolvedValue(job({ phase: 'failed', error: 'Disk full', result: { ...RESULT, objects: 2 } }))
    const user = await previewVault()
    await user.click(screen.getByRole('button', { name: T.import }))
    expect(await screen.findByRole('heading', { name: T.failed })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Disk full')
  })

  test('test a failed import into a new space that was never made offers no Switch space', async () => {
    mocked.importJob.mockResolvedValue(
      job({ phase: 'failed', error: 'The location is not writable.', targetPath: '/home/gene/Spaces/Vault', result: null }),
    )
    const user = await previewVault()
    await user.click(screen.getByRole('button', { name: T.import }))
    expect(await screen.findByRole('heading', { name: T.failed })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('The location is not writable.')
    expect(screen.queryByRole('button', { name: T.switchNow })).toBeNull()
    expect(screen.queryByRole('button', { name: T.later })).toBeNull()
    expect(screen.queryByText('/home/gene/Spaces/Vault')).toBeNull()
    await user.click(screen.getAllByRole('button', { name: T.close })[0])
    expect(useImportDialog.getState().isOpen).toBe(false)
  })

  test('test a job the server forgot ends the wait', async () => {
    mocked.importJob.mockRejectedValue(new ApiError(404, 'unknown job'))
    const user = await previewVault()
    await user.click(screen.getByRole('button', { name: T.import }))
    expect(await screen.findByRole('heading', { name: T.jobLost })).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: T.close })[0])
    expect(useImportDialog.getState().isOpen).toBe(false)
  })

  test('test a refused start shows the server message and stays on review', async () => {
    mocked.startImport.mockRejectedValueOnce(new ApiError(409, 'A folder with that name already exists here.'))
    const user = await previewVault()
    await user.click(screen.getByRole('button', { name: T.import }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A folder with that name already exists here.')
    expect(screen.getByRole('button', { name: T.import })).toBeEnabled()
    expect(mocked.importJob).not.toHaveBeenCalled()
  })

  test('test a stopped or failed import into this space also reloads this window (finding 2)', async () => {
    mocked.importJob.mockResolvedValue(job({ phase: 'failed', error: 'Disk full', result: { ...RESULT, objects: 2 } }))
    const user = await previewVault()
    await user.click(screen.getByRole('radio', { name: T.thisSpaceNamed('Work') }))
    await user.click(await screen.findByRole('checkbox', { name: T.tryCopy }))
    await waitFor(() => expect(screen.getByRole('button', { name: T.import })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: T.import }))
    await screen.findByRole('heading', { name: T.failed })
    expect(announceResync).toHaveBeenCalledTimes(1)
  })

  test('test an expired preview is read again and the import waits for the user (finding 15)', async () => {
    const user = await previewVault()
    await user.type(within(typeRow('Folder Books')).getByRole('textbox', { name: T.typeName }), 's')
    await waitFor(() => expect(screen.getByRole('button', { name: T.import })).toBeEnabled())
    const before = mocked.importPreview.mock.calls.length
    const lastRequest = mocked.importPreview.mock.lastCall?.[0]
    mocked.startImport.mockRejectedValueOnce(new ApiError(404, 'This preview has expired. Preview the source again.'))
    mocked.importPreview.mockImplementation(async (req) => ({ ...vaultPreview(req), previewId: 'preview-8' }))
    await user.click(screen.getByRole('button', { name: T.import }))
    expect(await screen.findByText(T.previewExpired)).toBeInTheDocument()
    await waitFor(() => expect(mocked.importPreview.mock.calls.length).toBe(before + 1))
    // The same request as the last preview.
    expect(mocked.importPreview.mock.lastCall?.[0]).toEqual(lastRequest)
    await waitFor(() => expect(screen.getByRole('button', { name: T.import })).toBeEnabled())
    // Nothing started on its own.
    expect(mocked.startImport).toHaveBeenCalledTimes(1)
    expect(mocked.importJob).not.toHaveBeenCalled()
    expect(screen.getByText(T.previewExpired)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: T.import }))
    await waitFor(() => expect(mocked.startImport).toHaveBeenLastCalledWith(expect.objectContaining({ previewId: 'preview-8' })))
    expect(mocked.startImport).toHaveBeenCalledTimes(2)
  })

  test('test a second refusal right after reading again shows the server message', async () => {
    const user = await previewVault()
    const before = mocked.importPreview.mock.calls.length
    mocked.startImport
      .mockRejectedValueOnce(new ApiError(404, 'This preview has expired. Preview the source again.'))
      .mockRejectedValueOnce(new ApiError(404, 'Not a folder: /nope'))
    await user.click(screen.getByRole('button', { name: T.import }))
    await screen.findByText(T.previewExpired)
    await waitFor(() => expect(screen.getByRole('button', { name: T.import })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: T.import }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not a folder: /nope')
    expect(screen.queryByText(T.previewExpired)).toBeNull()
    expect(mocked.importPreview.mock.calls.length).toBe(before + 1)
    expect(screen.getByRole('button', { name: T.import })).toBeEnabled()
  })

  test('test the progress announcement changes only with the phase or every tenth (review O3)', async () => {
    let now = job({ phase: 'objects', done: 1, total: 100 })
    mocked.importJob.mockImplementation(async () => now)
    const user = await previewVault()
    await user.click(screen.getByRole('button', { name: T.import }))
    await screen.findByText(T.importingCount(1, 100))
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(T.progressStatus(T.phases.objects, 1, 100))
    now = job({ phase: 'objects', done: 7, total: 100 })
    await screen.findByText(T.importingCount(7, 100))
    expect(status).toHaveTextContent(T.progressStatus(T.phases.objects, 1, 100))
    now = job({ phase: 'objects', done: 12, total: 100 })
    await screen.findByText(T.importingCount(12, 100))
    expect(status).toHaveTextContent(T.progressStatus(T.phases.objects, 12, 100))
    now = job({ phase: 'objects', done: 19, total: 100 })
    await screen.findByText(T.importingCount(19, 100))
    expect(status).toHaveTextContent(T.progressStatus(T.phases.objects, 12, 100))
    now = job({ phase: 'report', done: 19, total: 100 })
    await waitFor(() => expect(status).toHaveTextContent(T.progressStatus(T.phases.report, 19, 100)))
    now = job({ phase: 'done', done: 100, total: 100, result: RESULT })
    await screen.findByRole('heading', { name: T.finished })
  })
})

describe('ImportDialog: M25 originals, scratch copy and batches', () => {
  test('test a first run into this space starts on a copy of it, and starts a spaceCopy target', async () => {
    const user = await previewVault()
    await user.click(screen.getByRole('radio', { name: T.thisSpaceNamed('Work') }))
    const box = await screen.findByRole('checkbox', { name: T.tryCopy })
    await waitFor(() => expect(box).toBeChecked())
    expect(screen.getByRole('textbox', { name: T.copyName })).toHaveValue(T.copyDefaultName('Work'))
    await waitFor(() => expect(screen.getByRole('button', { name: T.import })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: T.import }))
    await waitFor(() => expect(mocked.startImport).toHaveBeenCalled())
    expect(mocked.startImport.mock.lastCall?.[0].target).toEqual({
      kind: 'spaceCopy',
      name: 'Work (trial)',
      location: '/home/gene/Spaces',
    })
  })

  test('test a source imported before is not copied by default; Keep originals shows only for Files', async () => {
    mocked.importBatches.mockResolvedValue([
      { id: 'b1', startedAt: '', source: { path: '/home/gene/Downloads/vault.zip', kind: 'obsidian', system: 'obsidian' }, counts: {} },
    ])
    const user = await previewVault()
    await user.click(screen.getByRole('radio', { name: T.thisSpaceNamed('Work') }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: T.tryCopy })).not.toBeChecked())
    expect(screen.queryByRole('combobox', { name: T.keepOriginals })).toBeNull()
  })

  test('test Keep originals as is sent for a Files source', async () => {
    mocked.importPreview.mockImplementation(async (req) => ({ ...vaultPreview(req), kind: 'files' as const }))
    const user = await openDialog()
    await user.type(screen.getByRole('textbox', { name: T.source }), '/home/gene/Library{Enter}')
    await passScan(user)
    await screen.findByRole('heading', { name: T.summaryHeading })
    const keep = screen.getByRole('combobox', { name: new RegExp(T.keepOriginals) })
    expect(keep).toHaveValue('attachments')
    await user.selectOptions(keep, 'fileObjects')
    await waitFor(() => expect(screen.getByRole('button', { name: T.import })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: T.import }))
    await waitFor(() => expect(mocked.startImport).toHaveBeenCalled())
    expect(mocked.startImport.mock.lastCall?.[0]).toMatchObject({ keepOriginals: 'fileObjects' })
  })
})
