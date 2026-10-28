/**
 * The action palette: "All actions", filtered by cmdk as you type.
 *
 * M8: when the clipboard holds something, its offers (`CommandPalette.paste.*`, `paste.ts`) come
 * first; a denied read shows "Clipboard access was denied." (our string) and offers nothing.
 */
import { Command as CommandPrimitive } from 'cmdk'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { typeOf } from '@/links/linkIndex'
import { TypeChip } from '@/shell/Sidebar'
import { buildActions, type Action, type ActionContext } from './actions'
import { PASTE_TEXT, pasteActions, readClipboard, type ClipboardContent, type PasteAction } from './paste'
import { PALETTE_TEXT } from './searchOptions'

export interface ActionsViewProps {
  context: ActionContext
  /** Close the palette (before an action runs). */
  onDone(): void
  footer?: React.ReactNode
  /** Reads the clipboard when the view opens (tests replace it). */
  readClip?: () => Promise<ClipboardContent>
}

export function ActionsView({ context, onDone, footer, readClip = readClipboard }: ActionsViewProps) {
  const [query, setQuery] = useState('')
  const [clip, setClip] = useState<ClipboardContent>({ kind: 'empty' })
  const actions = useMemo(() => buildActions(context), [context])
  const pastes = useMemo(() => pasteActions(clip, context.types), [clip, context.types])

  const readRef = useRef(readClip)
  useEffect(() => {
    let live = true
    readRef.current().then(
      (c) => live && setClip(c),
      () => live && setClip({ kind: 'denied' }),
    )
    return () => {
      live = false
    }
  }, [])

  const run = (a: Action) => {
    onDone()
    a.run()
  }

  const runPaste = (a: PasteAction) => {
    onDone()
    a.run().catch((err: unknown) => console.warn('Could not use the clipboard content:', err))
  }

  return (
    <Command loop className="rounded-xl bg-transparent text-fg">
      <div className="flex min-h-12 items-center gap-2 border-b border-line px-3">
        <Icon name="ph-magnifying-glass" size={16} className="shrink-0 text-fg-muted" />
        <CommandPrimitive.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder={PALETTE_TEXT.placeholderActions}
          aria-label={PALETTE_TEXT.placeholderActions}
          className="h-9 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-muted"
        />
      </div>
      <CommandList className="command-palette-list max-h-[420px] p-1.5">
        <CommandEmpty className="px-3 py-6 text-center text-[15px]">{PALETTE_TEXT.emptyTitle(query.trim())}</CommandEmpty>
        {clip.kind === 'denied' && !query.trim() ? (
          <div data-clipboard-denied="" className="px-3 py-1.5 text-[13px] text-fg-muted">
            {PASTE_TEXT.denied}
          </div>
        ) : null}
        {pastes.length > 0 ? (
          <CommandGroup data-paste-group="">
            {pastes.map((a) => (
              <CommandItem
                key={a.id}
                value={a.id}
                keywords={[a.label]}
                data-action={a.id}
                onSelect={() => runPaste(a)}
                className="menu-row gap-2 rounded-lg text-[15px]"
              >
                <span className="inline-flex size-5 items-center justify-center text-fg-muted">
                  <Icon name={a.icon} size={16} />
                </span>
                <span className="min-w-0 flex-1 truncate">{a.label}</span>
                {a.preview ? <span className="shrink-0 text-[13px] text-fg-muted">{a.preview}</span> : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        <CommandGroup heading={PALETTE_TEXT.allActions}>
          {actions.map((a) => {
            const t = a.typeId ? typeOf(a.typeId) : undefined
            return (
              <CommandItem
                key={a.id}
                value={a.id}
                keywords={[a.label]}
                data-action={a.id}
                onSelect={() => run(a)}
                className="menu-row gap-2 rounded-lg text-[15px]"
              >
                {t ? (
                  <TypeChip type={t} size={20} />
                ) : (
                  <span className="inline-flex size-5 items-center justify-center text-fg-muted">
                    <IconOrEmoji icon={a.icon} fallback="ph-lightning" size={16} />
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{a.label}</span>
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>
      {footer}
    </Command>
  )
}
