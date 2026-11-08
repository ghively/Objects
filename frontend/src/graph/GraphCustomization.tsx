// The graph's "Customize" popover: the graph filters and their labels. Shared by the global graph and the local graph panel.
import type { GraphCustomization as Custom, TypeDef } from '@/api/types'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { LARGE_NODE_LIMIT } from './filterGraph'

export const CUSTOMIZATION_TEXT = {
  customize: 'Customize',
  filterObjectTypes: 'Filter object types',
  excludeObjectTypes: 'Exclude object types',
  deselectAll: 'Deselect all',
  showCompletedTasks: 'Show completed tasks',
  alwaysMinimalNodes: 'Show simplified graph',
  hideLargeNodes: 'Hide heavily linked objects',
  hideLargeNodesTooltip: (limit: number) => `Nodes with more than ${limit} links are hidden`,
  hideDates: 'Hide dates',
  hideIndirectLinks: 'Hide indirect links',
  hideIndirectLinksTooltip: 'A link that runs only through hidden objects is hidden too.',
  showTagsNetwork: 'Show tags network',
}

type SwitchKey = 'showCompletedTasks' | 'showMinimalNodes' | 'hideLargeNodes' | 'hideDates' | 'hideIndirectLinks'

export interface GraphCustomizationProps {
  custom: Custom
  onPatch(partial: Partial<Custom>): void
  types: TypeDef[]
  /** `showSpaceTagsNetwork` on the global graph; `showTagsNetwork` on a Tag's local graph. Omit to hide the switch. */
  tagsNetworkKey?: 'showSpaceTagsNetwork' | 'showTagsNetwork'
}

function TypeList({
  label,
  selected,
  types,
  onChange,
}: {
  label: string
  selected: string[]
  types: TypeDef[]
  onChange(next: string[]): void
}) {
  return (
    <section className="flex flex-col gap-1" aria-label={label}>
      <div className="flex items-center justify-between px-1">
        <h3 className="text-[12px] font-medium text-fg-muted">{label}</h3>
        <button
          type="button"
          disabled={selected.length === 0}
          onClick={() => onChange([])}
          className="text-[12px] text-fg-muted hover:text-fg disabled:opacity-40"
        >
          {CUSTOMIZATION_TEXT.deselectAll}
        </button>
      </div>
      <ul className="flex max-h-36 flex-col overflow-y-auto">
        {types.map((t) => {
          const on = selected.includes(t.id)
          return (
            <li key={t.id}>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => onChange(on ? selected.filter((x) => x !== t.id) : [...selected, t.id])}
                className="flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-left text-[13px] hover:bg-hover"
              >
                <span
                  className={cn(
                    'flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border border-line',
                    on && 'border-transparent bg-primary-btn text-app',
                  )}
                >
                  {on && <Icon name="ph-check-bold" size={10} />}
                </span>
                <IconOrEmoji icon={t.icon} size={14} fallback="ph-cube" />
                <span className="truncate">{t.pluralName || t.name}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function SwitchRow({ label, tooltip, checked, onChange }: { label: string; tooltip?: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="flex h-8 cursor-pointer items-center justify-between gap-3 rounded-md px-1.5 text-[13px] hover:bg-hover" title={tooltip}>
      <span className="flex items-center gap-1.5">
        {label}
        {tooltip && (
          <span className="text-fg-muted" aria-hidden>
            <Icon name="ph-info" size={12} />
          </span>
        )}
      </span>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} size="sm" />
    </label>
  )
}

export function GraphCustomization({ custom, onPatch, types, tagsNetworkKey }: GraphCustomizationProps) {
  const t = CUSTOMIZATION_TEXT
  const switches: { key: SwitchKey; label: string; tooltip?: string }[] = [
    { key: 'showCompletedTasks', label: t.showCompletedTasks },
    { key: 'showMinimalNodes', label: t.alwaysMinimalNodes },
    { key: 'hideLargeNodes', label: t.hideLargeNodes, tooltip: t.hideLargeNodesTooltip(LARGE_NODE_LIMIT) },
    { key: 'hideDates', label: t.hideDates },
    { key: 'hideIndirectLinks', label: t.hideIndirectLinks, tooltip: t.hideIndirectLinksTooltip },
  ]
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 text-[14px] hover:bg-hover"
        >
          <Icon name="ph-sliders-horizontal" size={14} />
          {t.customize}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-3 p-2" aria-label={t.customize}>
        <TypeList
          label={t.filterObjectTypes}
          selected={custom.filterTypeIds ?? []}
          types={types}
          onChange={(next) => onPatch({ filterTypeIds: next })}
        />
        <TypeList
          label={t.excludeObjectTypes}
          selected={custom.excludeTypeIds ?? []}
          types={types}
          onChange={(next) => onPatch({ excludeTypeIds: next })}
        />
        <div className="flex flex-col border-t border-line pt-2">
          {switches.map((s) => (
            <SwitchRow key={s.key} label={s.label} tooltip={s.tooltip} checked={!!custom[s.key]} onChange={(v) => onPatch({ [s.key]: v })} />
          ))}
          {tagsNetworkKey && (
            <SwitchRow
              label={t.showTagsNetwork}
              checked={!!custom[tagsNetworkKey]}
              onChange={(v) => onPatch({ [tagsNetworkKey]: v })}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
