// The embed card: a header and the object's body in a read-only editor, fetched when it scrolls
// into view.
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { api } from '@/api/client'
import type { ObjectDetail, Row, TypeDef } from '@/api/types'
import { Editor } from '@/editor/Editor'
import { cn } from '@/lib/utils'
import { InlineToken } from './InlineToken'
import { CARD_BASE } from './SmallCard'

const noop = () => {}

export function EmbedCard({
  row,
  type,
  onOpen,
}: {
  row: Row
  type?: TypeDef
  onOpen?(row: Row, e: MouseEvent): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')
  const [detail, setDetail] = useState<ObjectDetail | null>(null)

  useEffect(() => {
    const el = ref.current
    if (visible || !el) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    api
      .object(row.summary.path)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [visible, row.summary.path, row.version])

  return (
    <div ref={ref} data-testid="embed-card" data-path={row.summary.path} className={cn(CARD_BASE, 'w-full cursor-default')}>
      <button
        type="button"
        onClick={(e) => onOpen?.(row, e)}
        className="flex h-10 w-full items-center border-b border-line px-3 text-left hover:bg-hover"
      >
        <InlineToken row={row} type={type} />
      </button>
      <div className="max-h-96 overflow-y-auto px-3 py-2">
        {detail ? (
          <Editor
            path={detail.summary.path}
            body={detail.body}
            version={detail.version}
            readOnly
            onSaved={noop}
            onConflict={noop}
          />
        ) : (
          <p className="py-2 text-[13px] text-fg-muted">{visible ? 'Loading…' : ''}</p>
        )}
      </div>
    </div>
  )
}
