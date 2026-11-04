// The Shortcuts sheet ("Shortcuts"): every registered shortcut, grouped by category, with its
// name and keys. An id with no key is left out: the sheet only shows rows with keys. Provisional
// keys (ours, with no table key to check against) carry a small "unverified" tag.
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { CATEGORY_LABELS, formatKeys, shortcutsByCategory, type ShortcutDef } from '@/lib/shortcuts'
import { useSettingsModal } from './useSettingsModal'

export const SHORTCUTS_TEXT = {
  heading: 'Shortcuts',
  unverified: 'unverified', // our string
  unverifiedHelp: 'Keys marked unverified are provisional.', // our string
} as const

function Keys({ def }: { def: ShortcutDef }) {
  return (
    <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
      {def.keys.map((k) => (
        <kbd
          key={k}
          data-keys={k}
          className="rounded border border-line bg-raised-2 px-1.5 py-0.5 font-sans text-[12px] text-fg"
        >
          {formatKeys(k)}
        </kbd>
      ))}
      {def.provisional && (
        <span data-unverified="" className="rounded bg-hover px-1.5 py-0.5 text-[11px] text-fg-muted">
          {SHORTCUTS_TEXT.unverified}
        </span>
      )}
    </span>
  )
}

export function ShortcutsSheet() {
  const open = useSettingsModal((s) => s.shortcutsOpen)
  const close = useSettingsModal((s) => s.closeShortcuts)
  const groups = open
    ? [...shortcutsByCategory()].map(([c, defs]) => [c, defs.filter((d) => d.keys.length > 0)] as const).filter(([, defs]) => defs.length > 0)
    : []
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 border-line bg-panel text-fg sm:max-w-[640px]">
        <DialogTitle className="text-[18px]">{SHORTCUTS_TEXT.heading}</DialogTitle>
        <DialogDescription className="text-[13px] text-fg-muted">{SHORTCUTS_TEXT.unverifiedHelp}</DialogDescription>
        <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
          {groups.map(([category, defs]) => {
            const label = CATEGORY_LABELS[category] ?? category
            return (
              <section key={category} aria-label={label} className="pb-4">
                <h3 className="pb-1 text-[13px] font-semibold text-fg-muted">{label}</h3>
                <ul className="flex flex-col">
                  {defs.map((d) => (
                    <li key={d.id} data-shortcut={d.id} className="flex items-start gap-3 border-b border-line py-1.5 text-[14px]">
                      <span className="min-w-0 flex-1">{d.name}</span>
                      <Keys def={d} />
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
