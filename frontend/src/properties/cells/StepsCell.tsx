// M22 Task 1 stub: a `steps` value as plain text, never edited here. Task 11 fills it in
// (the panel's step list, the table's "Step n of N · current text").
import type { StepValue } from '@/api/types'
import type { CellProps } from './types'

export function StepsCell({ value }: CellProps<StepValue[] | null>) {
  const steps = Array.isArray(value) ? value : []
  if (steps.length === 0) return <p className="truncate py-0.5 text-[15px] text-fg-muted">—</p>
  return (
    <ol className="py-0.5 text-[15px] text-fg">
      {steps.map((s) => (
        <li key={s.id} className="truncate">
          {s.text}
        </li>
      ))}
    </ol>
  )
}
