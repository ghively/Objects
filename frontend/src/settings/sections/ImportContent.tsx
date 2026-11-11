// "Import Content" (the catalog's General section): "Start importing" opens the M15 import dialog
// (`import/ImportDialog.tsx`), which detects the source; one row per source Object reads (Notion,
// Obsidian, Anytype) opens it preset to that source. No migration guides from the web: Object
// makes no network requests, so each row says in a line how to make the export (our strings).
//
// 2026-11-09: "OCR languages" (the `ocrLanguages` device setting) names the Tesseract languages a
// scanned PDF is read in; empty means every installed one. The field saves on blur (and on Enter).
//
// M31 (IT ops design section 6): "Remodel this space…" opens the import dialog with the open space's
// folder as the source and a new space as the only target; the space itself is only read.
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import type { ImportBatch, ImportResult, ImportSourceKind } from '@/api/types'
import { AGENT_TEXT } from '@/import/agent/text'
import { BatchPanel } from '@/import/BatchPanel'
import { useImportDialog } from '@/import/useImportDialog'
import { useSettings } from '@/settings/useSettings'
import { NOTE_LOWER, NOTES_LOWER } from '@/lib/words'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { useSettingsModal } from '../useSettingsModal'
import { SaveError, SectionHeader, SettingGroup, errorText } from '../controls'

export const IMPORT_CONTENT_TEXT = {
  heading: 'Import Content',
  // our string
  description: 'Bring notes from another app into a new space. Object shows what it will import before it writes anything.',
  startImporting: 'Start importing',
  // our string
  startImportingDescription: 'Choose a .zip export or a folder; Object detects where it came from.',
  sources: 'Sources', // our string
  notion: 'Notion',
  obsidian: 'Obsidian',
  anytype: 'Anytype',
  importFrom: (app: string) => `Import from ${app}`, // our string
  // our strings: how to make each export
  notionHelp: 'In Notion, open Settings, choose Export all workspace content and pick Markdown & CSV with subpages. Then choose the .zip it saves.',
  obsidianHelp: "A vault needs no export: choose the vault's folder. It is only read, never changed.",
  anytypeHelp: 'In Anytype, export the space (or the parts of it you want) as Markdown with files included. Then choose the .zip or folder it saves.',
  // our strings: earlier imports into this space, and the way back to their review
  history: 'Import history',
  historyHelp: 'Imports into this space, newest first. Review reopens the proposed schema, the trial and the Import inbox.',
  historyEmpty: 'Nothing has been imported into this space yet.',
  historyObjects: (n: number) => `${n} ${n === 1 ? NOTE_LOWER : NOTES_LOWER}`,
  review: AGENT_TEXT.continueButton,
  reviewLabel: (source: string) => `${AGENT_TEXT.continueButton}: ${source}`,
  // our strings: the OCR languages setting
  ocrLanguages: 'OCR languages',
  ocrLanguagesHelp: 'Tesseract language codes joined with +, for example eng+deu. Leave empty to use every installed language.',
  ocrLanguagesPlaceholder: 'Every installed language',
  // our strings: remodelling the open space (M31)
  remodel: 'Remodel this space…',
  remodelHeading: 'Remodel this space',
  remodelHelp:
    "Import this space's notes into a new space, to sort them again with the import's rules and AI filing. This space is only read, never changed.",
  remodelName: (space: string) => `${space} (remodelled)`,
} as const

const T = IMPORT_CONTENT_TEXT

export const IMPORT_CONTENT_SEARCH: string[] = [T.startImporting, T.notion, T.obsidian, T.anytype, T.ocrLanguages, T.remodel]

const SOURCES: { kind: ImportSourceKind; label: string; help: string }[] = [
  { kind: 'notion', label: T.notion, help: T.notionHelp },
  { kind: 'obsidian', label: T.obsidian, help: T.obsidianHelp },
  { kind: 'anytype', label: T.anytype, help: T.anytypeHelp },
]

function openImport(kind: ImportSourceKind | 'auto') {
  useSettingsModal.getState().close()
  useImportDialog.getState().open({ kind })
}

function remodelSpace(name: string, root: string) {
  useSettingsModal.getState().close()
  useImportDialog.getState().open({ sourcePath: root, newSpaceOnly: true, name: T.remodelName(name) })
}

function reviewImport(batch: string) {
  useSettingsModal.getState().close()
  useImportDialog.getState().open({ reviewBatch: batch })
}

