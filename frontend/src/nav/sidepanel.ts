/**
 * Pure helpers over one tab's side-panel entries (Capacities' `SidepanelEntry` list). The panel has
 * three areas stacked top to bottom; each area holds entries (its "sidepanel tabs"), one of them
 * open. `nav/tabs.ts` applies these to the active tab.
 */
import { sameTarget, type SidepanelEntry, type SidepanelLayout, type SidepanelTarget, type Tab } from './tabs'

export type PanelArea = SidepanelEntry['panelArea']

export const AREAS: readonly PanelArea[] = ['area1', 'area2', 'area3']

/** M1's right panel width. */
export const DEFAULT_SIDEPANEL_WIDTH = 500
export const MIN_SIDEPANEL_WIDTH = 320
/** The panel never takes more than this share of the window. */
export const MAX_SIDEPANEL_FRACTION = 0.6
/** An area never shrinks below (or grows above) this share of the panel height. */
export const MIN_AREA_FRACTION = 0.1
/** How many targets an entry remembers for its own back and forward. */
export const ENTRY_HISTORY_LIMIT = 30

export function isPanelArea(v: unknown): v is PanelArea {
  return v === 'area1' || v === 'area2' || v === 'area3'
}

export function sameSidepanelTarget(a: SidepanelTarget | null | undefined, b: SidepanelTarget | null | undefined): boolean {
  if (!a || !b) return false
  if (a.kind === 'localGraph' || b.kind === 'localGraph') return a.kind === b.kind
  return sameTarget(a, b)
}

/** The entries of `tab` (none when it has no side panel yet). */
export function entriesOf(tab: Tab | null | undefined): SidepanelEntry[] {
  return tab?.sidepanel ?? []
}

/** The open entry of `area`, if any. */
export function openEntryIn(entries: SidepanelEntry[], area: PanelArea): SidepanelEntry | undefined {
  return entries.find((e) => e.panelArea === area && e.isOpen)
}

/** The areas that show an entry, top to bottom. */
export function visibleAreas(entries: SidepanelEntry[]): PanelArea[] {
  return AREAS.filter((a) => openEntryIn(entries, a))
}

/** Whether the tab shows its side panel: not hidden, and some area has an open entry. */
export function isSidepanelShown(tab: Tab | null | undefined): boolean {
  return !!tab && !tab.hideSidepanel && visibleAreas(entriesOf(tab)).length > 0
}

/** An entry's own history (its current target is `history[index]`). */
export function entryHistory(e: SidepanelEntry): { history: SidepanelTarget[]; index: number } {
  if (Array.isArray(e.history) && typeof e.index === 'number' && e.index >= 0 && e.index < e.history.length) {
    return { history: e.history, index: e.index }
  }
  return e.target ? { history: [e.target], index: 0 } : { history: [], index: -1 }
}

export function entryCanGoBack(e: SidepanelEntry): boolean {
  return entryHistory(e).index > 0
}

export function entryCanGoForward(e: SidepanelEntry): boolean {
  const h = entryHistory(e)
  return h.index >= 0 && h.index < h.history.length - 1
}

/** Make `id` the open entry of its area (the others in that area close). */
function openOnly(entries: SidepanelEntry[], id: string): SidepanelEntry[] {
  const area = entries.find((e) => e.id === id)?.panelArea
  if (!area) return entries
  return entries.map((e) => (e.panelArea !== area ? e : e.id === id ? (e.isOpen ? e : { ...e, isOpen: true }) : e.isOpen ? { ...e, isOpen: false } : e))
}

/** `target` becomes the entry's current target (forward history dropped, oldest trimmed). */
function pushTarget(e: SidepanelEntry, target: SidepanelTarget | null): SidepanelEntry {
  if (sameSidepanelTarget(e.target, target)) return e
  if (!target) return { ...e, target: null, history: [], index: -1 }
  const h = entryHistory(e)
  const history = [...h.history.slice(0, h.index + 1), target]
  const cut = Math.max(0, history.length - ENTRY_HISTORY_LIMIT)
  return { ...e, target, history: history.slice(cut), index: history.length - 1 - cut }
}

/**
 * Open `target` in `area`: an entry already showing M5's local graph is revealed; otherwise the
 * area's open non-persistent entry shows the target, else a new open entry is added.
 */
export function openInArea(entries: SidepanelEntry[], target: SidepanelTarget, area: PanelArea, newId: () => string): SidepanelEntry[] {
  if (target.kind === 'localGraph') {
    const graph = entries.find((e) => e.target?.kind === 'localGraph')
    if (graph) return openOnly(entries, graph.id)
  }
  const open = openEntryIn(entries, area)
  if (open && sameSidepanelTarget(open.target, target)) return entries
  if (open && !open.isPersistent) return entries.map((e) => (e.id === open.id ? pushTarget(e, target) : e))
  const entry: SidepanelEntry = { id: newId(), target, isOpen: true, panelArea: area, history: [target], index: 0 }
  return openOnly([...entries, entry], entry.id)
}

/** Add an empty ("Explore") entry to `area`, open. */
export function addEmptyEntry(entries: SidepanelEntry[], area: PanelArea, newId: () => string): SidepanelEntry[] {
  const entry: SidepanelEntry = { id: newId(), target: null, isOpen: true, panelArea: area }
  return openOnly([...entries, entry], entry.id)
}

/** The entry of `area` that takes over when `gone` leaves it: the one after it, else the one before. */
function neighbour(entries: SidepanelEntry[], gone: SidepanelEntry): SidepanelEntry | undefined {
  const same = entries.filter((e) => e.panelArea === gone.panelArea)
  const i = same.findIndex((e) => e.id === gone.id)
  return same[i + 1] ?? same[i - 1]
}

