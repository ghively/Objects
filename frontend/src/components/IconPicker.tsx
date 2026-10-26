import type { IconifyJSON } from '@iconify/types'
import { useEffect, useMemo, useState } from 'react'
import type { Icon as IconValue } from '@/api/types'
import { cn } from '@/lib/utils'
import { lineColor } from '@/theme/palette'
import { ColorPicker } from './ColorPicker'
import { Icon } from './Icon'

// A small offline emoji set with search names. The full Unicode list arrives with a later
// milestone; any emoji already stored still renders.
const EMOJI: readonly [string, string][] = [
  ['😀', 'grinning face smile'],
  ['😂', 'face with tears of joy laugh'],
  ['🙂', 'slightly smiling face'],
  ['😍', 'heart eyes love'],
  ['🤔', 'thinking face'],
  ['😎', 'cool sunglasses'],
  ['😴', 'sleeping face'],
  ['🥳', 'party face celebrate'],
  ['😅', 'sweat smile'],
  ['🙃', 'upside down face'],
  ['👍', 'thumbs up yes'],
  ['👎', 'thumbs down no'],
  ['👋', 'waving hand hello'],
  ['👏', 'clapping hands'],
  ['🙏', 'folded hands thanks'],
  ['💪', 'flexed biceps strong'],
  ['👀', 'eyes look'],
  ['🧠', 'brain think'],
  ['👤', 'bust silhouette person user'],
  ['👥', 'busts people users group'],
  ['❤️', 'red heart love'],
  ['🧡', 'orange heart'],
  ['💛', 'yellow heart'],
  ['💚', 'green heart'],
  ['💙', 'blue heart'],
  ['💜', 'purple heart'],
  ['🖤', 'black heart'],
  ['💔', 'broken heart'],
  ['⭐', 'star favourite'],
  ['🌟', 'glowing star'],
  ['✨', 'sparkles'],
  ['🔥', 'fire hot'],
  ['⚡', 'lightning bolt'],
  ['💡', 'light bulb idea'],
  ['🎯', 'target goal bullseye'],
  ['🚀', 'rocket launch'],
  ['🏆', 'trophy win'],
  ['🎉', 'party popper celebrate'],
  ['🎁', 'gift present'],
  ['📌', 'pushpin pin'],
  ['📍', 'round pin location'],
  ['📎', 'paperclip attachment'],
  ['📝', 'memo note write'],
  ['📄', 'page document'],
  ['📁', 'folder'],
  ['📂', 'open folder'],
  ['📚', 'books library'],
  ['📖', 'open book read'],
  ['📅', 'calendar date'],
  ['🗓️', 'spiral calendar'],
  ['⏰', 'alarm clock time'],
  ['⏳', 'hourglass wait'],
  ['✅', 'check mark done'],
  ['❌', 'cross mark no'],
  ['⚠️', 'warning'],
  ['❓', 'question mark'],
  ['❗', 'exclamation mark'],
  ['🔒', 'locked lock'],
  ['🔑', 'key'],
  ['🔧', 'wrench tool'],
  ['🔨', 'hammer tool'],
  ['⚙️', 'gear settings'],
  ['🧪', 'test tube lab'],
  ['🔬', 'microscope science'],
  ['💻', 'laptop computer'],
  ['🖥️', 'desktop computer'],
  ['📱', 'mobile phone'],
  ['🖨️', 'printer'],
  ['💾', 'floppy disk save'],
  ['📊', 'bar chart'],
  ['📈', 'chart increasing'],
  ['📉', 'chart decreasing'],
  ['💰', 'money bag'],
  ['💳', 'credit card'],
  ['🛒', 'shopping cart'],
  ['📦', 'package box'],
  ['✉️', 'envelope mail'],
  ['📧', 'e-mail'],
  ['💬', 'speech balloon chat'],
  ['📣', 'megaphone announce'],
  ['🔔', 'bell notification'],
  ['🎵', 'musical note music'],
  ['🎨', 'artist palette art'],
  ['📷', 'camera photo'],
  ['🎬', 'clapper board film'],
  ['🎮', 'video game'],
  ['⚽', 'soccer ball sport'],
  ['🏃', 'person running'],
  ['🧘', 'person in lotus position yoga'],
  ['🍎', 'red apple fruit'],
  ['☕', 'hot beverage coffee'],
  ['🍕', 'pizza food'],
  ['🌱', 'seedling plant grow'],
  ['🌳', 'deciduous tree'],
  ['🌸', 'cherry blossom flower'],
  ['☀️', 'sun weather'],
  ['🌙', 'crescent moon night'],
  ['🌍', 'globe earth world'],
  ['🏠', 'house home'],
  ['🏢', 'office building work'],
  ['✈️', 'airplane travel'],
  ['🚗', 'car'],
  ['🗺️', 'world map'],
  ['🐶', 'dog face'],
  ['🐱', 'cat face'],
  ['🦊', 'fox'],
  ['🐝', 'honeybee'],
]

