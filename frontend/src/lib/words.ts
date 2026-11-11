// M32 (notes first): the everyday nouns more than one part of the app shows, spelled once (the
// plan's glossary). Display only: files, front matter, API routes and MCP tool names keep their
// words (`type: Page`, `/api/queries`). A type's own name goes through `lib/typeLabel.ts`.

/** A thing you wrote; also what the built-in Page type is called on screen. */
export const NOTE = 'Note'
export const NOTES = 'Notes'
/** The same nouns inside a sentence ("Delete this note?", "Recently opened notes appear here."). */
export const NOTE_LOWER = 'note'
export const NOTES_LOWER = 'notes'

/** What the built-in DailyNote type is called on screen. */
export const DAILY_NOTE = 'Daily note'
export const DAILY_NOTES = 'Daily notes'

/** Was "Object Types" (the sidebar section, Settings). */
export const TYPES = 'Types'
/** Was "Create object type". */
export const NEW_TYPE = 'New type'
/** Was "Object type settings". */
export const TYPE_SETTINGS = 'Type settings'
/** Was "Add new object type". */
export const ADD_A_TYPE = 'Add a type'

/** Was "Query" / "Queries" (the page, the sidebar row, menus). */
export const SAVED_SEARCH = 'Saved search'
export const SAVED_SEARCHES = 'Saved searches'
export const SAVED_SEARCH_LOWER = 'saved search'
export const SAVED_SEARCHES_LOWER = 'saved searches'

/** The pages M32 adds or splits, as their tab, sidebar row and heading name them. */
export const HOME = 'Home'
export const TASKS = 'Tasks'
export const WORK = 'Work'

/** The two ways to start writing (Home, the sidebar, the palette). */
export const NEW_NOTE = 'New note'
export const TODAYS_NOTE = "Today's note"
