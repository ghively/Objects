/**
 * M32, "New means a note": the one way a plain note is made (the sidebar's "New" button, Home's
 * "New note", the new-note key with no type in view). A Note is an object of the built-in Page
 * type (id `page`, else the type named Page); it opens where the modifier keys say
 * (`createAndOpen`), its title focused.
 */
import type { TypeDef } from '@/api/types'
import { showToast } from '@/editor/media/upload'
import { useLinkIndex } from '@/links/linkIndex'
import { createAndOpen, type OpenMods } from './createAndOpen'

/** Our string: the toast when a note could not be made and the server gave no reason. */
export const NEW_NOTE_FAILED = 'Could not create the note.'

/** The type a new note is made of: the built-in Page (id `page`, else the type named Page). */
export function noteTypeId(types: readonly TypeDef[]): string {
  return (types.find((t) => t.id === 'page') ?? types.find((t) => t.name.toLowerCase() === 'page'))?.id ?? 'page'
}

/** Make a note of `typeId` (default: a Note) and open it; a failure shows its message as a toast. */
export function newNote(mods: OpenMods = {}, typeId: string = noteTypeId(useLinkIndex.getState().types)): Promise<void> {
  return createAndOpen(typeId, {}, mods).then(
    () => undefined,
    (err: unknown) => showToast(err instanceof Error && err.message ? err.message : NEW_NOTE_FAILED),
  )
}
