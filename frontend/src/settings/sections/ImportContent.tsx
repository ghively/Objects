// "Import Content" (the catalog's General section): "Start importing" opens the M15 import dialog
// (`import/ImportDialog.tsx`), which detects the source; one row per source Object reads (Notion,
// Obsidian, Anytype) opens it preset to that source. No migration guides from the web: Object
// makes no network requests, so each row says in a line how to make the export (our strings).
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import type { ImportBatch, ImportSourceKind } from '@/api/types'
import { AGENT_TEXT } from '@/import/agent/text'
import { useImportDialog } from '@/import/useImportDialog'
import { useSettingsModal } from '../useSettingsModal'
import { SectionHeader, SettingGroup } from '../controls'

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
  anytypeHelp: 'In Anytype, export the space (or the objects you want) as Markdown with files included. Then choose the .zip or folder it saves.',
  // our strings: earlier imports into this space, and the way back to their review
  history: 'Import history',
  historyHelp: 'Imports into this space, newest first. Review reopens the proposed schema, the trial and the Import inbox.',
  historyEmpty: 'Nothing has been imported into this space yet.',
  historyObjects: (n: number) => `${n} ${n === 1 ? 'object' : 'objects'}`,
  review: AGENT_TEXT.continueButton,
  reviewLabel: (source: string) => `${AGENT_TEXT.continueButton}: ${source}`,
} as const

const T = IMPORT_CONTENT_TEXT

export const IMPORT_CONTENT_SEARCH: string[] = [T.startImporting, T.notion, T.obsidian, T.anytype]

const SOURCES: { kind: ImportSourceKind; label: string; help: string }[] = [
  { kind: 'notion', label: T.notion, help: T.notionHelp },
  { kind: 'obsidian', label: T.obsidian, help: T.obsidianHelp },
  { kind: 'anytype', label: T.anytype, help: T.anytypeHelp },
]

function openImport(kind: ImportSourceKind | 'auto') {
  useSettingsModal.getState().close()
  useImportDialog.getState().open({ kind })
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

function ImportHistory() {
  const [batches, setBatches] = useState<ImportBatch[] | null>(null)
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
              <li key={b.id} data-import-batch={b.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-fg" title={b.source.path}>
                    {name}
                  </p>
                  <p className="text-[13px] text-fg-muted">
                    {[when, T.historyObjects(b.counts.imported ?? 0)].filter(Boolean).join(' · ')}
                  </p>
                </div>
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
              </li>
            )
          })}
        </ul>
      )}
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
      <ImportHistory />
    </div>
  )
}
