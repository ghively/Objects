/**
 * The `…` menu's "Use template ▸": per template "Apply", "Edit", "Make default" and "Delete",
 * plus "New template". Rendered inside a `DropdownMenuSub`; the templates load when it opens.
 */
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { ObjectSummary, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { useLinkIndex } from '@/links/linkIndex'
import { orderTemplates, templateKey } from '@/types/TemplateManager'
import type { TypeEditor } from './useTypeEditor'

export const USE_TEMPLATE_TEXT = {
  menu: 'Use template',
  apply: 'Apply',
  edit: 'Edit',
  makeDefault: 'Make default',
  remove: 'Delete',
  create: 'New template',
  empty: 'No templates yet',
}

export function templateName(t: ObjectSummary): string {
  return t.template || t.title
}

/** Make `t` the type's default template. */
export function makeDefaultTemplate(editor: TypeEditor, typeId: string, key: string) {
  const cur = useLinkIndex.getState().types.find((x) => x.id === typeId)
  if (!cur) return Promise.resolve(null)
  return editor.save({ ...cur, templates: { ...cur.templates, defaultTemplateId: key } })
}

export interface UseTemplateMenuProps {
  type: TypeDef
  editor: TypeEditor
  onApply(templateId: string): void
  onEdit(path: string): void
  onCreated(path: string): void
}

export function UseTemplateMenu({ type, editor, onApply, onEdit, onCreated }: UseTemplateMenuProps) {
  const [templates, setTemplates] = useState<ObjectSummary[] | null>(null)

  useEffect(() => {
    let alive = true
    api
      .templates(type.id)
      .then((ts) => alive && setTemplates(ts ?? []))
      .catch(() => alive && setTemplates([]))
    return () => {
      alive = false
    }
  }, [type.id])

  const remove = async (t: ObjectSummary) => {
    const key = templateKey(t)
    const cur = useLinkIndex.getState().types.find((x) => x.id === type.id)
    if (cur && (cur.templates.ids.includes(key) || cur.templates.defaultTemplateId === key)) {
      const saved = await editor.save({
        ...cur,
        templates: {
          ids: cur.templates.ids.filter((id) => id !== key),
          defaultTemplateId: cur.templates.defaultTemplateId === key ? null : cur.templates.defaultTemplateId,
        },
      })
      if (!saved) return
    }
    await api.deleteObject(t.path).catch(() => undefined)
    setTemplates((ts) => ts?.filter((x) => x.path !== t.path) ?? ts)
  }

  const create = async () => {
    try {
      const res = await api.createTemplate(type.id)
      onCreated(res.path)
    } catch {
      /* the type refused templates */
    }
  }

  const ordered = templates ? orderTemplates(type, templates) : []
  const defaultId = type.templates?.defaultTemplateId ?? null

  return (
    <>
      {templates && ordered.length === 0 && (
        <DropdownMenuItem disabled>{USE_TEMPLATE_TEXT.empty}</DropdownMenuItem>
      )}
      {ordered.map((t) => {
        const key = templateKey(t)
        return (
          <DropdownMenuSub key={key}>
            <DropdownMenuSubTrigger>
              <Icon name={defaultId === key ? 'ph-star-fill' : 'ph-file-dashed'} size={14} />
              {templateName(t)}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="border-line bg-raised">
              <DropdownMenuItem onSelect={() => onApply(key)}>
                <Icon name="ph-check" size={14} />
                {USE_TEMPLATE_TEXT.apply}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onEdit(t.path)}>
                <Icon name="ph-pencil-simple" size={14} />
                {USE_TEMPLATE_TEXT.edit}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={defaultId === key}
                onSelect={() => void makeDefaultTemplate(editor, type.id, key)}
              >
                <Icon name="ph-star" size={14} />
                {USE_TEMPLATE_TEXT.makeDefault}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => void remove(t)}>
                <Icon name="ph-trash" size={14} />
                {USE_TEMPLATE_TEXT.remove}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )
      })}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => void create()}>
        <Icon name="ph-plus" size={14} />
        {USE_TEMPLATE_TEXT.create}
      </DropdownMenuItem>
    </>
  )
}
