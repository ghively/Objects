/**
 * The button block's node view (M14): a button with its label that runs the block's automation
 * on the object whose body holds it (`api.runAutomation(ruleId, path)`), a spinner while it
 * runs and a short notice afterwards. Its `…` menu edits the label in place, picks the
 * automation (button rules, plus "New automation…") and removes the block.
 *
 * In a template the button is disabled ("Buttons run in objects made from this template.");
 * an id that isn't a rule shows "Automation not found"; nothing is written either way.
 * Every string here is ours.
 */
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { lazy, Suspense, useState } from 'react'
import { Icon } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RulePicker } from '@/automations/RulePicker'
import { runButton } from '@/automations/runButton'
import { BUTTON_TEXT, buttonBlocker, reloadAutomations, useAutomations } from '@/automations/useAutomations'
import type { Option } from '../annotations'
import { buttonLabelSource, buttonLabelText, buttonRuleOf } from './buttonBlock'
import './buttonBlock.css'

// Loaded when "New automation…" is chosen: the rule editor's value cells come from the property
// cells, which themselves hold an editor, so a static import would make a module cycle.
const RuleEditorDialog = lazy(() => import('@/automations/RuleEditor').then((m) => ({ default: m.RuleEditorDialog })))

export const BUTTON_BLOCK_MENU_TEXT = {
  menu: 'Button menu',
  editLabel: 'Edit label',
  label: 'Button label',
  automation: 'Automation',
  remove: 'Remove Block',
} as const

const T = BUTTON_BLOCK_MENU_TEXT

/** The object the editor belongs to, and whether it is a template (from the page's markers). */
function hostOf(dom: Element | null): { path: string | null; template: boolean } {
  const host = dom?.closest?.('[data-object-path]') ?? null
  return {
    path: host?.getAttribute('data-object-path') ?? null,
    template: !!dom?.closest?.('[data-object-template]'),
  }
}

export function ButtonBlockView({ node, editor, getPos, selected }: NodeViewProps) {
  const label = buttonLabelText(String(node.attrs.label ?? ''))
  const ruleId = buttonRuleOf(node.attrs.blockOptions as Option[] | null)
  const { rules, loaded } = useAutomations()
  const [running, setRunning] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label)
  const [menuOpen, setMenuOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const editable = editor.isEditable

  const host = hostOf(editor.view.dom as HTMLElement)
  const blocker = host.template
    ? BUTTON_TEXT.inTemplate
    : ruleId
      ? buttonBlocker(ruleId, rules, loaded)
      : BUTTON_TEXT.noRuleBlock
  const missing = !!ruleId && loaded && !rules.some((r) => r.id === ruleId)
  const disabled = running || !!blocker || !host.path

  const pos = () => (typeof getPos === 'function' ? getPos() : undefined)
  const setRule = (id: string) => {
    const at = pos()
    if (at != null) editor.commands.setBlockOption('rule', id, at)
  }
  const remove = () => {
    const at = pos()
    if (at == null) return
    const current = editor.state.doc.nodeAt(at)
    editor.chain().deleteRange({ from: at, to: at + (current?.nodeSize ?? node.nodeSize) }).run()
  }
  const commitLabel = () => {
    setEditing(false)
    const next = buttonLabelSource(draft)
    if (next === null || buttonLabelText(next) === label) return
    const at = pos()
    if (at == null) return
    editor.view.dispatch(editor.state.tr.setNodeAttribute(at, 'label', next))
  }

  const press = async () => {
    if (disabled || !ruleId || !host.path) return
    setRunning(true)
    try {
      await runButton(ruleId, host.path)
    } finally {
      setRunning(false)
    }
  }

  return (
    <NodeViewWrapper
      className={`button-block${selected ? ' is-selected' : ''}`}
      data-button-block=""
      data-testid="button-block"
      contentEditable={false}
    >
      <div className="button-block-frame">
        {editing ? (
          <input
            autoFocus
            aria-label={T.label}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                commitLabel()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setDraft(label)
                setEditing(false)
              }
            }}
            className="button-block-input"
          />
        ) : (
          <button
            type="button"
            className="button-block-button"
            disabled={disabled}
            aria-busy={running || undefined}
            title={blocker ?? undefined}
            onClick={() => void press()}
          >
            {running ? (
              <Icon name="ph-spinner-gap" size={14} className="animate-spin" />
            ) : (
              <Icon name="ph-cursor-click" size={14} />
            )}
            <span className="button-block-label">{label}</span>
          </button>
        )}
        {missing && <span className="button-block-note">{BUTTON_TEXT.notFound}</span>}
        {editable && !editing && (
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <button type="button" className="button-block-menu" aria-label={T.menu} title={T.menu}>
                <Icon name="ph-dots-three-bold" size={14} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-60 border-line bg-raised p-1" role="dialog" aria-label={T.menu}>
              <button
                type="button"
                className="flex w-full items-center rounded px-2 py-1 text-left text-[14px] hover:bg-hover"
                onClick={() => {
                  setMenuOpen(false)
                  setDraft(label)
                  setEditing(true)
                }}
              >
                {T.editLabel}
              </button>
              <div className="px-2 pt-1.5 pb-0.5 text-[12px] font-medium text-fg-muted">{T.automation}</div>
              <RulePicker
                rules={rules}
                value={ruleId}
                onChange={(id) => {
                  setMenuOpen(false)
                  setRule(id)
                }}
                onNew={() => {
                  setMenuOpen(false)
                  setCreating(true)
                }}
              />
              <div className="my-1 border-t border-line" />
              <button
                type="button"
                className="flex w-full items-center rounded px-2 py-1 text-left text-[14px] hover:bg-hover"
                onClick={() => {
                  setMenuOpen(false)
                  remove()
                }}
              >
                {T.remove}
              </button>
            </PopoverContent>
          </Popover>
        )}
      </div>
      {creating && (
        <Suspense fallback={null}>
          <RuleEditorDialog
            open
            rule={null}
            initial={{ trigger: { kind: 'button', scope: null } }}
            onOpenChange={(open) => !open && setCreating(false)}
            onSaved={(saved) => {
              setCreating(false)
              setRule(saved.id)
              void reloadAutomations()
            }}
          />
        </Suspense>
      )}
    </NodeViewWrapper>
  )
}
