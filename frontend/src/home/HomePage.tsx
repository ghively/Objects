// M32: Home, what an empty tab shows (and a first open with nothing to restore) in place of
// "Pick an object type". Home is a tab state, not a page with its own data: opening it reads what
// the app already holds and writes no file. This is the contract's stub, the two ways to start
// writing; lane B adds "Recent" and "Tasks".
import type { TypeDef } from '@/api/types'
import { openTodaysNote } from '@/calendar/openTodaysNote'
import { Icon } from '@/components/Icon'
import { createAndOpen } from '@/create/createAndOpen'
import { HOME, NEW_NOTE, TODAYS_NOTE } from '@/lib/words'
import { pageType } from '@/palette/searchOptions'

export const HOME_TEXT = {
  heading: HOME,
  newNote: NEW_NOTE,
  todaysNote: TODAYS_NOTE,
} as const

const BUTTON =
  'flex h-10 items-center gap-2 rounded-lg border border-line bg-raised px-4 text-[15px] font-medium hover:bg-hover'

/** The type "New note" makes: the built-in Page (id `page`, else the type named Page). */
export function noteTypeId(types: readonly TypeDef[]): string {
  return pageType(types)?.id ?? 'page'
}

/** `types`: the space's types (the shell's), to find the type a new note is made of. */
export function HomePage({ types }: { types: readonly TypeDef[] }) {
  return (
    <div data-home-page="" className="flex h-full items-center justify-center overflow-auto p-8">
      <section aria-label={HOME_TEXT.heading} className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          className={BUTTON}
          onClick={(e) =>
            void createAndOpen(noteTypeId(types), {}, { ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey }).catch(
              (err: unknown) => console.warn('Could not create a note:', err),
            )
          }
        >
          <Icon name="ph-plus" size={16} />
          {HOME_TEXT.newNote}
        </button>
        <button type="button" className={BUTTON} onClick={() => void openTodaysNote()}>
          <Icon name="ph-notebook" size={16} />
          {HOME_TEXT.todaysNote}
        </button>
      </section>
    </div>
  )
}
