/**
 * M31 item 6: the empty side-panel entry, "Explore" (catalog section 7): two tabs.
 *
 * - "Explore": two cards, "AI Chat" (opens the chat in this entry, as before; hidden with "Hide AI
 *   features") and "Search" (opens the Search page in this entry). Under them, smaller, the entries
 *   the panel offered before M31 that the catalog places nowhere else: "Graph View" and "Backlinks"
 *   (our call: kept, so no feature is lost).
 * - "Relevant Content": the objects related to the page open in the main view (the references
 *   call's `related`, as the AI chat's own "Relevant Content" shows them) with "Find More", which
 *   opens search as the AI chat's does.
 *
 * Which tab shows is the component's own state, "Explore" first (our call).
 */
import { useState } from 'react'
import { AI_CHAT_TEXT } from '@/ai/aiText'
import { useAiHidden } from '@/ai/store'
import type { ObjectSummary } from '@/api/types'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { BACKLINKS_TARGET } from '@/nav/sidepanel'
import { currentTarget, useTabs } from '@/nav/tabs'
import { usePalette } from '@/palette/usePalette'
import { EntryHeader } from '@/references/BacklinksTab'
import { REFERENCES_TEXT } from '@/references/referencesUi'
import { useReferences } from '@/references/useReferences'

export const EXPLORE_TEXT = {
  /** catalog: the tabs and the cards */
  explore: 'Explore',
  relevant: AI_CHAT_TEXT.relevant,
  findMore: AI_CHAT_TEXT.findMore,
  aiChat: AI_CHAT_TEXT.title,
  search: 'Search',
  /** our strings */
  description: 'Chat with AI, open relevant content or view the graph view to expand the context of your work.',
  aiChatHelp: AI_CHAT_TEXT.exploreCardHelp,
  searchHelp: 'Find objects by title and text.',
  more: 'More',
  graph: 'Graph View',
  backlinks: REFERENCES_TEXT.backlinksPanelTitle,
  backlinksTooltip: 'Backlinks & Mentions\n\nShows the backlinks and mentions of the object in the main window.',
  relevantNone: AI_CHAT_TEXT.relevantNone,
  relevantEmpty: AI_CHAT_TEXT.relevantEmpty,
} as const

type ExploreTab = 'explore' | 'relevant'

/** How many related objects the tab lists. */
const RELEVANT_LIMIT = 20

function Card({ label, help, icon, onClick }: { label: string; help: string; icon: string; onClick(): void }) {
  const helpId = `explore-card-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <button
      type="button"
      data-testid="explore-card"
      aria-label={label}
      aria-describedby={helpId}
      onClick={onClick}
      className="flex w-full min-w-0 items-start gap-3 rounded-xl border border-line bg-raised p-3 text-left hover:bg-hover"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-hover text-fg">
        <Icon name={icon} size={17} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[14px] font-semibold text-fg">{label}</span>
        <span id={helpId} className="text-[13px] text-fg-muted">
          {help}
        </span>
      </span>
    </button>
  )
}

function SmallButton({ label, title, icon, onClick }: { label: string; title?: string; icon: string; onClick(): void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  )
}

function RelatedList({ path }: { path: string }) {
  const { data, loading } = useReferences(path, RELEVANT_LIMIT)
  const entries = data?.related ?? []
  const summaries: Record<string, ObjectSummary> = data?.summaries ?? {}
  if (!data) return loading ? null : <p className="px-1 text-[13px] text-fg-muted">{EXPLORE_TEXT.relevantEmpty}</p>
  if (entries.length === 0) return <p className="px-1 text-[13px] text-fg-muted">{EXPLORE_TEXT.relevantEmpty}</p>
  const list = entries.map((e) => e.path)
  return (
    <ul className="flex flex-col gap-0.5" data-references-list="explore-related">
      {entries.slice(0, RELEVANT_LIMIT).map((e) => (
        <li key={e.path}>
          <EntryHeader path={e.path} summary={summaries[e.path]} list={list} />
        </li>
      ))}
    </ul>
  )
}

function RelevantContent() {
  const main = useTabs((s) => currentTarget(s))
  const path = main?.kind === 'object' ? main.path : null
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-[13px] font-semibold text-fg-muted">{EXPLORE_TEXT.relevant}</h3>
        <button
          type="button"
          onClick={() => usePalette.getState().show('search')}
          className="rounded-md px-2 py-0.5 text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
        >
          {EXPLORE_TEXT.findMore}
        </button>
      </div>
      {path ? <RelatedList key={path} path={path} /> : <p className="px-1 text-[13px] text-fg-muted">{EXPLORE_TEXT.relevantNone}</p>}
    </div>
  )
}

/** The empty entry's content; `entryId` is the entry its cards navigate. */
export function ExplorePanel({ entryId }: { entryId: string }) {
  const aiHidden = useAiHidden()
  const [tab, setTab] = useState<ExploreTab>('explore')
  const go = useTabs.getState().navigateSidepanelEntry
  const tabButton = (id: ExploreTab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={cn(
        'h-7 rounded-md px-2.5 text-[13px] font-medium',
        tab === id ? 'bg-hover text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
      )}
    >
      {label}
    </button>
  )
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="explore-panel">
      <div role="tablist" aria-label={EXPLORE_TEXT.explore} className="flex shrink-0 items-center gap-1 px-3 pt-3 pb-2">
        {tabButton('explore', EXPLORE_TEXT.explore)}
        {tabButton('relevant', EXPLORE_TEXT.relevant)}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-auto px-3 pb-4">
        {tab === 'explore' ? (
          <div className="flex flex-col gap-2">
            <p className="pb-1 text-[13px] text-fg-muted">{EXPLORE_TEXT.description}</p>
            {!aiHidden && (
              <Card label={EXPLORE_TEXT.aiChat} help={EXPLORE_TEXT.aiChatHelp} icon="ph-sparkle" onClick={() => go(entryId, { kind: 'aiChat' })} />
            )}
            <Card label={EXPLORE_TEXT.search} help={EXPLORE_TEXT.searchHelp} icon="ph-magnifying-glass" onClick={() => go(entryId, { kind: 'search' })} />
            <div className="flex flex-wrap items-center gap-1 pt-2" aria-label={EXPLORE_TEXT.more} role="group">
              <SmallButton label={EXPLORE_TEXT.graph} icon="ph-graph" onClick={() => go(entryId, { kind: 'localGraph' })} />
              <SmallButton
                label={EXPLORE_TEXT.backlinks}
                title={EXPLORE_TEXT.backlinksTooltip}
                icon="ph-link-simple"
                onClick={() => go(entryId, BACKLINKS_TARGET)}
              />
            </div>
          </div>
        ) : (
          <RelevantContent />
        )}
      </div>
    </div>
  )
}
