// "Import into": a new space (the default; Name and Location) or this space, which is used only
// when the user picks it here (the contract's rule: an import never writes into an existing space
// unless it was chosen explicitly). M31: `newSpaceOnly` ("Remodel this space…") offers only a new space.
import { useId } from 'react'
import type { ImportTargetKind } from './mapping'
import { IMPORT_TEXT as T } from './text'

/** The longest name `space.json` accepts (the server's rule, as "Create new space"). */
export const MAX_SPACE_NAME = 120

const inputClass =
  'h-9 rounded-md border border-line bg-transparent px-2 text-[14px] font-normal outline-none focus:border-fg-muted'

export function TargetPicker({
  target,
  onTarget,
  name,
  onName,
  location,
  onLocation,
  spaceName,
  newSpaceOnly = false,
}: {
  target: ImportTargetKind
  onTarget(next: ImportTargetKind): void
  name: string
  onName(next: string): void
  location: string
  onLocation(next: string): void
  /** The open space's name, or null while it loads (then "This space" can't be picked yet). */
  spaceName: string | null
  /** M31: only "A new space" (remodelling the open space never writes into it). */
  newSpaceOnly?: boolean
}) {
  const id = useId()
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-[14px] font-semibold">{T.target}</legend>
      <label className="flex items-center gap-2 text-[14px]">
        <input
          type="radio"
          name={`${id}-target`}
          value="newSpace"
          checked={target === 'newSpace'}
          onChange={() => onTarget('newSpace')}
        />
        {T.newSpace}
      </label>
      {target === 'newSpace' && (
        <div className="ml-6 flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            {T.name}
            <input
              value={name}
              maxLength={MAX_SPACE_NAME}
              onChange={(e) => onName(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            {T.location}
            <input
              value={location}
              spellCheck={false}
              onChange={(e) => onLocation(e.target.value)}
              className={`${inputClass} font-mono text-[13px]`}
            />
          </label>
        </div>
      )}
      {!newSpaceOnly && (
        <label className="flex items-center gap-2 text-[14px]">
          <input
            type="radio"
            name={`${id}-target`}
            value="currentSpace"
            checked={target === 'currentSpace'}
            disabled={spaceName === null}
            aria-describedby={target === 'currentSpace' ? `${id}-here` : undefined}
            onChange={() => onTarget('currentSpace')}
          />
          {spaceName === null ? T.thisSpace : T.thisSpaceNamed(spaceName)}
        </label>
      )}
      {target === 'currentSpace' && !newSpaceOnly && (
        <p id={`${id}-here`} className="ml-6 text-[13px] text-fg-muted">
          {T.thisSpaceNote}
        </p>
      )}
    </fieldset>
  )
}
