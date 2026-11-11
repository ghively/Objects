// The one delete-button wording (catalog §6; M32, the glossary: "Delete 1 note" / "Delete 3 notes",
// it read "Delete 1 object" / "Delete 3 objects"), used by the note's delete dialog, the views'
// selection bar and the collection dialogs alike.
import { NOTE_LOWER, NOTES_LOWER } from './words'

/** "Delete {count} note" / "Delete {count} notes". */
export function deleteObjectsLabel(count: number): string {
  return `Delete ${count} ${count === 1 ? NOTE_LOWER : NOTES_LOWER}`
}
