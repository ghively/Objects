/**
 * The references section's strings and its per-object view state.
 *
 * The open tab and closed state are view state; we never write an object file for view state, so it lives in
 * `localStorage` under `object.references:<object id or path>`. Every access is wrapped in
 * try/catch: storage can be missing, full or blocked, and the section works without it.
 */
import type { BodyContext, ReferencesTab } from '@/api/types'
import { cpToUtf16 } from '@/lib/codepoints'

export interface ReferencesUi {
  tab: ReferencesTab
  closed: boolean
  /** M8: the "All" parts the user opened (true) or closed (false) on this object; unset ones follow the setting. */
  parts?: Partial<Record<ReferencesTab, boolean>>
}

export const DEFAULT_REFERENCES_UI: ReferencesUi = { tab: 'all', closed: false }

/** The tab ids in `ReferencesSectionTab` order. */
export const REFERENCES_TABS: readonly ReferencesTab[] = ['all', 'backlinks', 'related', 'mentions', 'relatedTags']

/** The section's strings. */
export const REFERENCES_TEXT = {
  clickAgainToHide: 'Click again to hide',
  mentionsInText: 'Mentions in text',
  /** our string */
  via: (property: string) => `via ${property}`,
  backlinksEmptyTitle: 'No backlinks yet',
  backlinksEmptyDescription: 'Link to this object from another page to create a backlink.',
  link: 'Link',
  linkCreated: 'Link created',
  /** our string (as M3) */
  changedElsewhere: 'Changed elsewhere. Reloaded.',
  /** our string */
  linkFailed: 'Could not create the link.',
  /** our string */
  mentionsEmpty: 'No unlinked mentions',
  showMore: 'Show more',
  /** Paged lists; the backlinks list shows 50 at a time */
  loadMore: 'Load more',
  relatedEmptyTitle: 'No related content yet',
  /** our string: the stand-in is lexical, not semantic */
  relatedEmptyDescription: 'Objects that share words with this one will appear here.',
  /** our string */
  relatedTagsEmpty: 'No related tags',
  /** The per-backlink toggle's group name */
  nestedView: 'Default display of nested backlinks',
  showBlockContainingBacklink: 'Only block with backlink',
  showFullPathAbove: 'Full path above',
  backlinksNoSupportTitle: 'Backlinks not available',
  backlinksNoSupportDescription: 'This content type does not support backlinks.',
  /** The side-panel entry's title */
  backlinksPanelTitle: 'Backlinks',
} as const

/** Each tab's label and info tooltip. */
export const TAB_META: Record<ReferencesTab, { label: string; info?: string }> = {
  all: { label: 'All' },
  backlinks: { label: 'Backlinks', info: 'Links to this object' },
  related: { label: 'Related Content', info: 'Similar objects' },
  mentions: { label: 'Mentions', info: 'Unlinked name matches' },
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

function cleanParts(v: unknown): Partial<Record<ReferencesTab, boolean>> | undefined {
  if (!v || typeof v !== 'object') return undefined
  const out: Partial<Record<ReferencesTab, boolean>> = {}
  for (const [k, b] of Object.entries(v as Record<string, unknown>)) {
    if (isTab(k) && typeof b === 'boolean') out[k] = b
  }
  return Object.keys(out).length ? out : undefined
}

/** The state saved for an object, or null when the user never changed it there. */
export function loadSavedReferencesUi(idOrPath: string): ReferencesUi | null {
  try {
    const raw = globalThis.localStorage?.getItem(referencesKey(idOrPath))
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<ReferencesUi> | null
    if (!v || typeof v !== 'object') return null
    const ui: ReferencesUi = {
      tab: isTab(v.tab) ? v.tab : DEFAULT_REFERENCES_UI.tab,
      closed: typeof v.closed === 'boolean' ? v.closed : DEFAULT_REFERENCES_UI.closed,
    }
    const parts = cleanParts(v.parts)
    if (parts) ui.parts = parts
    return ui
  } catch {
    return null
  }
}

/** The saved tab and closed state for an object, or the default. */
export function loadReferencesUi(idOrPath: string): ReferencesUi {
  return loadSavedReferencesUi(idOrPath) ?? { ...DEFAULT_REFERENCES_UI }
}

export function saveReferencesUi(idOrPath: string, ui: ReferencesUi): void {
  try {
    const out: ReferencesUi = { tab: ui.tab, closed: ui.closed }
    const parts = cleanParts(ui.parts)
    if (parts) out.parts = parts
    globalThis.localStorage?.setItem(referencesKey(idOrPath), JSON.stringify(out))
  } catch {
    // Storage blocked or full: the state lasts for this view only.
  }
}

// -- M8: the references settings ------------------------------------------------

/** `DeviceSettings.backlinkSectionsDefault` values: open, closed or hidden. */
export type SectionDefault = 'open' | 'closed' | 'hidden'
export type BacklinkContentView = 'inline' | 'smallCard' | 'wideCard' | 'embed'
export type NestedBacklinkView = 'showBlockContainingBacklink' | 'showFullPathAbove'

export interface SectionDefaults {
  backlinks: SectionDefault
  relatedContent: SectionDefault
  unlinkedMentions: SectionDefault
}

/** The device settings this section follows (contract `DeviceSettings`, M8). */
export interface ReferencesSettings {
  backlinkSectionsDefault: SectionDefaults
  backlinkContentView: BacklinkContentView
  relatedContentHiddenTypes: string[]
  nestedBacklinkView: NestedBacklinkView
}

export const REFERENCES_SETTINGS_DEFAULTS: ReferencesSettings = Object.freeze({
  backlinkSectionsDefault: Object.freeze({ backlinks: 'open', relatedContent: 'open', unlinkedMentions: 'open' }),
  // "Embed is the default when no option is selected."
  backlinkContentView: 'embed',
  relatedContentHiddenTypes: [],
  nestedBacklinkView: 'showBlockContainingBacklink',
}) as ReferencesSettings

const SECTION_DEFAULTS: readonly SectionDefault[] = ['open', 'closed', 'hidden']
const CONTENT_VIEWS: readonly BacklinkContentView[] = ['inline', 'smallCard', 'wideCard', 'embed']
const NESTED_VIEWS: readonly NestedBacklinkView[] = ['showBlockContainingBacklink', 'showFullPathAbove']

function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback
}

