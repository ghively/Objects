/**
 * "Add new object type" (polish item 21): a gallery with "Create your
 * own" first, then the type templates by group. A template shows its description and properties
 * and "Create object type" (the server builds it, `POST /api/types {template}`); one the space
 * already has is "Added". "Create your own" is the form: name and plural (both required), an icon
 * and a random colour. The created type is put into the link index at once so its settings page
 * can show it before the next reload.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api } from '@/api/client'
import type { Icon as IconValue, TypeDef, TypeTemplate } from '@/api/types'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { IconPicker } from '@/components/IconPicker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useLinkIndex } from '@/links/linkIndex'
import { KIND_META, kindIcon } from '@/properties/kinds'
import { chipStyle, randomColor } from '@/theme/palette'

export const CREATE_TYPE_TEXT = {
  galleryTitle: 'Add new object type',
  createYourOwn: 'Create your own',
  createYourOwnCard: 'Start from a blank type and add the properties you need.',
  // our choice: the heading of the gallery's first group
  useCases: 'Use cases',
  research: 'Research',
  media: 'Media',
  planningAndReflection: 'Planning and reflection',
  added: 'Added',
  templateHint: 'Object types can be customized at any time in the object type settings.',
  properties: 'Properties',
  back: 'Back', // our string
  title: 'Create your object type',
  description: 'Object types are categories for your content, like books, projects, or meeting notes.',
  name: 'Name',
  pluralName: 'Plural of name',
  tipHeading: 'Do I need a new type?',
  tip: 'Only if you have a distinct kind of note with its own details. A label property could be enough.',
  hint: 'You can customize properties after creating the object type in the object type settings.',
  action: 'Create object type',
}

const SECTIONS: readonly (TypeTemplate['section'])[] = ['useCases', 'research', 'media', 'planningAndReflection', null]

function sectionTitle(s: TypeTemplate['section']): string | null {
  return s ? CREATE_TYPE_TEXT[s] : null
}

export interface CreateTypeDialogProps {
  open: boolean
  onOpenChange?(open: boolean): void
  /** The new type (the caller opens its settings). */
  onCreated?(type: TypeDef): void
}

const DEFAULT_ICON: IconValue = { type: 'iconify', val: 'ph-cube' }

type Step = { kind: 'gallery' } | { kind: 'own' } | { kind: 'template'; template: TypeTemplate }

function TemplateIcon({ t, size = 18 }: { t: TypeTemplate; size?: number }) {
  return (
    <span
      className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--chip-bg)] text-[var(--chip-fg)]"
      style={chipStyle(t.color)}
    >
      <IconOrEmoji icon={t.icon} fallback="ph-cube" size={size} />
    </span>
  )
}

function Card({ onClick, children, label }: { onClick(): void; children: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex items-start gap-2.5 rounded-lg border border-line p-2.5 text-left hover:bg-hover"
    >
      {children}
    </button>
  )
}

