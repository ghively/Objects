/**
 * The action palette: "All actions", filtered by cmdk as you type.
 */
import { Command as CommandPrimitive } from 'cmdk'
import { useMemo, useState } from 'react'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { typeOf } from '@/links/linkIndex'
import { TypeChip } from '@/shell/Sidebar'
import { buildActions, type Action, type ActionContext } from './actions'
import { PALETTE_TEXT } from './searchOptions'

export interface ActionsViewProps {
  context: ActionContext
  /** Close the palette (before an action runs). */
  onDone(): void
  footer?: React.ReactNode
}

export function ActionsView({ context, onDone, footer }: ActionsViewProps) {
  const [query, setQuery] = useState('')
  const actions = useMemo(() => buildActions(context), [context])

  const run = (a: Action) => {
    onDone()
    a.run()
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
