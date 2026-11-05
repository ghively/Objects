// "Import Content" (the catalog's General section): "Start importing" opens the M15 import dialog
// (`import/ImportDialog.tsx`), which detects the source; one row per source Object reads (Notion,
// Obsidian, Anytype) opens it preset to that source. No migration guides from the web: Object
// makes no network requests, so each row says in a line how to make the export (our strings,
// Lane U writes them).
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
} as const

const T = IMPORT_CONTENT_TEXT

export const IMPORT_CONTENT_SEARCH: string[] = [T.startImporting, T.notion, T.obsidian, T.anytype]

const SOURCES: { kind: ImportSourceKind; label: string }[] = [
  { kind: 'notion', label: T.notion },
  { kind: 'obsidian', label: T.obsidian },
  { kind: 'anytype', label: T.anytype },
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
        <div className="flex flex-wrap gap-2">
          {SOURCES.map((s) => (
            <Button key={s.kind} type="button" variant="outline" size="sm" onClick={() => openImport(s.kind)}>
              {T.importFrom(s.label)}
            </Button>
          ))}
        </div>
      </SettingGroup>
    </div>
  )
}