export function CreateTypeDialog({ open, onOpenChange, onCreated }: CreateTypeDialogProps) {
  const [step, setStep] = useState<Step>({ kind: 'gallery' })
  const [gallery, setGallery] = useState<TypeTemplate[] | null>(null)
  const [name, setName] = useState('')
  const [pluralName, setPluralName] = useState('')
  const [icon, setIcon] = useState<IconValue>(DEFAULT_ICON)
  const [iconOpen, setIconOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setStep({ kind: 'gallery' })
    setName('')
    setPluralName('')
    setIcon(DEFAULT_ICON)
    setError(null)
    let alive = true
    api
      .typeGallery()
      .then((g) => alive && setGallery(g))
      .catch(() => alive && setGallery([]))
    return () => {
      alive = false
    }
  }, [open])

  const ready = name.trim() !== '' && pluralName.trim() !== '' && !busy

  const create = async (input: Parameters<typeof api.createType>[0]) => {
    setBusy(true)
    setError(null)
    try {
      const type = await api.createType(input)
      useLinkIndex.setState((s) => ({
        types: s.types.some((t) => t.id === type.id) ? s.types : [...s.types, type],
        revision: s.revision + 1,
      }))
      onOpenChange?.(false)
      onCreated?.(type)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!ready) return
    await create({ name: name.trim(), pluralName: pluralName.trim(), icon, color: randomColor() })
  }

  const errorEl = error && (
    <p role="alert" className="text-[13px] text-red-400">
      {error}
    </p>
  )
  const backButton = (
    <button
      type="button"
      onClick={() => {
        setError(null)
        setStep({ kind: 'gallery' })
      }}
      className="flex w-fit items-center gap-1 rounded px-1 text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
    >
      <Icon name="ph-caret-left" size={13} />
      {CREATE_TYPE_TEXT.back}
    </button>
  )

  let body: ReactNode
  if (step.kind === 'gallery') {
    body = (
      <>
        <DialogHeader>
          <DialogTitle className="text-[18px]">{CREATE_TYPE_TEXT.galleryTitle}</DialogTitle>
          <DialogDescription className="text-[14px] text-fg-muted">{CREATE_TYPE_TEXT.description}</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
          <Card onClick={() => setStep({ kind: 'own' })}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line">
              <Icon name="ph-plus" size={16} />
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold">{CREATE_TYPE_TEXT.createYourOwn}</span>
              <span className="block text-[13px] text-fg-muted">{CREATE_TYPE_TEXT.createYourOwnCard}</span>
            </span>
          </Card>
          {SECTIONS.map((s) => {
            const items = (gallery ?? []).filter((t) => t.section === s)
            if (items.length === 0) return null
            const title = sectionTitle(s)
            return (
              <div key={s ?? 'more'} role="group" aria-label={title ?? undefined} className="flex flex-col gap-1.5">
                {title && <h3 className="text-[12px] font-semibold text-fg-muted">{title}</h3>}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {items.map((t) => (
                    <Card key={t.key} onClick={() => setStep({ kind: 'template', template: t })}>
                      <TemplateIcon t={t} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-[14px] font-semibold">
                          {t.pluralName}
                          {t.added && (
                            <span className="rounded bg-hover px-1 text-[11px] font-medium text-fg-muted">
                              {CREATE_TYPE_TEXT.added}
                            </span>
                          )}
                        </span>
                        <span className="line-clamp-2 block text-[12px] text-fg-muted">{t.description}</span>
                      </span>
                    </Card>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </>
    )
  } else if (step.kind === 'template') {
    const t = step.template
    body = (
      <div className="flex flex-col gap-3">
        {backButton}
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <TemplateIcon t={t} size={20} />
            <DialogTitle className="text-[18px]">{t.name}</DialogTitle>
          </div>
          <DialogDescription className="text-[14px] text-fg-muted">{t.description}</DialogDescription>
        </DialogHeader>
        <div>
          <h3 className="mb-1 text-[12px] font-semibold text-fg-muted">{CREATE_TYPE_TEXT.properties}</h3>
          <ul aria-label={CREATE_TYPE_TEXT.properties} className="flex flex-col">
            {t.properties.map((p) => (
              <li key={p.name} className="flex h-8 items-center gap-2 text-[14px]">
                <span className="text-fg-muted">
                  <Icon name={kindIcon(p.type)} size={15} />
                </span>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="text-[12px] text-fg-muted">{KIND_META[p.type]?.name ?? p.type}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[13px] text-fg-muted">{CREATE_TYPE_TEXT.templateHint}</p>
        {errorEl}
        <div className="flex justify-end">
          <Button disabled={t.added || busy} onClick={() => void create({ name: '', pluralName: '', template: t.key })}>
            {t.added ? CREATE_TYPE_TEXT.added : CREATE_TYPE_TEXT.action}
          </Button>
        </div>
      </div>
    )
  } else {
    body = (
      <>
        {backButton}
        <DialogHeader>
          <DialogTitle className="text-[18px]">{CREATE_TYPE_TEXT.title}</DialogTitle>
          <DialogDescription className="text-[14px] text-fg-muted">{CREATE_TYPE_TEXT.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <div className="flex items-end gap-2">
            <Popover open={iconOpen} onOpenChange={setIconOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Type icon"
                  className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line hover:bg-hover"
                >
                  <IconOrEmoji icon={icon} fallback="ph-cube" size={18} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto border-line bg-raised p-2 text-fg">
                <IconPicker
                  value={icon}
                  onChange={(next) => {
                    setIcon(next ?? DEFAULT_ICON)
                    setIconOpen(false)
                  }}
                />
              </PopoverContent>
            </Popover>
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-[13px] font-semibold">
              {CREATE_TYPE_TEXT.name}
              <input
                autoFocus
                value={name}
                placeholder={CREATE_TYPE_TEXT.name}
                onChange={(e) => setName(e.target.value)}
                className="h-9 rounded-md border border-line bg-transparent px-2 text-[15px] font-normal outline-none focus:border-fg-muted"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            {CREATE_TYPE_TEXT.pluralName}
            <input
              value={pluralName}
              placeholder={CREATE_TYPE_TEXT.pluralName}
              onChange={(e) => setPluralName(e.target.value)}
              className="h-9 rounded-md border border-line bg-transparent px-2 text-[15px] font-normal outline-none focus:border-fg-muted"
            />
          </label>
          <aside aria-label={CREATE_TYPE_TEXT.tipHeading} className="flex gap-2 rounded-lg bg-hover/60 p-3 text-[13px]">
            <Icon name="ph-lightbulb" size={16} />
            <div>
              <p className="font-semibold">{CREATE_TYPE_TEXT.tipHeading}</p>
              <p className="mt-0.5 text-fg-muted">{CREATE_TYPE_TEXT.tip}</p>
            </div>
          </aside>
          <p className="text-[13px] text-fg-muted">{CREATE_TYPE_TEXT.hint}</p>
          {errorEl}
          <div className="flex justify-end">
            <Button type="submit" disabled={!ready}>
              {CREATE_TYPE_TEXT.action}
            </Button>
          </div>
        </form>
      </>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => onOpenChange?.(o)}>
      <DialogContent className="border-line bg-raised-2 text-fg sm:max-w-[560px]">{body}</DialogContent>
    </Dialog>
  )
}