export function closeEntry(entries: SidepanelEntry[], id: string): SidepanelEntry[] {
  const gone = entries.find((e) => e.id === id)
  if (!gone) return entries
  const next = gone.isOpen ? neighbour(entries, gone) : undefined
  const rest = entries.filter((e) => e.id !== id)
  return next ? openOnly(rest, next.id) : rest
}

export function activateEntry(entries: SidepanelEntry[], id: string): SidepanelEntry[] {
  return openOnly(entries, id)
}

/** Move entry `id` to `area`, where it becomes the open entry; its old area shows a neighbour. */
export function moveEntry(entries: SidepanelEntry[], id: string, area: PanelArea): SidepanelEntry[] {
  const e = entries.find((x) => x.id === id)
  if (!e || e.panelArea === area) return entries
  const next = e.isOpen ? neighbour(entries, e) : undefined
  let out = entries.filter((x) => x.id !== id)
  if (next) out = openOnly(out, next.id)
  out = [...out, { ...e, panelArea: area, isOpen: true }]
  return openOnly(out, id)
}

/** A link followed inside entry `id`: the entry shows `target` and remembers where it was. */
export function navigateEntry(entries: SidepanelEntry[], id: string, target: SidepanelTarget | null): SidepanelEntry[] {
  return entries.map((e) => (e.id === id ? pushTarget(e, target) : e))
}

/** Step entry `id` back (`-1`) or forward (`+1`) in its own history. */
export function stepEntry(entries: SidepanelEntry[], id: string, dir: -1 | 1): SidepanelEntry[] {
  return entries.map((e) => {
    if (e.id !== id) return e
    const h = entryHistory(e)
    const i = h.index + dir
    if (h.index < 0 || i < 0 || i >= h.history.length) return e
    return { ...e, target: h.history[i], history: h.history, index: i }
  })
}

export function togglePersistentEntry(entries: SidepanelEntry[], id: string): SidepanelEntry[] {
  return entries.map((e) => (e.id === id ? { ...e, isPersistent: !e.isPersistent } : e))
}

/** An object moved: every entry's target and history follow it. */
export function retargetEntries(entries: SidepanelEntry[], oldPath: string, newPath: string): SidepanelEntry[] {
  const hit = (t: SidepanelTarget | null | undefined) => t?.kind === 'object' && t.path === oldPath
  if (!entries.some((e) => hit(e.target) || (e.history ?? []).some(hit))) return entries
  const moved = (t: SidepanelTarget): SidepanelTarget => (hit(t) ? { kind: 'object', path: newPath } : t)
  return entries.map((e) => ({
    ...e,
    target: e.target ? moved(e.target) : null,
    ...(e.history ? { history: e.history.map(moved) } : {}),
  }))
}

/** The panel width, kept between the minimum and the window share. */
export function clampWidth(width: number, windowWidth: number): number {
  const max = Math.max(MIN_SIDEPANEL_WIDTH, Math.floor(windowWidth * MAX_SIDEPANEL_FRACTION))
  return Math.round(Math.min(max, Math.max(MIN_SIDEPANEL_WIDTH, width)))
}

export function clampFraction(f: number): number {
  return Math.min(1 - MIN_AREA_FRACTION, Math.max(MIN_AREA_FRACTION, f))
}

/**
 * The height share of each visible area after the first (the first takes the rest): `area2Size` and
 * `area3Size` from the layout, else an even split.
 */
export function areaFractions(layout: SidepanelLayout | undefined, visible: PanelArea[]): Partial<Record<PanelArea, number>> {
  const out: Partial<Record<PanelArea, number>> = {}
  const even = 1 / Math.max(1, visible.length)
  for (const a of visible.slice(1)) {
    const v = a === 'area2' ? layout?.area2Size : a === 'area3' ? layout?.area3Size : undefined
    out[a] = typeof v === 'number' && Number.isFinite(v) ? clampFraction(v) : even
  }
  return out
}

function cleanTarget(t: unknown): SidepanelTarget | null {
  return t && typeof t === 'object' && typeof (t as { kind?: unknown }).kind === 'string' ? (t as SidepanelTarget) : null
}

/** Clean persisted entries (unusable ones dropped). */
export function cleanEntries(v: unknown): SidepanelEntry[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: SidepanelEntry[] = []
  for (const x of v) {
    if (!x || typeof x !== 'object') continue
    const e = x as Partial<SidepanelEntry>
    if (typeof e.id !== 'string' || !isPanelArea(e.panelArea)) continue
    const entry: SidepanelEntry = { id: e.id, target: cleanTarget(e.target), isOpen: e.isOpen === true, panelArea: e.panelArea }
    if (e.isPersistent === true) entry.isPersistent = true
    if (Array.isArray(e.history) && typeof e.index === 'number') {
      const history = e.history.map(cleanTarget).filter((t): t is SidepanelTarget => t !== null)
      if (e.index >= 0 && e.index < history.length && sameSidepanelTarget(history[e.index], entry.target)) {
        entry.history = history
        entry.index = e.index
      }
    }
    out.push(entry)
  }
  // One open entry per area at most.
  const seen = new Set<PanelArea>()
  return out.map((e) => {
    if (!e.isOpen) return e
    if (seen.has(e.panelArea)) return { ...e, isOpen: false }
    seen.add(e.panelArea)
    return e
  })
}

export function cleanLayout(v: unknown): SidepanelLayout | undefined {
  if (!v || typeof v !== 'object') return undefined
  const l = v as Record<string, unknown>
  const out: SidepanelLayout = {}
  for (const k of ['width', 'area2Size', 'area3Size'] as const) {
    if (typeof l[k] === 'number' && Number.isFinite(l[k])) out[k] = l[k] as number
  }
  return out
}
