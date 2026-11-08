// The one delete-button wording (catalog §6): "Delete 1 object" / "Delete 3 objects", used by the
// object's delete dialog, the views' selection bar and the collection dialogs alike.

/** "Delete {count} object" / "Delete {count} objects". */
export function deleteObjectsLabel(count: number): string {
  return `Delete ${count} ${count === 1 ? 'object' : 'objects'}`
}