const WEIGHT_SUFFIX = /-(bold|duotone|fill|light|thin)$/
const MAX_ICONS = 160

let phNames: Promise<string[]> | null = null

/** The regular-weight Phosphor icon ids (`ph-…`), loaded from the bundled set. */
function loadPhNames(): Promise<string[]> {
  phNames ??= import('@iconify-json/ph/icons.json').then((m) => {
    const json = ((m as { default?: IconifyJSON }).default ?? m) as IconifyJSON
    const names = [...Object.keys(json.icons), ...Object.keys(json.aliases ?? {})]
    return names
      .filter((n) => !WEIGHT_SUFFIX.test(n))
      .sort()
      .map((n) => `ph-${n}`)
  })
  return phNames
}

export interface IconPickerProps {
  value: IconValue | null | undefined
  onChange(next: IconValue | null): void
}

type Tab = 'emoji' | 'icons'

/**
 * Emoji and Icons tabs, each with search. The Icons tab offers the bundled Phosphor set (other
 * bundled sets still render). An Iconify icon gets a colour row that sets `Icon.color`. "Remove"
 * clears the icon.
 */
export function IconPicker({ value, onChange }: IconPickerProps) {
  const [tab, setTab] = useState<Tab>(value?.type === 'emoji' ? 'emoji' : 'icons')
  const [query, setQuery] = useState('')
  const [names, setNames] = useState<string[] | null>(null)

  useEffect(() => {
    if (tab !== 'icons' || names) return
    let alive = true
    void loadPhNames().then((n) => {
      if (alive) setNames(n)
    })
    return () => {
      alive = false
    }
  }, [tab, names])

  const q = query.trim().toLowerCase()
  const icons = useMemo(() => {
    if (!names) return []
    const words = q.split(/\s+/).filter(Boolean)
    const hits = words.length ? names.filter((n) => words.every((w) => n.slice(3).includes(w))) : names
    // Exact and prefix matches first.
    const rank = (n: string) => (n.slice(3) === q ? 0 : n.slice(3).startsWith(q) ? 1 : 2)
    return [...hits].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, MAX_ICONS)
  }, [names, q])
  const emoji = useMemo(() => (q ? EMOJI.filter(([, n]) => n.includes(q)) : EMOJI), [q])

  const tabButton = (t: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === t}
      onClick={() => {
        setTab(t)
        setQuery('')
      }}
      className={cn(
        'rounded px-2 py-1 text-[13px] text-fg-muted hover:bg-hover hover:text-fg',
        tab === t && 'bg-hover text-fg',
      )}
    >
      {label}
    </button>
  )

  return (
    <div className="flex w-80 flex-col gap-2 p-2">
      <div className="flex items-center gap-1">
        <div role="tablist" className="flex gap-1">
          {tabButton('emoji', 'Emoji')}
          {tabButton('icons', 'Icons')}
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="ml-auto rounded px-2 py-1 text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
        >
          Remove
        </button>
      </div>
      <input
        aria-label={tab === 'icons' ? 'Search icons' : 'Search emoji'}
        placeholder="Search"
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
        className="h-8 rounded-md border border-line bg-panel px-2 text-[14px] text-fg outline-none focus:border-fg-muted"
      />
      {tab === 'icons' && value?.type === 'iconify' && (
        <ColorPicker value={value.color ?? null} onChange={(c) => onChange({ ...value, color: c })} />
      )}
      <div role="tabpanel" className="grid max-h-60 grid-cols-8 gap-1 overflow-y-auto">
        {tab === 'icons'
          ? icons.map((id) => (
              <button
                key={id}
                type="button"
                aria-label={id}
                title={id.slice(3)}
                onClick={() => onChange({ type: 'iconify', val: id })}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded text-fg hover:bg-hover',
                  value?.val === id && 'bg-hover',
                )}
                style={value?.val === id && value.color ? { color: lineColor(value.color) } : undefined}
              >
                <Icon name={id} size={18} />
              </button>
            ))
          : emoji.map(([e, name]) => (
              <button
                key={e}
                type="button"
                aria-label={name}
                title={name}
                onClick={() => onChange({ type: 'emoji', val: e })}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded text-[18px] hover:bg-hover',
                  value?.val === e && 'bg-hover',
                )}
              >
                {e}
              </button>
            ))}
        {tab === 'icons' && names && icons.length === 0 && (
          <p className="col-span-8 py-2 text-center text-[13px] text-fg-muted">No results</p>
        )}
        {tab === 'emoji' && emoji.length === 0 && (
          <p className="col-span-8 py-2 text-center text-[13px] text-fg-muted">No results</p>
        )}
      </div>
    </div>
  )
}
