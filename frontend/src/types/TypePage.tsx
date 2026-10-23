import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { ObjectSummary, TypeDef } from '@/api/types'
import { ObjectIcon } from '@/object/ObjectHeader'
import { usePeek } from '@/nav/tabs'
import { TypeChip } from '@/shell/Sidebar'

/** Change events arrive in bursts (a git checkout, a sync tool): reload once per burst. */
const RELOAD_DELAY_MS = 150

/** M1 type page: header (icon tile + plural name) and a plain list of titles; click to peek. */
export function TypePage({ type }: { type: TypeDef }) {
  const [objects, setObjects] = useState<ObjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let seq = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = () => {
      const mine = ++seq // only the latest request may update the list
      return api
        .objects(type.id)
        .then((os) => {
          if (!alive || mine !== seq) return
          setObjects([...os].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })))
          setError(null)
        })
        .catch((e: unknown) => alive && mine === seq && setError(e instanceof Error ? e.message : String(e)))
    }
    setObjects(null)
    void load()
    // Keep the list current as files appear, change or disappear on disk.
    const off = api.onChange(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void load()
      }, RELOAD_DELAY_MS)
    })
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      off()
    }
  }, [type.id])

  const paths = objects?.map((o) => o.path) ?? []

  return (
    <div className="w-full">
      <header className="flex items-center gap-2.5 border-b border-line px-4 pt-5 pb-4">
        <TypeChip type={type} size={34} />
        <h1 className="text-[24px] font-bold">{type.pluralName}</h1>
        {objects && (
          <span className="ml-1 rounded-md border border-line px-1.5 text-[13px] text-fg-muted tabular-nums">
            {objects.length}
          </span>
        )}
      </header>
      <div className="mx-auto w-full max-w-[1100px] px-10 pt-6 pb-16">
      {error && <p className="text-fg-muted">{error}</p>}
      {objects && objects.length === 0 && (
        <div className="py-16 text-center">
          <p className="font-semibold">No {type.pluralName.toLowerCase()} yet</p>
          <p className="mt-1 text-fg-muted">Objects of this type will show up here.</p>
        </div>
      )}
      {objects && objects.length > 0 && (
        <ul aria-label={type.pluralName} className="flex flex-col">
          {objects.map((o) => (
            <li key={o.path} className="border-b border-line/60 last:border-b-0">
              <button
                type="button"
                onClick={() => usePeek.getState().peek(o.path, paths)}
                className="flex h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[15px] font-medium hover:bg-hover"
              >
                {o.icon ? <ObjectIcon icon={o.icon} size={18} /> : <TypeChip type={type} size={22} />}
                <span className="min-w-0 flex-1 truncate">{o.title}</span>
                {o.readOnly && <span className="text-[13px] text-fg-muted">read-only</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      </div>
    </div>
  )
}
