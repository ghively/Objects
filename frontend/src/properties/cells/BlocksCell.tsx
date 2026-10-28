import { StringEditor } from '@/editor/StringEditor'
import { placeholderFor } from '../format'
import type { CellExtras } from '../cellFor'
import type { CellProps } from './types'

/**
 * A content property (`blocks`, "Content"): the same block editor as the body (M9), over the
 * property's Markdown. Saves 600 ms after typing stops and on blur; an empty text saves `null`;
 * an unedited value is never rewritten. While it has focus, a new value from outside doesn't
 * replace what the user is typing.
 */
export function BlocksCell({ def, value, readOnly, density, inTable, onChange, path }: CellProps<string | null> & Pick<CellExtras, 'path'>) {
  return (
    <div className="blocks-cell min-h-[1.5em] text-[15px]">
      <StringEditor
        value={value ?? ''}
        path={path}
        readOnly={readOnly}
        ariaLabel={def.name}
        placeholder={placeholderFor(def, inTable ? 'table' : density)}
        onChange={(next) => onChange(next.trim() === '' ? null : next)}
      />
    </div>
  )
}
