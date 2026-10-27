/**
 * Presentation shortcuts (`lib/shortcuts.ts` ids). `openPresentationMode` (Mod-Alt-p) is bound
 * whenever the app runs and presents the open tab's object; `exitPresentationMode` (Escape),
 * `nextPresentationSlide` (ArrowRight) and `previousPresentationSlide` (ArrowLeft) are bound only
 * while presenting (the hook is called by the mounted presentation view, which mounts last, so
 * its keys win over the app's own Escape and arrow bindings).
 */
import { useGlobalShortcut } from '@/lib/shortcuts'
import { currentTarget, useTabs } from '@/nav/tabs'
import { usePresentation } from './usePresentation'

/** Binds `openPresentationMode`: presents the active tab's object (nothing elsewhere). */
export function useOpenPresentationShortcut(): void {
  useGlobalShortcut(
    'openPresentationMode',
    () => {
      const t = currentTarget(useTabs.getState())
      if (t?.kind === 'object') usePresentation.getState().start(t.path)
    },
    { allowInEditable: true },
  )
}

/** Binds the keys used while presenting. Call only from the mounted presentation. */
export function usePresentingShortcuts(handlers: { exit(): void; next(): void; previous(): void }): void {
  useGlobalShortcut('exitPresentationMode', () => handlers.exit(), { allowInEditable: true })
  useGlobalShortcut('nextPresentationSlide', () => handlers.next())
  useGlobalShortcut('previousPresentationSlide', () => handlers.previous())
}
