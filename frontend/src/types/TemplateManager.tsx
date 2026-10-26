/**
 * A type's templates, in `templates.ids` order (discovered templates not in `ids` follow):
 * "Edit Template", "Mark as Default", "Delete Template", drag to reorder, "+ New Template".
 * Order and default are saved on the type through `useTypeEditor`.
 */
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import type { ObjectSummary, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { useLinkIndex } from '@/links/linkIndex'
import { ObjectIcon } from '@/object/ObjectHeader'
import { useTypeEditor, type TypeEditor } from '@/object/useTypeEditor'

export const TEMPLATE_TEXT = {
  explanation:
    "Templates allow you to prefill your properties and can create a structure for your content so you don't have to copy it every time.",
  empty: 'No templates yet',
  notAvailable: 'Templates are not available for this object type.',
  edit: 'Edit Template',
  markDefault: 'Mark as Default',
  isDefault: 'Default',
  remove: 'Delete Template',
  create: 'New Template',
}

const RELOAD_DELAY_MS = 150

/** Page, Task and custom types have templates; Tag, DailyNote (M4) and media types don't. */
export function templatesAllowed(type: Pick<TypeDef, 'basic' | 'name'>): boolean {
  return !type.basic || ['page', 'task'].includes(type.name.toLowerCase())
}

/** A template's id as `templates.ids` holds it (the path when the file has no `id`). */
export function templateKey(t: ObjectSummary): string {
  return t.id ?? t.path
}

/** Templates in the type's `ids` order, then the ones not in `ids` by name. */
export function orderTemplates(type: TypeDef, templates: ObjectSummary[]): ObjectSummary[] {
  const ids = type.templates?.ids ?? []
  const rank = (t: ObjectSummary) => {
    const i = ids.indexOf(templateKey(t))
    return i < 0 ? Number.MAX_SAFE_INTEGER : i
  }
  return [...templates].sort((a, b) => rank(a) - rank(b) || templateName(a).localeCompare(templateName(b)))
}

function templateName(t: ObjectSummary): string {
  return t.template || t.title
}

export interface TemplateManagerProps {
  typeId: string
  /** "Edit Template": open the template object. */
  onOpenTemplate?(path: string): void
  /** The editor to save through; without one the manager uses its own. */
  editor?: TypeEditor
  disabled?: boolean
}

export function TemplateManager({ typeId, onOpenTemplate, editor: given, disabled }: TemplateManagerProps) {
  const own = useTypeEditor(given ? null : typeId)
  const editor = given ?? own
  const type = useLinkIndex((s) => s.types.find((t) => t.id === typeId))
  const [templates, setTemplates] = useState<ObjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const allowed = !!type && templatesAllowed(type)

  const load = useCallback(() => {
    return api
      .templates(typeId)
      .then((ts) => {
        setTemplates(ts ?? [])
        setError(null)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [typeId])

  useEffect(() => {
    if (!allowed) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    void load()
    const off = api.onChange(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        if (alive) void load()
      }, RELOAD_DELAY_MS)
    })
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      off()
    }
  }, [allowed, load])

  const ordered = useMemo(() => (type && templates ? orderTemplates(type, templates) : []), [type, templates])

  const latest = () => useLinkIndex.getState().types.find((t) => t.id === typeId)

  const saveTemplates = (patch: Partial<TypeDef['templates']>) => {
    const t = latest()
    if (!t) return Promise.resolve(null)
    return editor.save({ ...t, templates: { ...t.templates, ...patch } })
  }

  const markDefault = (t: ObjectSummary) => void saveTemplates({ defaultTemplateId: templateKey(t) })

  const remove = async (t: ObjectSummary) => {
    const key = templateKey(t)
    const cur = latest()
    if (cur && (cur.templates.ids.includes(key) || cur.templates.defaultTemplateId === key)) {
      const saved = await saveTemplates({
        ids: cur.templates.ids.filter((id) => id !== key),
        defaultTemplateId: cur.templates.defaultTemplateId === key ? null : cur.templates.defaultTemplateId,
      })
      if (!saved) return
    }
    try {
      await api.deleteObject(t.path)
      setTemplates((ts) => ts?.filter((x) => x.path !== t.path) ?? ts)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const create = async () => {
    try {
      const res = await api.createTemplate(typeId)
      onOpenTemplate?.(res.path)
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const keys = ordered.map(templateKey)
    const from = keys.indexOf(String(active.id))
    const to = keys.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    void saveTemplates({ ids: arrayMove(keys, from, to) })
  }

  if (!type) return null
  if (!allowed) return <p className="text-[14px] text-fg-muted">{TEMPLATE_TEXT.notAvailable}</p>

  const defaultId = type.templates?.defaultTemplateId ?? null

  return (
    <div className="flex flex-col gap-1" data-template-manager={typeId}>
      {error && (
        <p role="alert" className="text-[13px] text-red-400">
          {error}
        </p>
      )}
      {templates && ordered.length === 0 && <p className="text-[14px] text-fg-muted italic">{TEMPLATE_TEXT.empty}</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ordered.map(templateKey)} strategy={verticalListSortingStrategy}>
          <ul aria-label="Templates" className="flex flex-col gap-0.5">
            {ordered.map((t) => (
              <TemplateRow
                key={templateKey(t)}
                template={t}
                isDefault={defaultId === templateKey(t)}
                disabled={!!disabled}
                onEdit={() => onOpenTemplate?.(t.path)}
                onMarkDefault={() => markDefault(t)}
                onDelete={() => void remove(t)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <button
        type="button"
        disabled={disabled}
        onClick={() => void create()}
        className="mt-1 flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-[14px] text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-50"
      >
        <Icon name="ph-plus" size={14} />
        {TEMPLATE_TEXT.create}
      </button>
      {!given && own.dialog}
    </div>
  )
}

function TemplateRow({
  template,
  isDefault,
  disabled,
  onEdit,
  onMarkDefault,
  onDelete,
}: {
  template: ObjectSummary
  isDefault: boolean
  disabled: boolean
  onEdit(): void
  onMarkDefault(): void
  onDelete(): void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: templateKey(template),
    disabled,
  })
  const name = templateName(template)
  return (
    <li
      ref={setNodeRef}
      aria-label={name}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition }}
      className={cn('group/tpl flex h-10 items-center gap-2 rounded-lg px-1.5 hover:bg-hover', isDragging && 'opacity-60')}
    >
      <span
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="flex h-6 w-4 shrink-0 cursor-grab items-center justify-center text-fg-muted opacity-0 group-hover/tpl:opacity-100"
      >
        <Icon name="ph-dots-six-vertical" size={13} />
      </span>
      {template.icon ? <ObjectIcon icon={template.icon} size={16} /> : <Icon name="ph-file-dashed" size={16} />}
      <span className="min-w-0 flex-1 truncate text-[15px]">{name}</span>
      {isDefault && (
        <span className="rounded border border-line px-1.5 text-[12px] text-fg-muted">{TEMPLATE_TEXT.isDefault}</span>
      )}
      <span className="flex shrink-0 items-center gap-0.5">
        <RowAction icon="ph-pencil-simple" label={TEMPLATE_TEXT.edit} onClick={onEdit} />
        {!isDefault && (
          <RowAction icon="ph-star" label={TEMPLATE_TEXT.markDefault} onClick={onMarkDefault} disabled={disabled} />
        )}
        <RowAction icon="ph-trash" label={TEMPLATE_TEXT.remove} onClick={onDelete} disabled={disabled} />
      </span>
    </li>
  )
}

function RowAction({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: string
  label: string
  onClick(): void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-hover-2 hover:text-fg disabled:opacity-40"
    >
      <Icon name={icon} size={14} />
    </button>
  )
}
