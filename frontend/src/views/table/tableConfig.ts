// The table layout's per-type column config: defaults, normalization and the pure edits the
// header, column menu and Customize ▸ Table page apply to it.
import type { PropertyDef, PropertyType, TableColumn, TableViewConfig, TypeDef } from '@/api/types'

/** Default column widths in rem, by property kind; everything else is 12. */
export const DEFAULT_COL_WIDTH: Partial<Record<PropertyType, number>> = {
  text: 13,
  textBlock: 16,
  entity: 12,
  entity_tags: 10,
  entity_title: 10,
  entity_description: 16,
  url: 16,
  label: 12,
  entity_collections: 10,
  // M12 (our widths)
  formula: 12,
  rollup: 12,
  uniqueId: 8,
  email: 16,
  phone: 11,
  files: 16,
  // M22 (our widths)
  steps: 18,
  textList: 16,
  floorItems: 12,
}
export const FALLBACK_COL_WIDTH = 12
export const MIN_COL_WIDTH = 2
export const MAX_COL_WIDTH = 50

export const clampWidth = (rem: number): number => Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, rem))

/** A property's width when no column width is stored: its own `tableColWidth`, else its kind's default. */
export function defaultWidth(def: Pick<PropertyDef, 'type'> & { tableColWidth?: unknown }): number {
  const own = def.tableColWidth
  if (typeof own === 'number' && Number.isFinite(own)) return clampWidth(own)
  return DEFAULT_COL_WIDTH[def.type] ?? FALLBACK_COL_WIDTH
}

/** M28: whether `def` is a computed other side (`options.counterpartOf`), never written on its row. */
export const isCounterpartDef = (def: Pick<PropertyDef, 'options'> | undefined): boolean => !!def?.options?.counterpartOf

/**
 * The properties a table can show: every definition (the backlinks as a read-only column), then
 * (M28) the type's computed other sides, as relation columns (`entity`) that the table renders
 * read-only (`isCounterpartDef`): a table edit can never write the counterpart's key on this row,
 * which is edited on the object page (it writes the stored side of the other objects).
 */
export const tableDefs = (type: Pick<TypeDef, 'propertyDefinitions' | 'counterparts'>): PropertyDef[] =>
  type.counterparts?.length ? [...type.propertyDefinitions, ...type.counterparts] : type.propertyDefinitions

/**
 * The config a table renders: `wrapAllContent` defaults to true, new properties are appended,
 * deleted ones pruned, a missing or non-numeric width takes the property's default, every width
 * is clamped to 2-50 rem, and the title column comes first and can't be hidden. Columns are
 * matched to definitions by property key.
 */
export function normalizeTableConfig(type: Pick<TypeDef, 'propertyDefinitions' | 'counterparts'>, config?: TableViewConfig | null): TableViewConfig {
  const defs = tableDefs(type)
  const byKey = new Map(defs.map((d) => [d.key, d]))
  const seen = new Set<string>()
  const cols: TableColumn[] = []
  for (const c of config?.properties ?? []) {
    const def = byKey.get(c.id)
    if (!def || seen.has(c.id)) continue
    seen.add(c.id)
    cols.push({
      ...c,
      type: def.type,
      isHidden: !!c.isHidden,
      wrapContent: !!c.wrapContent,
      colWidth: clampWidth(typeof c.colWidth === 'number' && Number.isFinite(c.colWidth) ? c.colWidth : defaultWidth(def)),
    })
  }
  for (const def of defs) {
    if (seen.has(def.key)) continue
    cols.push({ id: def.key, type: def.type, isHidden: false, wrapContent: false, colWidth: defaultWidth(def) })
  }
  const titleAt = cols.findIndex((c) => c.type === 'entity_title')
  if (titleAt > 0) cols.unshift(...cols.splice(titleAt, 1))
  if (cols[0]?.type === 'entity_title') cols[0] = { ...cols[0], isHidden: false }
  const out: TableViewConfig = { wrapAllContent: config?.wrapAllContent ?? true, properties: cols }
  if (typeof config?.pinnedColumnIndex === 'number') out.pinnedColumnIndex = config.pinnedColumnIndex
  return out
}

/** The columns shown, in order. */
export const visibleColumns = (cfg: TableViewConfig): TableColumn[] => cfg.properties.filter((c) => !c.isHidden)

