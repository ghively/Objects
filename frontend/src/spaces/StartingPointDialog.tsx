/**
 * Fix pass H2: "Pick a starting point" for a space opened as a new or empty folder (`objectapp
 * --space <folder>`), the same choices "Create new space" offers (`SETUPS`). Shown once the
 * space info says `needsSetup` (the server: no `setup` in `space.json`, no basic types, no files).
 * Nothing is written until a choice is clicked; closing the dialog leaves the space untouched and
 * asks again next time it opens empty.
 */
import { useState } from 'react'
import { api } from '@/api/client'
import type { SpaceSetup } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useLinkIndex } from '@/links/linkIndex'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { CREATE_SPACE_TEXT, SETUPS } from './CreateSpaceDialog'

export const STARTING_POINT_TEXT = {
  title: CREATE_SPACE_TEXT.howToStart,
  intro: 'This space is empty. How do you want to start?', // our string
} as const

export function StartingPointDialog() {
  const needsSetup = useSpaceInfo((s) => s.space?.needsSetup === true)
  const root = useSpaceInfo((s) => s.space?.root ?? null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const open = needsSetup && root !== null && dismissed !== root

  const pick = async (setup: SpaceSetup) => {
    setBusy(true)
    setError(null)
    try {
      const info = await api.spaceSetup(setup)
      useSpaceInfo.setState({ space: info, loaded: true })
      // The sidebar and the New menu read the types from the link index: reload it for the new ones
      // (every setup but an empty space writes types).
      if (setup !== 'blank') void useLinkIndex.getState().load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && setDismissed(root)}>
      <DialogContent data-starting-point="" className="border-line bg-raised-2 text-fg sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{STARTING_POINT_TEXT.title}</DialogTitle>
          <DialogDescription className="text-[14px] text-fg-muted">{STARTING_POINT_TEXT.intro}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          {SETUPS.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={busy}
              onClick={() => void pick(o.value)}
              aria-label={o.label}
              aria-describedby={`starting-point-${o.value}`}
              className="flex items-start gap-2.5 rounded-lg border border-line p-2.5 text-left hover:bg-hover disabled:opacity-50"
            >
              <Icon name={o.icon} size={18} className="mt-0.5 shrink-0 text-fg-muted" />
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold">{o.label}</span>
                <span id={`starting-point-${o.value}`} className="block text-[13px] text-fg-muted">
                  {o.description}
                </span>
              </span>
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
