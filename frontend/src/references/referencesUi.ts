/**
 * The references section's strings and its per-object view state.
 *
 * Object keeps `referencesSectionTab`/`referencesSectionClosed` on the object's own data
 * (`component.model.ts`); we never write an object file for view state, so it lives in
 * `localStorage` under `object.references:<object id or path>`. Every access is wrapped in
 * try/catch: storage can be missing, full or blocked, and the section works without it.
 */
import type { ReferencesTab } from '@/api/types'

export interface ReferencesUi {
  tab: ReferencesTab
  closed: boolean
}

export const DEFAULT_REFERENCES_UI: ReferencesUi = { tab: 'all', closed: false }

/** The tab ids in `ReferencesSectionTab` order. */
export const REFERENCES_TABS: readonly ReferencesTab[] = ['all', 'backlinks', 'related', 'mentions', 'relatedTags']

/** Strings: verbatim from Object's English strings unless marked "our string". */
export const REFERENCES_TEXT = {
  /** `PageBacklinkSection.clickAgainToHide` */
  clickAgainToHide: 'Click again to hide',
  /** `PageBacklinkSection.mentionsInText.label` */
  mentionsInText: 'Mentions in text',
  /** our string */
  via: (property: string) => `via ${property}`,
  /** `PageBacklinkSection.emptyTitle` */
  backlinksEmptyTitle: 'No backlinks yet',
  /** `PageBacklinkSection.emptyDescription` */
  backlinksEmptyDescription: 'Link to this object from another page to create a backlink.',
  /** `textEditBar.link` */
  link: 'Link',
  /** `PageBacklinkSection.linkCreated` */
  linkCreated: 'Link created',
  /** our string (as M3) */
  changedElsewhere: 'Changed elsewhere. Reloaded.',
  /** our string */
  linkFailed: 'Could not create the link.',
  /** our string */
  mentionsEmpty: 'No unlinked mentions',
  /** `PageBacklinkSection.relatedContent.showMore` */
  showMore: 'Show more',
  /** `PageBacklinkSection.relatedContent.emptyTitle` */
  relatedEmptyTitle: 'No related content yet',
  /** our string: Object's says "Semantically related…", which our lexical stand-in isn't */
  relatedEmptyDescription: 'Objects that share words with this one will appear here.',
  /** our string */
  relatedTagsEmpty: 'No related tags',
} as const

/** Each tab's label and info tooltip. */
export const TAB_META: Record<ReferencesTab, { label: string; info?: string }> = {
  /** `PageBacklinkSection.all` */
  all: { label: 'All' },
  /** `PageBacklinkSection.incoming`, `.incomingInfo` */
  backlinks: { label: 'Backlinks', info: 'Links to this object' },
  /** `PageBacklinkSection.relatedContent.label`, `.info` */
  related: { label: 'Related Content', info: 'Similar objects' },
  /** `PageBacklinkSection.unlinkedMentions.label`, `.info` */
  mentions: { label: 'Mentions', info: 'Unlinked name matches' },
  /** `components.RootTag.relatedTags` */
  relatedTags: { label: 'Related tags' },
}

/** How many more related objects "Show more" asks for. */
export const RELATED_STEP = 20

export function referencesKey(idOrPath: string): string {
  return `object.references:${idOrPath}`
}

function isTab(v: unknown): v is ReferencesTab {
  return typeof v === 'string' && (REFERENCES_TABS as readonly string[]).includes(v)
}

/** The saved tab and closed state for an object, or the default. */
export function loadReferencesUi(idOrPath: string): ReferencesUi {
  try {
    const raw = globalThis.localStorage?.getItem(referencesKey(idOrPath))
    if (!raw) return { ...DEFAULT_REFERENCES_UI }
    const v = JSON.parse(raw) as Partial<ReferencesUi> | null
    return {
      tab: isTab(v?.tab) ? v.tab : DEFAULT_REFERENCES_UI.tab,
      closed: typeof v?.closed === 'boolean' ? v.closed : DEFAULT_REFERENCES_UI.closed,
    }
  } catch {
    return { ...DEFAULT_REFERENCES_UI }
  }
}

export function saveReferencesUi(idOrPath: string, ui: ReferencesUi): void {
  try {
    globalThis.localStorage?.setItem(referencesKey(idOrPath), JSON.stringify({ tab: ui.tab, closed: ui.closed }))
  } catch {
    // Storage blocked or full: the state lasts for this view only.
  }
}

/** The muted count beside a tab label (our addition): objects for each tab, their sum for All. */
export function tabCount(
  tab: ReferencesTab,
  data: { tabs: ReferencesTab[]; backlinks: unknown[]; related: unknown[]; mentions: unknown[]; relatedTags: unknown[] },
): number {
  switch (tab) {
    case 'backlinks':
      return data.backlinks.length
    case 'related':
      return data.related.length
    case 'mentions':
      return data.mentions.length
    case 'relatedTags':
      return data.relatedTags.length
    case 'all':
      return data.tabs.filter((t) => t !== 'all').reduce((n, t) => n + tabCount(t, data), 0)
  }
}

/** Split `text` around `[start, end)` (clamped), for a highlighted span. */
export function splitAt(text: string, start: number, end: number): [string, string, string] {
  const s = Math.max(0, Math.min(text.length, start))
  const e = Math.max(s, Math.min(text.length, end))
  return [text.slice(0, s), text.slice(s, e), text.slice(e)]
}
