// M14 `button` property: a button labelled with the property's name that runs the automation
// `def.options.ruleId` on the cell's object (`CellExtras.path`). The value is always null and is
// never written, so the cell never calls `onChange`. While it runs it shows a spinner; afterwards
// a short notice ("Done" or the run's failure). Disabled, with the reason as its tooltip, when no
// automation is chosen, the automation is missing or turned off. Our strings.
import { useState, type MouseEvent } from 'react'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { runButton } from '@/automations/runButton'
import { buttonBlocker, useAutomations } from '@/automations/useAutomations'
import type { CellExtras } from '../cellFor'
import type { CellProps } from './types'

export function ButtonCell({ def, readOnly, density, path }: CellProps<null> & CellExtras) {
  const { rules, loaded } = useAutomations()
  const [running, setRunning] = useState(false)
  const ruleId = (def.options?.ruleId as string | null | undefined) ?? null
  const blocker = buttonBlocker(ruleId, rules, loaded)
  const disabled = running || !!blocker || !path || !!readOnly

  const press = async (e: MouseEvent) => {
    // A table row or a card opens its object on a click: the button's click is its own.
    e.stopPropagation()
    e.preventDefault()
    if (disabled || !ruleId || !path) return
    setRunning(true)
    try {
      await runButton(ruleId, path)
    } finally {
      setRunning(false)
    }
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-busy={running || undefined}
      title={blocker ?? undefined}
      data-button-property={def.key}
      onClick={(e) => void press(e)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn(
        // A card draws its cells without pointer events; the button takes its own.
        'pointer-events-auto inline-flex max-w-full items-center gap-1.5 truncate rounded-md border border-line bg-raised px-2 text-fg hover:bg-hover disabled:text-fg-muted disabled:hover:bg-raised',
        density === 'table' ? 'h-6 text-[12px]' : 'h-7 text-[13px]',
      )}
    >
      {running ? <Icon name="ph-spinner-gap" size={13} className="animate-spin" /> : <Icon name="ph-cursor-click" size={13} />}
      <span className="truncate">{def.name}</span>
    </button>
  )
}
