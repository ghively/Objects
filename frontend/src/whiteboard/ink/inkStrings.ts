/**
 * Ink UI strings. Freehand ink is Gene's addition with no Capacities original, so every string
 * here is "our string".
 */
export const INK_STRINGS = {
  /** our string */
  pen: 'Pen',
  /** our string */
  highlighter: 'Highlighter',
  /** our string */
  eraser: 'Eraser',
  /** our string (M8): the ink selection tool */
  selectInk: 'Select ink',
  /** our string (M8): the eraser's mode group */
  eraseMode: 'Eraser mode',
  /** our string (M8): the eraser removes whole strokes (M6's behaviour, the default) */
  eraseStrokes: 'Erase whole strokes',
  /** our string (M8): the eraser cuts strokes where it passes */
  erasePartially: 'Erase partially',
  /** our string */
  width: 'Width',
  /** our string */
  inkColour: 'Ink colour',
  /** our string: a failed ink save (the server's reason follows) */
  saveFailed: 'Could not save the ink.',
  /** our string: the pen group's tooltip when the ink file is read-only */
  readOnly: "This ink file has content Object didn't write, so it opens read-only.",
} as const
