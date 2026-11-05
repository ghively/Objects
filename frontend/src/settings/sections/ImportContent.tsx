// "Import Content" (the catalog's General section): "Start importing" opens the M15 import dialog
// (`import/ImportDialog.tsx`), which detects the source; one row per source Object reads (Notion,
// Obsidian, Anytype) opens it preset to that source. No migration guides from the web: Object
// makes no network requests, so each row says in a line how to make the export (our strings).
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import type { ImportSourceKind } from '@/api/types'
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
    </div>
  )
}
