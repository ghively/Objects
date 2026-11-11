// M12: the new kinds' settings texts (all our strings), for the sections, their tests and the
// acceptance doc.

/** Our strings: the formula settings. */
export const FORMULA_TEXT = {
  heading: 'Formula',
  description: 'Calculate a value from this note’s properties.',
  editorLabel: 'Formula expression',
  placeholder: 'For example: prop("Price") * prop("Quantity")',
  save: 'Save formula',
  saveHint: 'Saved when you leave the editor, or with Ctrl+Enter.',
  properties: 'Properties',
  functions: 'Functions',
  searchFunctions: 'Search functions',
  noFunctions: 'No matching functions',
  preview: 'Preview',
  calculating: 'Calculating…',
  openObject: 'Open a note to preview its value',
  parsed: 'The formula is valid.',
  empty: 'Empty',
  numberFormat: 'Number format',
  numberFormatDescription: 'Used when the result is a number.',
}

/** Our strings: the rollup settings. */
export const ROLLUP_TEXT = {
  heading: 'Rollup',
  description: 'Show or calculate a property of the notes this property’s relation links to.',
  relation: 'Relation',
  chooseRelation: 'Choose a relation',
  noRelations: 'This type has no relation property yet. Add one to roll up the notes it links to.',
  property: 'Property',
  chooseProperty: 'Choose a property',
  calculate: 'Calculate',
  numberFormat: 'Number format',
}

/** Our strings: the ID settings. */
export const UNIQUE_ID_TEXT = {
  heading: 'ID',
  description: 'Each new note of this type gets the next number, after the prefix.',
  prefix: 'Prefix',
  prefixPlaceholder: 'For example: TASK-',
  prefixInvalid: 'Use at most 20 letters, digits, - or _.',
  nextId: 'Next ID',
  numberExisting: 'Number existing notes',
  numberExistingDescription: 'Give every note of this type that has no ID the next number, oldest first.',
  numbering: 'Numbering…',
  numbered: (n: number) => `Numbered ${n} ${n === 1 ? 'note' : 'notes'}`,
  skipped: (n: number) => `${n} ${n === 1 ? 'file' : 'files'} could not be changed`,
  conflict: 'The type was changed elsewhere. It has been reloaded; try again.',
}
