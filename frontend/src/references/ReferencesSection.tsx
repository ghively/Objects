/**
 * The references section at the bottom of an object (`page` and `peek` modes): tabs All /
 * Backlinks / Related Content / Mentions / Related tags, as the server offers them for the
 * object's role (`References.tabs`). Nothing renders when the object offers no tabs. The active
 * tab is a filled pill; clicking it again hides the content, clicking any tab shows it; the tab
 * and closed state are remembered per object (`referencesUi.ts`). "All" stacks the other tabs'
 * content in tab order, each under its label. M32 (the note page is for writing): a part with
 * nothing in it is one quiet line ("No backlinks yet", "No unlinked mentions"), with no label and
 * no explanation, so an empty note isn't crowded; a part with anything in it shows as before, and
 * every tab stays (unlinked mentions are never removed or hidden).
 *
 * M8 settings: a section set to "Hidden" loses its tab,
 * Related Content is dropped for the types in "Types without related content", and with no
 * per-object state yet a "Closed" section's part of All starts collapsed (every shown section
 * "Closed": the whole section starts closed). Any change made on the object (tab, hide, a part's
 * heading) is remembered per object and wins over the defaults. Backlinks render in "Backlink
 * content view" and nested ones per "How nested backlinks show at first".
 */
import { useEffect, useMemo, useState } from 'react'
import type { ObjectSummary, References, ReferencesTab, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { useSettings } from '@/settings/useSettings'
import { BacklinksTab } from './BacklinksTab'
import { MentionsTab } from './MentionsTab'
import { RelatedTab } from './RelatedTab'
import { RelatedTagsTab } from './RelatedTagsTab'
import {
  defaultReferencesUi,
  loadSavedReferencesUi,
  partOpen,
  REFERENCES_TEXT,
  referencesSettings,
  RELATED_STEP,
  saveReferencesUi,
  TAB_META,
  tabCount,
  visibleTabs,
  type ReferencesSettings,
  type ReferencesUi,
} from './referencesUi'
import { useReferences, type ReloadOptions } from './useReferences'

export interface ReferencesSectionProps {
  path: string
  summary: ObjectSummary
  type?: TypeDef
}

export function ReferencesSection({ path, summary }: ReferencesSectionProps) {
  const [limit, setLimit] = useState(RELATED_STEP)
  const { data, reload } = useReferences(path, limit)
  const key = summary.id ?? path
  const rawSettings = useSettings((s) => s.settings)
  const settings = useMemo(() => referencesSettings(rawSettings), [rawSettings])
  // The object's own saved state; null until the user changes something on it.
  const [saved, setSaved] = useState<ReferencesUi | null>(() => loadSavedReferencesUi(key))
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    setSaved(loadSavedReferencesUi(key))
    setToast(null)
  }, [key])

  useEffect(() => {
    setLimit(RELATED_STEP)
  }, [path])

  const tabs = useMemo(() => (data ? visibleTabs(data.tabs, settings, summary.type) : []), [data, settings, summary.type])
  if (!data || tabs.length === 0) return null

  const ui: ReferencesUi = saved ?? defaultReferencesUi(tabs, settings)
  const active: ReferencesTab = tabs.includes(ui.tab) ? ui.tab : tabs[0]

  const store = (next: ReferencesUi) => {
    setSaved(next)
    saveReferencesUi(key, next)
  }
  const choose = (tab: ReferencesTab) => {
    const base = tab === active ? { tab, closed: !ui.closed } : { tab, closed: false }
    store(ui.parts ? { ...base, parts: ui.parts } : base)
  }
  const togglePart = (tab: ReferencesTab) => {
    store({ ...ui, tab: active, parts: { ...ui.parts, [tab]: !partOpen(tab, ui, settings) } })
  }

  return (
    <section data-references-section="" aria-label="References" className="mt-10 flex flex-col gap-3 pb-6">
      <div role="tablist" aria-label="References" className="flex flex-wrap items-center gap-1">
        {tabs.map((tab) => {
          const meta = TAB_META[tab]
          const selected = tab === active
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              data-tab={tab}
              aria-selected={selected}
              aria-expanded={selected ? !ui.closed : undefined}
              title={selected ? REFERENCES_TEXT.clickAgainToHide : undefined}
              onClick={() => choose(tab)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium',
                selected ? 'bg-hover-2 text-fg' : 'text-fg-muted hover:bg-hover',
              )}
            >
              <span>{meta.label}</span>
              <span data-tab-count="" className="text-[12px] font-normal text-fg-muted">
                {tabCount(tab, { ...data, tabs })}
              </span>
              {meta.info && (
                <span data-tab-info={meta.info} title={meta.info} className="flex items-center text-fg-muted">
                  <Icon name="ph-info" size={12} />
                </span>
              )}
            </button>
          )
        })}
      </div>
      {toast && (
        <p role="status" className="text-[13px] text-fg-muted">
          {toast}
        </p>
      )}
      {!ui.closed && (
        <div role="tabpanel" data-tabpanel={active}>
          {active === 'all' ? (
            <div className="flex flex-col">
              {tabs
                .filter((t) => t !== 'all')
                .map((t) => {
                  const open = partOpen(t, ui, settings)
                  if (tabCount(t, { ...data, tabs }) === 0) {
                    // Nothing in it: its tab's one quiet line, with no heading to open or close.
                    return (
                      <div key={t} data-all-part={t} data-part-empty="" className="mt-1 first:mt-0">
                        <TabContent
                          tab={t}
                          path={path}
                          data={data}
                          settings={settings}
                          limit={limit}
                          reload={reload}
                          onShowMore={() => setLimit((n) => n + RELATED_STEP)}
                          onToast={setToast}
                        />
                      </div>
                    )
                  }
                  return (
                    <div key={t} data-all-part={t} data-part-open={open} className="mt-6 flex flex-col gap-2 first:mt-0">
                      <h3 className="text-[13px] font-semibold text-fg-muted">
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => togglePart(t)}
                          className="flex items-center gap-1 rounded-md hover:text-fg"
                        >
                          <Icon name={open ? 'ph-caret-down' : 'ph-caret-right'} size={12} />
                          {TAB_META[t].label}
                        </button>
                      </h3>
                      {open && (
                        <TabContent
                          tab={t}
                          path={path}
                          data={data}
                          settings={settings}
                          limit={limit}
                          reload={reload}
                          onShowMore={() => setLimit((n) => n + RELATED_STEP)}
                          onToast={setToast}
                        />
                      )}
                    </div>
                  )
                })}
            </div>
          ) : (
            <TabContent
              tab={active}
              path={path}
              data={data}
              settings={settings}
              limit={limit}
              reload={reload}
              onShowMore={() => setLimit((n) => n + RELATED_STEP)}
              onToast={setToast}
            />
          )}
        </div>
      )}
    </section>
  )
}

function TabContent({
  tab,
  path,
  data,
  settings,
  limit,
  reload,
  onShowMore,
  onToast,
}: {
  tab: Exclude<ReferencesTab, 'all'>
  path: string
  data: References
  settings: ReferencesSettings
  limit: number
  reload(opts?: ReloadOptions): void
  onShowMore(): void
  onToast(message: string): void
}) {
  switch (tab) {
    case 'backlinks':
      return (
        <BacklinksTab
          entries={data.backlinks}
          summaries={data.summaries}
          view={settings.backlinkContentView}
          nestedView={settings.nestedBacklinkView}
        />
      )
    case 'related':
      return <RelatedTab entries={data.related} summaries={data.summaries} limit={limit} onShowMore={onShowMore} />
    case 'mentions':
      return <MentionsTab target={path} entries={data.mentions} summaries={data.summaries} reload={reload} onToast={onToast} />
    case 'relatedTags':
      return <RelatedTagsTab entries={data.relatedTags} summaries={data.summaries} />
  }
}