const patchCol = (cfg: TableViewConfig, id: string, patch: Partial<TableColumn>): TableViewConfig => ({
  ...cfg,
  properties: cfg.properties.map((c) => (c.id === id ? { ...c, ...patch } : c)),
})

export const setColWidth = (cfg: TableViewConfig, id: string, rem: number): TableViewConfig =>
  patchCol(cfg, id, { colWidth: clampWidth(Math.round(rem * 100) / 100) })

/** Hide or show a column; the title stays. */
export const setHidden = (cfg: TableViewConfig, id: string, isHidden: boolean): TableViewConfig => {
  const c = cfg.properties.find((x) => x.id === id)
  if (!c || c.type === 'entity_title') return cfg
  return fixPin(cfg, patchCol(cfg, id, { isHidden }))
}

export const setAllHidden = (cfg: TableViewConfig, isHidden: boolean): TableViewConfig =>
  fixPin(cfg, { ...cfg, properties: cfg.properties.map((c) => (c.type === 'entity_title' ? c : { ...c, isHidden })) })

/** Whether a column wraps: all of them while `wrapAllContent`, else the column's own flag. */
export const isWrapped = (cfg: TableViewConfig, id: string): boolean =>
  cfg.wrapAllContent || !!cfg.properties.find((c) => c.id === id)?.wrapContent

/** Wrap or unwrap one column. Unwrapping one while "wrap all" is on turns it off and keeps the others wrapped. */
export function setWrap(cfg: TableViewConfig, id: string, wrap: boolean): TableViewConfig {
  if (!wrap && cfg.wrapAllContent) {
    return { ...cfg, wrapAllContent: false, properties: cfg.properties.map((c) => ({ ...c, wrapContent: c.id !== id })) }
  }
  return patchCol(cfg, id, { wrapContent: wrap })
}

/** "Wrap all" / "Wrap none". */
export const setWrapAll = (cfg: TableViewConfig, wrapAllContent: boolean): TableViewConfig => ({
  ...cfg,
  wrapAllContent,
  properties: wrapAllContent ? cfg.properties : cfg.properties.map((c) => ({ ...c, wrapContent: false })),
})

/** Columns up to and including `id` (among the visible ones) are pinned; `null` unpins. */
export function setPinnedThrough(cfg: TableViewConfig, id: string | null): TableViewConfig {
  const { pinnedColumnIndex: _drop, ...rest } = cfg
  void _drop
  if (id === null) return rest
  const at = visibleColumns(cfg).findIndex((c) => c.id === id)
  return at < 0 ? rest : { ...rest, pinnedColumnIndex: at }
}

/**
 * The pin after an edit: it is an index into the visible columns, so it follows the column it
 * ended at (hiding, showing or moving another column keeps that one the last pinned). When that
 * column is hidden the pin goes; when it is the one moved, the pinned count stays.
 */
function fixPin(before: TableViewConfig, after: TableViewConfig, moved?: string): TableViewConfig {
  if (typeof before.pinnedColumnIndex !== 'number') return after
  const through = visibleColumns(before)[before.pinnedColumnIndex]?.id
  const vis = visibleColumns(after)
  if (through === undefined) return setPinnedThrough(after, null)
  if (through === moved) return { ...after, pinnedColumnIndex: Math.min(before.pinnedColumnIndex, vis.length - 1) }
  return setPinnedThrough(after, vis.some((c) => c.id === through) ? through : null)
}

/** Move column `id` to where column `overId` is; the title column never moves and nothing goes before it. */
export function moveColumn(cfg: TableViewConfig, id: string, overId: string): TableViewConfig {
  const cols = [...cfg.properties]
  const from = cols.findIndex((c) => c.id === id)
  let to = cols.findIndex((c) => c.id === overId)
  if (from < 0 || to < 0 || from === to || cols[from].type === 'entity_title') return cfg
  if (to === 0) to = 1
  const [moved] = cols.splice(from, 1)
  cols.splice(to, 0, moved)
  return fixPin(cfg, { ...cfg, properties: cols }, id)
}

/** Rem offsets of each visible column's left edge, for sticky pinning. */
export function leftOffsets(cols: TableColumn[], widths: Record<string, number> = {}): number[] {
  const out: number[] = []
  let x = 0
  for (const c of cols) {
    out.push(x)
    x += widths[c.id] ?? c.colWidth
  }
  return out
}
