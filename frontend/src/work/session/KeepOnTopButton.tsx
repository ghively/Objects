// M23 Task 15: Keep on top. In the Object window the server opens an on-top window at
// `/?mini=work`; in a browser with Document Picture-in-Picture the button opens one; otherwise the
// button doesn't show (our call 20).
import { useEffect, useState, type JSX } from 'react'
import { api } from '@/api/client'
import { Icon } from '@/components/Icon'
import { workToast } from '../state/workActions'
import { WORK_ICONS } from '../workIcons'
import { WORK_TEXT } from '../workText'
import { openWorkPip, pipAvailable } from './pip'

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e))

/** Opens the keep-on-top window, or picture-in-picture; renders nothing where neither works. */
export function KeepOnTopButton(): JSX.Element | null {
  const [hasWindow, setHasWindow] = useState<boolean | null>(null)

  useEffect(() => {
    let live = true
    api
      .keepOnTopInfo()
      .then((info) => {
        if (live) setHasWindow(!!info?.window)
      })
      .catch(() => {
        if (live) setHasWindow(false)
      })
    return () => {
      live = false
    }
  }, [])

  if (hasWindow === null) return null
  const open = hasWindow ? () => api.openKeepOnTop() : pipAvailable() ? openWorkPip : null
  if (!open) return null
  return (
    <button
      type="button"
      data-work-keep-on-top=""
      onClick={() => void open().catch((e: unknown) => workToast(message(e)))}
      className="inline-flex h-7 items-center gap-1 rounded border border-line px-2 text-[12px] text-fg hover:bg-hover"
    >
      <Icon name={WORK_ICONS.pin} size={13} />
      {WORK_TEXT.keepOnTop}
    </button>
  )
}
