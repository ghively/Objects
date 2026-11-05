import type { ComputedValue } from '@/api/types'
import { ComputedValueView } from './ComputedValueView'
import type { CellProps } from './types'

/** M12 `rollup`: the related objects' value or calculation, computed by the server, read-only. */
export function RollupCell({ def, value, density, inTable }: CellProps<ComputedValue | null>) {
  return <ComputedValueView def={def} value={value} density={density} inTable={inTable} />
}
