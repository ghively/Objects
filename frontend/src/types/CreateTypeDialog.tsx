/**
 * "Add a type" (polish item 21; M32: was "Add new object type"): a gallery with "Create your
 * own" first, then the type templates by group. A template shows its description and properties
 * and "Create type" (the server builds it, `POST /api/types {template}`); one the space
 * already has is "Added". "Create your own" is the form: name and plural (both required), an icon
 * and a random colour. The created type is put into the link index at once so its settings page
 * can show it before the next reload.
 *
 * M32 (item 12): the groups and their order are the gallery data's (`typetemplates.py`: Personal,
 * Use cases, Research, Media, Planning and reflection…); no entry is named here. The one fixed
 * rule is that "IT operations" comes last and starts collapsed, a disclosure the user opens; the
 * fold lasts while the dialog is open and nothing remembers it.
 *
 * "Starter sets" (M32, item 12) is the last group: the "Everyday set" (Person, Meeting, Project,
 * Book) and the "IT operations set", the two starting points the space dialog offered before it
 * stopped asking. One click adds the set (`POST /api/space/setup`: it writes only the types the
 * space lacks, and the IT set also turns the Work page on unless the switch was set), a toast says
 * what was added, and the gallery, the types and the space's info are read again. The dialog stays
 * open, so the new types show as "Added".
 */
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { api } from '@/api/client'
import type { Icon as IconValue, TypeDef, TypeTemplate } from '@/api/types'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { IconPicker } from '@/components/IconPicker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { showToast } from '@/editor/media/upload'
import { typeLabel } from '@/lib/typeLabel'
import { ADD_A_TYPE } from '@/lib/words'
import { invalidateLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { KIND_META, kindIcon } from '@/properties/kinds'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { CREATE_SPACE_TEXT, SETUPS } from '@/spaces/CreateSpaceDialog'
import { chipStyle, randomColor } from '@/theme/palette'

export const CREATE_TYPE_TEXT = {
  galleryTitle: ADD_A_TYPE,
  createYourOwn: 'Create your own',
  createYourOwnCard: 'Begin empty and add just the properties you want.',
  // M32: the back end's new first group (Idea, Goal, Habit, Recipe, Trip, Journal entry)
  personal: 'Personal',
  // our choice: the heading of the gallery's first group before M32
  useCases: 'Use cases',
  research: 'Research',
  media: 'Media',
  planningAndReflection: 'Planning and reflection',
  // M28: the IT ops types. M32: the last group, collapsed until opened.
  itOperations: 'IT operations',
  added: 'Added',
  templateHint: "You can change a type's settings whenever you like.",
  properties: 'Properties',
  back: 'Back', // our string
  title: 'Create your own type',
  description: 'A type groups similar content, such as books, projects or meeting notes.',
  name: 'Name',
  pluralName: 'Plural of name',
  tipHeading: 'Do I need a new type?',
  tip: 'Make one only for a separate kind of note with its own details; often a label property is enough.',
  hint: 'Once the type exists, change its properties in its settings.',
  action: 'Create type',
  // M32 (item 12): the last group. Our strings; the two descriptions are the space dialog's.
  starterSets: 'Starter sets',
  everydaySet: 'Everyday set',
  everydaySetDescription: CREATE_SPACE_TEXT.basicDescription,
  itopsSet: 'IT operations set',
  itopsSetDescription: CREATE_SPACE_TEXT.itopsDescription,
  /** The toast after a set was added: the types it wrote, by the names the screen shows. */
  starterAdded: (names: readonly string[]) => `Added: ${names.join(', ')}.`,
  starterNothing: 'This space already has every type in that set.',
  /** Added to the toast when the set turned the Work page on (the IT operations set). */
  starterWorkOn: 'The Work page is now on for this space.',
}

/** The two starter sets, in gallery order (the space dialog's `SETUPS` gives the icons). */
export const STARTER_SETS: { setup: 'basic' | 'itops'; icon: string; label: string; description: string }[] = [
  {
    setup: 'basic',
    icon: SETUPS.find((s) => s.value === 'basic')?.icon ?? 'ph-shapes',
    label: CREATE_TYPE_TEXT.everydaySet,
    description: CREATE_TYPE_TEXT.everydaySetDescription,
  },
  {
    setup: 'itops',
    icon: SETUPS.find((s) => s.value === 'itops')?.icon ?? 'ph-hard-drives',
    label: CREATE_TYPE_TEXT.itopsSet,
    description: CREATE_TYPE_TEXT.itopsSetDescription,
  },
]

/** The titles of the section keys the gallery data is known to use. */
const SECTION_TITLES: Record<string, string> = {
  personal: CREATE_TYPE_TEXT.personal,
  useCases: CREATE_TYPE_TEXT.useCases,
  research: CREATE_TYPE_TEXT.research,
  media: CREATE_TYPE_TEXT.media,
  planningAndReflection: CREATE_TYPE_TEXT.planningAndReflection,
  itOperations: CREATE_TYPE_TEXT.itOperations,
}

/**
 * A section's heading: its known title, else its key as words ("homeLife" → "Home life"), so a
 * section the back end adds later still shows under a name. The unsectioned row has none.
 */
export function sectionTitle(key: string | null): string | null {
  if (key === null || key === '') return null
  if (key in SECTION_TITLES) return SECTION_TITLES[key]
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export interface GallerySection {
  /** The data's section key (null: the unsectioned row). */
  key: string | null
  title: string | null
  /** Starts folded, behind a disclosure: only "IT operations". */
  collapsed: boolean
  items: TypeTemplate[]
}

/**
 * The gallery's groups: the data's sections in the order they first appear in it, each with its
 * templates in the data's order; the section titled "IT operations" is moved to the end and
 * starts collapsed.
 */
export function gallerySections(gallery: readonly TypeTemplate[]): GallerySection[] {
  const groups: GallerySection[] = []
  const byKey = new Map<string | null, GallerySection>()
  for (const t of gallery) {
    // The data's key, whatever it is (the API type lists only the keys known when it was written).
    const key: string | null = (t.section as string | null) || null
    let g = byKey.get(key)
    if (!g) {
      const title = sectionTitle(key)
      g = { key, title, collapsed: title === CREATE_TYPE_TEXT.itOperations, items: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    g.items.push(t)
  }
  return [...groups.filter((g) => !g.collapsed), ...groups.filter((g) => g.collapsed)]
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

function Card({ onClick, children, label, disabled }: { onClick(): void; children: ReactNode; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex items-start gap-2.5 rounded-lg border border-line p-2.5 text-left hover:bg-hover disabled:opacity-60"
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
  // The keys of the collapsed groups the user opened (IT operations). Never stored.
  const [opened, setOpened] = useState<readonly (string | null)[]>([])
  const foldId = useId()
  const sections = useMemo(() => gallerySections(gallery ?? []), [gallery])

  useEffect(() => {
    if (!open) return
    setStep({ kind: 'gallery' })
    setOpened([])
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

  /**
   * Add a starter set to the open space. The server writes only what the space lacks and answers
   * with the fresh space info: the toast names the types that are new, then everything that lists
   * types reads them again. The dialog stays on the gallery.
   */
  const addStarterSet = async (setup: 'basic' | 'itops') => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const before = new Set(useLinkIndex.getState().types.map((t) => t.id))
      const workBefore = useSpaceInfo.getState().space?.workOn ?? false
      const info = await api.spaceSetup(setup)
      const added = (info.types ?? []).filter((t) => !before.has(t.id)).map((t) => typeLabel(t))
      const said = added.length > 0 ? CREATE_TYPE_TEXT.starterAdded(added) : CREATE_TYPE_TEXT.starterNothing
      showToast(info.workOn && !workBefore ? `${said} ${CREATE_TYPE_TEXT.starterWorkOn}` : said)
      // The types, at once (the sidebar, the New menu); the set's own notes (templates, tags) follow.
      useLinkIndex.setState((s) => ({ types: info.types ?? s.types, revision: s.revision + 1 }))
      useSpaceInfo.setState({ space: info, loaded: true })
      void invalidateLinkIndex()
      // The gallery again, so the set's types read "Added".
      await api
        .typeGallery()
        .then(setGallery)
        .catch(() => undefined)
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
          {sections.map((g) => {
            const cards = (
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {g.items.map((t) => (
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
            )
            if (g.collapsed) {
              const isOpen = opened.includes(g.key)
              const panelId = `${foldId}-${g.key ?? 'more'}`
              return (
                <div key={g.key ?? 'more'} role="group" aria-label={g.title ?? undefined} data-gallery-fold={isOpen ? 'open' : 'closed'} className="flex flex-col gap-1.5">
                  <h3 className="text-[12px] font-semibold text-fg-muted">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={isOpen ? panelId : undefined}
                      onClick={() => setOpened((cur) => (cur.includes(g.key) ? cur.filter((k) => k !== g.key) : [...cur, g.key]))}
                      className="-mx-1 flex items-center gap-1 rounded px-1 py-0.5 hover:bg-hover hover:text-fg"
                    >
                      <Icon name={isOpen ? 'ph-caret-down' : 'ph-caret-right'} size={12} />
                      {g.title}
                    </button>
                  </h3>
                  {isOpen && <div id={panelId}>{cards}</div>}
                </div>
              )
            }
            return (
              <div key={g.key ?? 'more'} role="group" aria-label={g.title ?? undefined} className="flex flex-col gap-1.5">
                {g.title && <h3 className="text-[12px] font-semibold text-fg-muted">{g.title}</h3>}
                {cards}
              </div>
            )
          })}
          {/* M32: the starter sets, last. One click adds the set; the dialog stays open. */}
          <div role="group" aria-label={CREATE_TYPE_TEXT.starterSets} data-starter-sets="" className="flex flex-col gap-1.5">
            <h3 className="text-[12px] font-semibold text-fg-muted">{CREATE_TYPE_TEXT.starterSets}</h3>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {STARTER_SETS.map((s) => (
                <Card key={s.setup} disabled={busy} onClick={() => void addStarterSet(s.setup)}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line">
                    <Icon name={s.icon} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold">{s.label}</span>
                    <span className="line-clamp-2 block text-[12px] text-fg-muted">{s.description}</span>
                  </span>
                </Card>
              ))}
            </div>
            {errorEl}
          </div>
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
