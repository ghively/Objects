// The Overview tab: the type's dashboard sections (collapsible, reorderable through "Customize
// Overview") and, while no query section exists, "Query Recommendations".
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { api } from '@/api/client'
import type { TypeDef } from '@/api/types'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useState } from 'react'
import {
  SECTION_TEXT,
  addableSections,
  hiddenSections,
  isQueryKey,
  moveSection,
  patchSection,
  appendSection,
  removeSection,
  showSection,
  visibleSections,
  type RenderedSection,
  type SectionCtx,
} from './dashboardSections'
import { queryRecommendations } from './queryRecommendations'
import { SectionView } from './SectionView'
import type { ViewsEdit } from './useTypeViews'

function SortableEntry({ section, onHide }: { section: RenderedSection; onHide(): void }) {
  const s = useSortable({ id: section.key })
  return (
    <div
      ref={s.setNodeRef}
      {...s.attributes}
      {...s.listeners}
      data-testid="visible-section"
      style={{ transform: s.transform ? `translate3d(0, ${Math.round(s.transform.y)}px, 0)` : undefined, transition: s.transition }}
      className="flex h-8 items-center gap-2 rounded-md px-2 text-[14px] hover:bg-hover"
    >
      <Icon name="ph-dots-six-vertical" size={13} />
      <span className="min-w-0 flex-1 truncate">{`${section.label}${section.inFullView ? '' : SECTION_TEXT.dashboardOnly}`}</span>
      <button
        type="button"
        aria-label={`Hide ${section.label}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onHide}
        className="text-fg-muted hover:text-fg"
      >
        <Icon name="ph-eye-slash" size={14} />
      </button>
    </div>
  )
}

/** "Customize Overview": visible sections (drag to reorder, hide), hidden sections, "Add a section". */
export function CustomizeOverview({
  type,
  sections,
  ctx,
  update,
  addable: addableOverride,
}: {
  type?: TypeDef
  sections: RenderedSection[]
  ctx: SectionCtx
  update(edit: ViewsEdit): void
  /** What "Add a section" offers, when it is not the type's collections and queries (a collection's page). */
  addable?: RenderedSection[]
}) {
  const [adding, setAdding] = useState(false)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const visible = visibleSections(sections)
  const hidden = hiddenSections(sections)
  const addable = addableOverride ?? (type ? addableSections(type, sections, ctx) : [])
  const queryItems = addable.filter((s) => isQueryKey(s.key))
  const otherItems = addable.filter((s) => !isQueryKey(s.key))

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    update((v) => moveSection(v, sections, String(e.active.id), String(e.over?.id)))
  }
  const heading = 'px-2 pt-2 pb-1 text-[12px] text-fg-muted'
  const item = 'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover'

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
        >
          <Icon name="ph-sliders-horizontal" size={14} />
          {SECTION_TEXT.customize}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 border-line bg-raised p-1.5 text-fg">
        <div className={heading}>{SECTION_TEXT.visibleSections}</div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visible.map((s) => s.key)} strategy={verticalListSortingStrategy}>
            {visible.map((s) => (
              <SortableEntry key={s.key} section={s} onHide={() => update((v) => removeSection(v, sections, s.key))} />
            ))}
          </SortableContext>
        </DndContext>
        {hidden.length > 0 && <div className={heading}>{SECTION_TEXT.hiddenSections}</div>}
        {hidden.map((s) => (
          <div key={s.key} data-testid="hidden-section" className="flex h-8 items-center gap-2 rounded-md px-2 text-[14px] hover:bg-hover">
            <span className="min-w-0 flex-1 truncate">{`${s.label}${s.inFullView ? '' : SECTION_TEXT.dashboardOnly}`}</span>
            <button
              type="button"
              aria-label={`Show ${s.label}`}
              onClick={() => update((v) => showSection(v, sections, s))}
              className="text-fg-muted hover:text-fg"
            >
              <Icon name="ph-eye" size={14} />
            </button>
          </div>
        ))}
        <button type="button" aria-expanded={adding} onClick={() => setAdding((v) => !v)} className={`${item} mt-1 border-t border-line`}>
          <Icon name="ph-plus" size={14} />
          {SECTION_TEXT.addSection}
        </button>
        {adding && (
          <div>
            {addable.length === 0 && <p className="px-2 py-1 text-[13px] text-fg-muted">{SECTION_TEXT.sectionEmpty}</p>}
            {otherItems.map((s) => (
              <button key={s.key} type="button" aria-label={`Add ${s.label}`} onClick={() => update((v) => showSection(v, sections, s))} className={item}>
                <IconOrEmoji icon={s.ownIcon} fallback={s.icon} size={14} />
                <span className="truncate">{`${s.label}${s.inFullView ? '' : SECTION_TEXT.dashboardOnly}`}</span>
              </button>
            ))}
            {queryItems.length > 0 && <div className={heading}>{SECTION_TEXT.queriesAndViews}</div>}
            {queryItems.map((s) => (
              <button key={s.key} type="button" aria-label={`Add ${s.label}`} onClick={() => update((v) => showSection(v, sections, s))} className={item}>
                <IconOrEmoji icon={s.ownIcon} fallback={s.icon} size={14} />
                <span className="truncate">{s.label}</span>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function SectionHeading({
  section,
  type,
  sections,
  update,
}: {
  section: RenderedSection
  type: TypeDef
  sections: RenderedSection[]
  update(edit: ViewsEdit): void
}) {
  const openAll = () => {
    if (section.inFullView) update((v) => ({ ...v, activeTab: section.key }))
    else update((v) => ({ ...v, activeTab: 'all' }))
  }
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        aria-expanded={!section.collapsed}
        aria-label={`${section.collapsed ? 'Expand' : 'Collapse'} ${section.label}`}
        onClick={() => update((v) => patchSection(v, sections, section.key, { collapsed: !section.collapsed }))}
        className="flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1 text-[16px] font-semibold hover:bg-hover"
      >
        <Icon name={section.collapsed ? 'ph-caret-right' : 'ph-caret-down'} size={13} />
        <IconOrEmoji icon={section.ownIcon} fallback={section.icon} size={16} />
        <span className="truncate">{section.label}</span>
      </button>
      <button
        type="button"
        onClick={openAll}
        className="rounded-md px-1.5 py-0.5 text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
      >
        {section.inFullView ? SECTION_TEXT.openAll : `View all ${type.pluralName}`}
      </button>
    </div>
  )
}

export function TypeOverview({
  type,
  sections,
  ctx,
  search,
  update,
  onCreateCollection,
}: {
  type: TypeDef
  sections: RenderedSection[]
  ctx: SectionCtx
  search: string
  update(edit: ViewsEdit): void
  onCreateCollection?(): void
}) {
  const visible = visibleSections(sections)
  const hasQuerySection = visible.some((s) => isQueryKey(s.key))
  const recommendations = hasQuerySection ? [] : queryRecommendations(type)

  const pick = async (r: ReturnType<typeof queryRecommendations>[number]) => {
    const q = await api.createQuery({ name: r.title, definition: r.definition, view: { viewDefinition: { dataViewLayout: r.layout } } })
    const key = `query:${q.id}` as const
    update((v) => appendSection(v, sections, key))
  }

  return (
    <div className="flex flex-col gap-8 pt-2">
      <div className="flex justify-end">
        <CustomizeOverview type={type} sections={sections} ctx={ctx} update={update} />
      </div>
      {visible.length === 0 && <p className="py-4 text-center text-[14px] text-fg-muted">{SECTION_TEXT.sectionEmpty}</p>}
      {visible.map((s) => {
        const heading = <SectionHeading section={s} type={type} sections={sections} update={update} />
        return (
          <section key={s.key} aria-label={s.label} data-testid="overview-section" data-section={s.key}>
            {s.collapsed ? (
              heading
            ) : (
              <SectionView
                type={type}
                section={s}
                search={search}
                heading={heading}
                onCreateCollection={onCreateCollection}
                onViewDefinition={(def) => update((v) => patchSection(v, sections, s.key, { viewDefinition: def }))}
              />
            )}
          </section>
        )
      })}
      {recommendations.length > 0 && (
        <section aria-label="Query Recommendations" data-testid="query-recommendations">
          <h2 className="mb-2 text-[16px] font-semibold">Query Recommendations</h2>
          <div className="flex flex-col">
            {recommendations.map((r) => (
              <button
                key={r.title}
                type="button"
                onClick={() => void pick(r).catch((e: unknown) => console.warn('Could not create the query:', e))}
                className="flex h-9 items-center gap-2 rounded-md px-2 text-left text-[14px] hover:bg-hover"
              >
                <Icon name={r.layout === 'kanban' ? 'ph-kanban' : 'ph-funnel-simple'} size={15} />
                {r.title}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
