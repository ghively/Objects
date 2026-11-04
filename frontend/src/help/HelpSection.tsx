// The sidebar's "Help & Resources" section, under Graph and Trash: Keyboard shortcuts (the
// Shortcuts sheet), Getting started and Markdown reference (bundled texts shown read-only). The
// heading folds the section; the fold is kept per browser. Local only: no link leaves the app.
import { Suspense, useState } from 'react'
import { Icon } from '@/components/Icon'
import { lazyWithReload } from '@/lib/lazyReload'
import { useSettingsModal } from '@/settings/useSettingsModal'
import { HELP_TEXT, readHelpCollapsed, writeHelpCollapsed, type HelpDoc } from './helpText'

const HelpDialog = lazyWithReload(() => import('@/help/HelpDialog'))

function HelpRow({ icon, label, onClick }: { icon: string; label: string; onClick(): void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex h-[38px] w-full items-center gap-2 rounded-lg px-2 text-left text-[15px] font-medium text-fg hover:bg-hover"
      >
        <Icon name={icon} size={16} />
        <span>{label}</span>
      </button>
    </li>
  )
}

export function HelpSection() {
  const [collapsed, setCollapsed] = useState(readHelpCollapsed)
  const [doc, setDoc] = useState<HelpDoc | null>(null)
  const toggle = () => {
    setCollapsed((cur) => {
      writeHelpCollapsed(!cur)
      return !cur
    })
  }
  return (
    <section aria-labelledby="sb-help" data-help-section="" className="pb-3">
      <h2 id="sb-help" className="flex items-center px-0 pt-3 pb-1 text-[14px] font-semibold text-[var(--text-section)]">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          title={collapsed ? HELP_TEXT.show : HELP_TEXT.hide}
          className="group/help flex flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-hover"
        >
          <Icon name="ph-question" size={14} />
          <span className="flex-1">{HELP_TEXT.section}</span>
          <Icon
            name={collapsed ? 'ph-caret-right' : 'ph-caret-down'}
            size={12}
            className={collapsed ? undefined : 'opacity-0 group-hover/help:opacity-100 group-focus-visible/help:opacity-100'}
          />
        </button>
      </h2>
      {!collapsed && (
        <ul className="flex flex-col gap-0.5">
          <HelpRow icon="ph-keyboard" label={HELP_TEXT.shortcuts} onClick={() => useSettingsModal.getState().openShortcuts()} />
          <HelpRow icon="ph-lightbulb" label={HELP_TEXT.gettingStarted} onClick={() => setDoc('gettingStarted')} />
          <HelpRow icon="ph-markdown-logo" label={HELP_TEXT.markdownReference} onClick={() => setDoc('markdownReference')} />
        </ul>
      )}
      {doc && (
        <Suspense fallback={null}>
          <HelpDialog doc={doc} onClose={() => setDoc(null)} />
        </Suspense>
      )}
    </section>
  )
}
