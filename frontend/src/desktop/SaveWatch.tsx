/**
 * M33: reads the save state of every open note for the desktop window's before-close handler
 * (`beforeClose.ts`). `editor/saveStateStore.ts` publishes a note's state (its text and its title
 * together) to whoever asks by path, with a hook; so this draws nothing and asks, for each note a
 * tab, a side-panel entry or the peek shows, and reports what it hears. Mounted only inside the
 * shell (`DesktopChrome`).
 */
import { useLayoutEffect } from 'react'
import { useSaveState } from '@/editor/saveStateStore'
import { tabTarget, usePeek, useTabs, type Tab } from '@/nav/tabs'
import { reportSaveState } from './beforeClose'

/** The paths of the notes shown: each tab's page, its side-panel entries, the peek. Sorted, once each. */
export function notePaths(tabs: Tab[], peekPath: string | null): string[] {
  const paths = new Set<string>()
  for (const tab of tabs) {
    const target = tabTarget(tab)
    if (target?.kind === 'object') paths.add(target.path)
    for (const entry of tab.sidepanel ?? []) if (entry.target?.kind === 'object') paths.add(entry.target.path)
  }
  if (peekPath) paths.add(peekPath)
  return [...paths].sort()
}

function NoteProbe({ path }: { path: string }) {
  const state = useSaveState(path)
  // In the layout phase: the handler may ask in the same turn the state changed.
  useLayoutEffect(() => {
    reportSaveState(path, state)
    return () => reportSaveState(path, null)
  }, [path, state])
  return null
}

const SEP = '\u0000'

export function SaveWatch() {
  const peekPath = usePeek((s) => s.path)
  // One string, so a navigation that opens no other note re-renders nothing here.
  const joined = useTabs((s) => notePaths(s.tabs, null).join(SEP))
  const paths = notePaths([], peekPath).concat(joined ? joined.split(SEP) : [])
  return (
    <>
      {[...new Set(paths)].map((path) => (
        <NoteProbe key={path} path={path} />
      ))}
    </>
  )
}