/** The references settings out of the device settings, each key falling back to its default. */
export function referencesSettings(settings: unknown): ReferencesSettings {
  const s = (settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>
  const d = REFERENCES_SETTINGS_DEFAULTS
  const sec = (s.backlinkSectionsDefault && typeof s.backlinkSectionsDefault === 'object'
    ? s.backlinkSectionsDefault
    : {}) as Record<string, unknown>
  const hidden = Array.isArray(s.relatedContentHiddenTypes)
    ? s.relatedContentHiddenTypes.filter((t): t is string => typeof t === 'string')
    : []
  return {
    backlinkSectionsDefault: {
      backlinks: oneOf(sec.backlinks, SECTION_DEFAULTS, d.backlinkSectionsDefault.backlinks),
      relatedContent: oneOf(sec.relatedContent, SECTION_DEFAULTS, d.backlinkSectionsDefault.relatedContent),
      unlinkedMentions: oneOf(sec.unlinkedMentions, SECTION_DEFAULTS, d.backlinkSectionsDefault.unlinkedMentions),
    },
    backlinkContentView: oneOf(s.backlinkContentView, CONTENT_VIEWS, d.backlinkContentView),
    relatedContentHiddenTypes: hidden,
    nestedBacklinkView: oneOf(s.nestedBacklinkView, NESTED_VIEWS, d.nestedBacklinkView),
  }
}

/** Which setting a tab's section follows (All and Related tags follow none). */
export const SECTION_OF: Partial<Record<ReferencesTab, keyof SectionDefaults>> = {
  backlinks: 'backlinks',
  related: 'relatedContent',
  mentions: 'unlinkedMentions',
}

/**
 * The tabs shown for an object: the server's, minus sections set to "Hidden" and minus Related
 * Content for the types listed in "Hide related content for object types". With nothing but
 * "All" left there is no section.
 */
export function visibleTabs(tabs: ReferencesTab[], settings: ReferencesSettings, typeId: string | null | undefined): ReferencesTab[] {
  const out = tabs.filter((t) => {
    const section = SECTION_OF[t]
    if (section && settings.backlinkSectionsDefault[section] === 'hidden') return false
    if (t === 'related' && typeId && settings.relatedContentHiddenTypes.includes(typeId)) return false
    return true
  })
  return out.some((t) => t !== 'all') ? out : []
}

/**
 * Whether a part of "All" shows its content: the object's own choice when it made one, else its
 * section's default ("Closed" starts closed). Our reading of the setting for our tabbed section.
 */
export function partOpen(tab: ReferencesTab, ui: ReferencesUi, settings: ReferencesSettings): boolean {
  const own = ui.parts?.[tab]
  if (typeof own === 'boolean') return own
  const section = SECTION_OF[tab]
  return !section || settings.backlinkSectionsDefault[section] !== 'closed'
}

/**
 * The state of an object the user never changed: "All", closed when every shown section starts
 * "Closed" (our choice), else open with the closed sections' parts collapsed.
 */
export function defaultReferencesUi(tabs: ReferencesTab[], settings: ReferencesSettings): ReferencesUi {
  const sections = tabs.map((t) => SECTION_OF[t]).filter((s): s is keyof SectionDefaults => !!s)
  const closed = sections.length > 0 && sections.every((s) => settings.backlinkSectionsDefault[s] === 'closed')
  return { tab: 'all', closed }
}

/** A backlink context with M8's `ancestors` (the parent blocks' first lines, outermost first). */
export type NestedBodyContext = BodyContext & { ancestors?: string[] }

export function ancestorsOf(c: BodyContext): string[] {
  const a = (c as NestedBodyContext).ancestors
  return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string' && x !== '') : []
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

/** Split `text` around `[start, end)` code-point offsets from the backend (clamped), for a highlighted span. */
export function splitAt(text: string, start: number, end: number): [string, string, string] {
  const s = Math.max(0, Math.min(text.length, cpToUtf16(text, start)))
  const e = Math.max(s, Math.min(text.length, cpToUtf16(text, end)))
  return [text.slice(0, s), text.slice(s, e), text.slice(e)]
}
