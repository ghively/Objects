// Strings of the pinned sidebar (a leaf module, so menus can use them without import cycles).
export const PINNED_TEXT = {
  heading: 'Pinned',
  empty: 'No pinned content',
  unpinFromSpace: 'Unpin from space',
  unpinFrom: (section: string) => `Unpin from ${section}`,
  missing: 'Not found',
}
