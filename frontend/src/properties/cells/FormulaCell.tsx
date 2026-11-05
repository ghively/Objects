import type { ComputedValue } from '@/api/types'
import { ComputedValueView } from './ComputedValueView'
import type { CellProps } from './types'

/** M12 `formula`: the value the server computed, read-only (never in frontmatter, never written). */
export function FormulaCell({ def, value, density, inTable }: CellProps<ComputedValue | null>) {
  return <ComputedValueView def={def} value={value} density={density} inTable={inTable} />
}
