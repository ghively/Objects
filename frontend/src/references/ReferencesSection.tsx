/**
 * The references section at the bottom of an object (`page` and `peek` modes): tabs All /
 * Backlinks / Related Content / Mentions / Related tags, as the server offers them for the
 * object's role (`References.tabs`). Nothing renders when the object offers no tabs. The active
 * tab is a filled pill; clicking it again hides the content, clicking any tab shows it; the tab
 * and closed state are remembered per object (`referencesUi.ts`). "All" stacks the other tabs'
 * content in tab order, each under its label.
 */
import { useEffect, useState } from 'react'
import type { ObjectSummary, References, ReferencesTab, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { BacklinksTab } from './BacklinksTab'
import { MentionsTab } from './MentionsTab'
import { RelatedTab } from './RelatedTab'
import { RelatedTagsTab } from './RelatedTagsTab'
import {
  loadReferencesUi,
  REFERENCES_TEXT,
  RELATED_STEP,
  saveReferencesUi,
  TAB_META,
  tabCount,
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
  const [ui, setUi] = useState<ReferencesUi>(() => loadReferencesUi(key))
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    setUi(loadReferencesUi(key))
    setToast(null)
  }, [key])

  useEffect(() => {
    setLimit(RELATED_STEP)
  }, [path])

  if (!data || data.tabs.length === 0) return null

  const active: ReferencesTab = data.tabs.includes(ui.tab) ? ui.tab : data.tabs[0]

  const choose = (tab: ReferencesTab) => {
    const next: ReferencesUi = tab === active ? { tab, closed: !ui.closed } : { tab, closed: false }
    setUi(next)
    saveReferencesUi(key, next)
  }

  return (
    <section data-references-section="" aria-label="References" className="mt-10 flex flex-col gap-3 pb-6">
      <div role="tablist" aria-label="References" className="flex flex-wrap items-center gap-1">
        {data.tabs.map((tab) => {
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
                {tabCount(tab, data)}
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
            <div className="flex flex-col gap-6">
              {data.tabs
                .filter((t) => t !== 'all')
                .map((t) => (
                  <div key={t} data-all-part={t} className="flex flex-col gap-2">
                    <h3 className="text-[13px] font-semibold text-fg-muted">{TAB_META[t].label}</h3>
                    <TabContent
                      tab={t}
                      path={path}
                      data={data}
                      limit={limit}
                      reload={reload}
                      onShowMore={() => setLimit((n) => n + RELATED_STEP)}
                      onToast={setToast}
                    />
                  </div>
                ))}
            </div>
          ) : (
            <TabContent
              tab={active}
              path={path}
              data={data}
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
  limit,
  reload,
  onShowMore,
  onToast,
}: {
  tab: Exclude<ReferencesTab, 'all'>
  path: string
  data: References
  limit: number
  reload(opts?: ReloadOptions): void
  onShowMore(): void
  onToast(message: string): void
}) {
  switch (tab) {
    case 'backlinks':
      return <BacklinksTab entries={data.backlinks} summaries={data.summaries} />
    case 'related':
      return <RelatedTab entries={data.related} summaries={data.summaries} limit={limit} onShowMore={onShowMore} />
    case 'mentions':
      return <MentionsTab target={path} entries={data.mentions} summaries={data.summaries} reload={reload} onToast={onToast} />
    case 'relatedTags':
      return <RelatedTagsTab entries={data.relatedTags} summaries={data.summaries} />
  }
}
