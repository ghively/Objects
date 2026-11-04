/**
 * The side panel's backlinks entry ("Backlinks & Mentions.
 * Shows the backlinks and mentions of the object in the main window."). `path` is the object the
 * tab's main view shows, so the entry follows the tab as it navigates; with no object there, or one
 * whose type has no references section, it says "Backlinks not available". Backlinks render with
 * the same settings as the references section; the section defaults and hiding apply to object
 * pages only (our reading), so both lists always show here.
 */
import { useMemo, useState } from 'react'
import { useSettings } from '@/settings/useSettings'
import { BacklinksTab, EmptyState } from './BacklinksTab'
import { MentionsTab } from './MentionsTab'
import { REFERENCES_TEXT, referencesSettings, RELATED_STEP, TAB_META } from './referencesUi'
import { useReferences } from './useReferences'

export interface BacklinksPanelProps {
  /** The main view's object, or null when the main view shows no object. */
  path: string | null
}

function NoSupport() {
  return (
    <div data-backlinks-panel="none" className="p-4">
      <EmptyState title={REFERENCES_TEXT.backlinksNoSupportTitle} description={REFERENCES_TEXT.backlinksNoSupportDescription} />
    </div>
  )
}

export function BacklinksPanel({ path }: BacklinksPanelProps) {
  if (!path) return <NoSupport />
  return <PanelContent key={path} path={path} />
}

function PanelContent({ path }: { path: string }) {
  const { data, reload } = useReferences(path, RELATED_STEP)
  const rawSettings = useSettings((s) => s.settings)
  const settings = useMemo(() => referencesSettings(rawSettings), [rawSettings])
  const [toast, setToast] = useState<string | null>(null)
  if (!data) return null
  if (!data.tabs.includes('backlinks')) return <NoSupport />
  return (
    <div data-backlinks-panel={path} className="flex flex-col gap-6 p-4">
      {toast && (
        <p role="status" className="text-[13px] text-fg-muted">
          {toast}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <h3 className="text-[13px] font-semibold text-fg-muted">{TAB_META.backlinks.label}</h3>
        <BacklinksTab
          entries={data.backlinks}
          summaries={data.summaries}
          view={settings.backlinkContentView}
          nestedView={settings.nestedBacklinkView}
        />
      </div>
      {data.tabs.includes('mentions') && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold text-fg-muted">{TAB_META.mentions.label}</h3>
          <MentionsTab target={path} entries={data.mentions} summaries={data.summaries} reload={reload} onToast={setToast} />
        </div>
      )}
    </div>
  )
}
