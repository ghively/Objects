/**
 * The embedded object's node view: `![[Title]]` resolved through the link
 * index (from the object that holds the editor) and loaded with one
 * `api.rows({paths})` call, then drawn with M3's `ObjectCard` in its view:
 * the `view` option, else the type's `defaultViewType`, else `smallCard`.
 *
 * A `…` menu offers "Change Block View" with
 * "Link block", "Small card", "Wide card", "Embed",
 * writing `view`, and "Remove Block".
 * Clicking the card opens the object as a link (`via: 'link'`). An unresolved
 * target shows the muted `[[target]]` chip, as M1's unresolved wikilinks.
 *
 * M8: a task-role object (the basic Task type) in the Link block view shows M4's
 * `TaskCheckbox` before its token, as task embeds do.
 */
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect, useState, type MouseEvent } from 'react'
import { api } from '@/api/client'
import type { Row, TypeDef } from '@/api/types'
import { openObject } from '@/create/createAndOpen'
import { TaskCheckbox } from '@/tasks/TaskCheckbox'
import { ensureLinkIndex, resolveLink, typeOf, useLinkIndex } from '@/links/linkIndex'
import { cardProperties } from '@/views/cards/cardConfig'
import { ObjectCard, type CardView } from '@/views/cards/ObjectCard'
import type { Option } from '../annotations'
import { EmbedMenu, ResizableEmbed } from '../media/ResizableEmbed'
import { cardToLink, LINK_CARD_TEXT } from '../linkCard'

/** The four views and their names, in menu order. */
export const EMBED_VIEWS: { view: CardView; name: string }[] = [
  { view: 'inline', name: 'Link block' },
  { view: 'smallCard', name: 'Small card' },
  { view: 'wideCard', name: 'Wide card' },
  { view: 'embed', name: 'Embed' },
]

const VIEW_SET = new Set<string>(EMBED_VIEWS.map((v) => v.view))

/** The view a block shows: its `view` option, else the type's default, else a small card. */
export function embedViewOf(options: readonly Option[] | null | undefined, type: TypeDef | undefined): CardView {
  const v = (options ?? []).find((o) => o.key === 'view')?.value
  if (typeof v === 'string' && VIEW_SET.has(v)) return v as CardView
  return type?.defaultViewType ?? 'smallCard'
}

/** A task-role type: the basic Task type (as `isTaskDate` reads it). */
export function isTaskRoleType(type: TypeDef | undefined, typeId?: string | null): boolean {
  if (type) return type.basic && type.name.toLowerCase() === 'task'
  return !!typeId && typeId.toLowerCase() === 'task'
}

type Loaded = { status: 'loading' } | { status: 'missing' } | { status: 'ok'; row: Row }

export function ObjectEmbedView({ node, editor, getPos, selected }: NodeViewProps) {
  const target = String(node.attrs.target ?? '')
  const label = (node.attrs.label as string | null) ?? null
  const options = node.attrs.blockOptions as Option[] | null
  const editable = editor.isEditable
  const revision = useLinkIndex((s) => s.revision)
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })

  useEffect(() => {
    let alive = true
    const from =
      (editor.view.dom as HTMLElement).closest?.('[data-object-path]')?.getAttribute('data-object-path') ?? undefined
    void (async () => {
      await ensureLinkIndex()
      const path = await resolveLink(target, from)
      if (!alive) return
      if (!path) return setLoaded({ status: 'missing' })
      let rows: Row[] = []
      try {
        rows = await api.rows({ paths: [path] })
      } catch {
        rows = []
      }
      if (!alive) return
      const row = rows.find((r) => r.summary.path === path) ?? rows[0]
      setLoaded(row ? { status: 'ok', row } : { status: 'missing' })
    })()
    return () => {
      alive = false
    }
  }, [editor, target, revision])

  const pos = () => (typeof getPos === 'function' ? getPos() : undefined)
  const setOption = (key: string, value: string | null) => {
    const at = pos()
    if (at != null) editor.commands.setBlockOption(key, value, at)
  }
  const remove = () => {
    const at = pos()
    if (at == null) return
    const current = editor.state.doc.nodeAt(at)
    editor.chain().deleteRange({ from: at, to: at + (current?.nodeSize ?? node.nodeSize) }).run()
  }

  const row = loaded.status === 'ok' ? loaded.row : null
  const type = row ? typeOf(row.summary.type) : undefined
  const view = embedViewOf(options, type)

  const onOpen = (r: Row, e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    openObject(
      r.summary.path,
      { ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, via: 'link' },
      r.summary.type,
    )
  }

  const menu = (
    <EmbedMenu
      items={[
        {
          label: 'Change Block View',
          onSelect: () => {},
          children: EMBED_VIEWS.map((v) => ({
            label: v.name,
            checked: v.view === view,
            onSelect: () => setOption('view', v.view),
          })),
        },
        ...(editable
          ? [{ label: LINK_CARD_TEXT.toLink, onSelect: () => { const at = pos(); if (at != null) cardToLink(editor, at) } }]
          : []),
        { label: 'Remove Block', onSelect: remove },
      ]}
    />
  )

  let body
  if (loaded.status === 'missing') {
    body = (
      <span className="wikilink wikilink-unresolved object-embed-unresolved" data-unresolved="" data-testid="object-embed-unresolved">
        [[{label ?? target}]]
      </span>
    )
  } else if (!row) {
    body = <div className="object-embed-loading" aria-busy="true" />
  } else {
    const card = <ObjectCard row={row} type={type} view={view} props={type ? cardProperties(type) : []} onOpen={onOpen} />
    body =
      view === 'inline' && isTaskRoleType(type, row.summary.type) ? (
        <span className="object-embed-task inline-flex max-w-full items-center gap-1" data-testid="object-embed-task">
          <TaskCheckbox
            row={row}
            type={type}
            onResult={(outcome) => {
              if (outcome.row) setLoaded({ status: 'ok', row: outcome.row })
            }}
          />
          {card}
        </span>
      ) : (
        card
      )
  }

  return (
    <NodeViewWrapper
      className={`object-embed${selected ? ' is-selected' : ''}`}
      data-object-embed=""
      data-target={target}
      data-view={view}
      data-testid="object-embed"
    >
      <ResizableEmbed
        options={options}
        editable={editable}
        setOption={setOption}
        resizeWidth={view === 'embed'}
        alignable
        menu={menu}
      >
        <div className="object-embed-body" contentEditable={false}>
          {body}
        </div>
      </ResizableEmbed>
    </NodeViewWrapper>
  )
}