/** The last segment of a source path (a vault folder or a .zip). */
function sourceName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** A batch record (`batch.json`) as the result BatchPanel reads. */
function batchAsResult(b: ImportBatch): ImportResult {
  const n = (k: string) => b.counts[k] ?? 0
  return {
    targetPath: '',
    spaceName: '',
    objects: n('imported'),
    types: 0,
    attachments: 0,
    tags: 0,
    skipped: 0,
    reportPath: b.reportPath ?? null,
    cancelled: false,
    batch: b.id,
    updated: n('updated'),
    unchanged: n('unchanged'),
    // What is still waiting, once some were resolved; the count at the import otherwise.
    changedInBoth: b.counts.pending ?? n('changedInBoth'),
    removed: n('removed'),
    leftOut: n('leftOut'),
    failed: n('failed'),
    notWritten: n('notWritten'),
    sourceItems: n('sourceItems'),
  }
}

function ImportHistory() {
  const [batches, setBatches] = useState<ImportBatch[] | null>(null)
  /** Batches moved to the Trash from here: nothing left to review. */
  const [trashed, setTrashed] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    let alive = true
    api
      .importBatches()
      .then((all) => alive && setBatches(all.filter((b) => !b.trashedAt)))
      .catch(() => alive && setBatches([]))
    return () => {
      alive = false
    }
  }, [])
  if (batches === null) return null
  return (
    <SettingGroup title={T.history} help={T.historyHelp}>
      {batches.length === 0 ? (
        <p className="text-[13px] text-fg-muted">{T.historyEmpty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {batches.map((b) => {
            const name = sourceName(b.source.path)
            const when = (b.finishedAt || b.startedAt || '').slice(0, 16).replace('T', ' ')
            return (
              <li key={b.id} data-import-batch={b.id} className="flex flex-col gap-2 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-fg" title={b.source.path}>
                      {name}
                    </p>
                    <p className="text-[13px] text-fg-muted">
                      {[when, T.historyObjects(b.counts.imported ?? 0)].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {!trashed.has(b.id) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      aria-label={T.reviewLabel(name)}
                      onClick={() => reviewImport(b.id)}
                    >
                      {T.review}
                    </Button>
                  )}
                </div>
                {/* The finish step's batch actions (Move batch to Trash, Changed in both), here too. */}
                <BatchPanel
                  result={batchAsResult(b)}
                  inOpenSpace
                  actionsOnly
                  onMoved={() => setTrashed((s) => new Set(s).add(b.id))}
                />
              </li>
            )
          })}
        </ul>
      )}
    </SettingGroup>
  )
}

/** "OCR languages": the `ocrLanguages` device setting, saved on blur and on Enter. */
function OcrLanguages() {
  const value = useSettings((s) => s.settings.ocrLanguages)
  const [text, setText] = useState(value)
  const [shown, setShown] = useState(value)
  const [error, setError] = useState<string | null>(null)
  if (shown !== value) {
    setShown(value)
    setText(value)
  }
  const commit = () => {
    const next = text.trim()
    if (next === value) return
    setError(null)
    useSettings
      .getState()
      .patch({ ocrLanguages: next })
      .catch((e: unknown) => setError(errorText(e)))
  }
  return (
    <SettingGroup title={T.ocrLanguages} help={T.ocrLanguagesHelp}>
      <input
        aria-label={T.ocrLanguages}
        placeholder={T.ocrLanguagesPlaceholder}
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        className="h-8 w-full max-w-[420px] rounded-md border border-line bg-transparent px-2 text-[14px] text-fg outline-none focus:border-fg-muted"
      />
      <SaveError error={error} />
    </SettingGroup>
  )
}

/** M31: "Remodel this space…" (shown once the open space is known). */
function Remodel() {
  const space = useSpaceInfo((s) => s.space)
  if (!space?.root) return null
  return (
    <SettingGroup title={T.remodelHeading} help={T.remodelHelp}>
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => remodelSpace(space.name, space.root)}>
          {T.remodel}
        </Button>
      </div>
    </SettingGroup>
  )
}

export function ImportContentSection() {
  return (
    <div>
      <SectionHeader icon="ph-download-simple" heading={T.heading} description={T.description} />
      <SettingGroup title={T.startImporting} help={T.startImportingDescription}>
        <div>
          <Button type="button" size="sm" onClick={() => openImport('auto')}>
            <Icon name="ph-download-simple" size={14} />
            {T.startImporting}
          </Button>
        </div>
      </SettingGroup>
      <SettingGroup title={T.sources}>
        <ul className="flex flex-col divide-y divide-line">
          {SOURCES.map((s) => (
            <li key={s.kind} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-fg">{s.label}</p>
                <p id={`import-help-${s.kind}`} className="text-[13px] text-fg-muted">
                  {s.help}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                aria-describedby={`import-help-${s.kind}`}
                onClick={() => openImport(s.kind)}
              >
                {T.importFrom(s.label)}
              </Button>
            </li>
          ))}
        </ul>
      </SettingGroup>
      <Remodel />
      <OcrLanguages />
      <ImportHistory />
    </div>
  )
}
