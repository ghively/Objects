// M14 `button` property: a button labelled with the property's name that runs the automation
// `def.options.ruleId` on the cell's object (`CellExtras.path`). The value is always null and is
// never written, so the cell never calls `onChange`.
//
// T1 placeholder: draws the button disabled. Lane U replaces the body (contract "Button property").
import type { CellProps } from './types'

export function ButtonCell({ def }: CellProps<null>) {
  return (
    <button
      type="button"
      disabled
      data-button-property={def.key}
      className="inline-flex h-7 max-w-full items-center gap-1.5 truncate rounded-md border border-line bg-raised px-2 text-[13px] text-fg-muted"
    >
      {def.name}
    </button>
  )
}
