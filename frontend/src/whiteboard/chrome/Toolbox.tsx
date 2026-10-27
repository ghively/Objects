/**
 * The toolbox (bottom centre; the position is our choice, the trimmed reference has no
 * screenshot). Tools in Object's `whiteboardTools` order: Move/Hand (one button re-arming the
 * last pointer tool, with a caret for both), Text, Existing object, New object, Media (M8: re-arms
 * the last of Image, PDF, Audio, File and Web link, else Image; `resolveWhiteboardMediaTool`), Shapes (re-arms
 * the last shape-menu tool, else Rectangle), Gates (Engineering mode; the last gate, else NAND),
 * Frame, then the ink plugin's pen group, Undo/Redo, Lock and "More options" → "Canvas display".
 */
import type { ReactNode } from 'react'
import type { WhiteboardMediaTool, WhiteboardTool } from '@/api/whiteboardTypes'
import { Icon } from '@/components/Icon'
import type { ToolboxProps } from '../canvasTypes'
import {
  isCircuitLabel,
  isMediaTool,
  isPointerTool,
  isShapeMenuTool,
  MEDIA_TOOLS,
  POINTER_TOOLS,
  resolveCircuitTool,
  resolvePointerTool,
  resolveShapeMenuTool,
  resolveWhiteboardMediaTool,
} from '../model'
import { WB } from '../strings'
import { ChromeButton, hint, KEY_HINT, MenuRow, PopoverMenu, ShapeIcon, toolLabel } from './controls'
import { DisplayMenu } from './DisplayMenu'
import { GatesMenu } from './GatesMenu'
import { ShapeMenu } from './ShapeMenu'

/** Our strings: the carets that open a tool group's menu. */
export const TOOLBOX_TEXT = {
  choosePointer: 'Choose pointer tool',
  chooseShape: 'Choose shape',
  chooseGate: 'Choose gate',
  chooseMedia: 'Choose media',
}

/** The media tools' icons (Phosphor; our choice). */
export const MEDIA_ICON: Record<WhiteboardMediaTool, string> = {
  image: 'ph-image',
  pdf: 'ph-file-pdf',
  audio: 'ph-speaker-high',
  file: 'ph-file',
  weblink: 'ph-globe',
}

const POINTER_ICON: Record<'select' | 'hand', string> = { select: 'ph-cursor', hand: 'ph-hand' }
const POINTER_TIP: Record<'select' | 'hand', string> = {
  select: hint(WB.shortcutSelect.text, KEY_HINT.select),
  hand: hint(WB.shortcutHand.text, KEY_HINT.hand),
}
const SHAPE_KEYS: Partial<Record<WhiteboardTool, string>> = {
  line: KEY_HINT.line,
  arrow: KEY_HINT.arrow,
  rectangle: KEY_HINT.rectangle,
  ellipse: KEY_HINT.ellipse,
  triangle: KEY_HINT.triangle,
}

function Divider() {
  return <div aria-hidden className="mx-1 h-5 w-px bg-line" />
}

function Caret({ label, disabled, children }: { label: string; disabled?: boolean; children: (close: () => void) => ReactNode }) {
  return (
    <PopoverMenu label={label} disabled={disabled} trigger={<Icon name="ph-caret-up" size={10} />} triggerClassName="min-w-4 px-0.5">
      {children}
    </PopoverMenu>
  )
}

export function Toolbox({
  tool,
  onTool,
  settings,
  onSettings,
  locked,
  onLock,
  inkSlot,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  memory = {},
  readOnly = false,
}: ToolboxProps) {
  const editable = !locked && !readOnly
  const pointer = isPointerTool(tool) ? tool : resolvePointerTool(memory.lastPointerTool, memory.lastUsedTool)
  const shapeTool = isShapeMenuTool(tool)
    ? tool
    : resolveShapeMenuTool(memory.lastShapeTool, memory.lastUsedTool, memory.lastShape)
  const gateTool = isCircuitLabel(tool) ? tool : resolveCircuitTool(memory.lastCircuitTool, memory.lastUsedTool)
  const mediaTool = isMediaTool(tool) ? tool : resolveWhiteboardMediaTool(memory.lastMediaTool, memory.lastUsedTool)
  const engineering = settings.isEngineeringMode

  const toolButton = (t: WhiteboardTool, icon: string, tip?: string) => (
    <ChromeButton
      label={toolLabel(t)}
      tip={tip ?? toolLabel(t)}
      pressed={tool === t}
      disabled={!editable}
      onClick={() => onTool(t)}
    >
      <Icon name={icon} size={18} />
    </ChromeButton>
  )

  return (
    <div
      role="toolbar"
      aria-label="Whiteboard tools"
      data-whiteboard-toolbox=""
      className="flex items-center gap-0.5 rounded-xl border border-line bg-raised p-1 text-fg shadow-lg"
    >
      <ChromeButton
        label={toolLabel(pointer)}
        tip={POINTER_TIP[pointer]}
        pressed={isPointerTool(tool)}
        onClick={() => onTool(pointer)}
      >
        <Icon name={POINTER_ICON[pointer]} size={18} />
      </ChromeButton>
      <Caret label={TOOLBOX_TEXT.choosePointer}>
        {(close) =>
          POINTER_TOOLS.map((t) => (
            <MenuRow
              key={t}
              label={toolLabel(t)}
              tip={POINTER_TIP[t]}
              icon={<Icon name={POINTER_ICON[t]} size={14} />}
              selected={tool === t}
              onSelect={() => {
                onTool(t)
                close()
              }}
            />
          ))
        }
      </Caret>
      <Divider />
      {toolButton('text', 'ph-text-t', hint(WB.shortcutText.text, KEY_HINT.text))}
      {toolButton('link', 'ph-cube')}
      {toolButton('create', 'ph-plus-square')}
      <ChromeButton
        label={WB.toolMedia.text}
        tip={toolLabel(mediaTool)}
        pressed={isMediaTool(tool)}
        disabled={!editable}
        onClick={() => onTool(mediaTool)}
        data-armed={mediaTool}
      >
        <Icon name={MEDIA_ICON[mediaTool]} size={18} />
      </ChromeButton>
      <Caret label={TOOLBOX_TEXT.chooseMedia} disabled={!editable}>
        {(close) =>
          MEDIA_TOOLS.map((t) => (
            <MenuRow
              key={t}
              label={toolLabel(t)}
              icon={<Icon name={MEDIA_ICON[t]} size={14} />}
              selected={tool === t}
              onSelect={() => {
                onTool(t)
                close()
              }}
            />
          ))
        }
      </Caret>
      <ChromeButton
        label={WB.toolShapes.text}
        tip={hint(toolLabel(shapeTool), SHAPE_KEYS[shapeTool])}
        pressed={isShapeMenuTool(tool)}
        disabled={!editable}
        onClick={() => onTool(shapeTool)}
        data-armed={shapeTool}
      >
        <ShapeIcon tool={shapeTool} size={18} />
      </ChromeButton>
      <Caret label={TOOLBOX_TEXT.chooseShape} disabled={!editable}>
        {(close) => (
          <ShapeMenu
            value={tool}
            onPick={(t) => {
              onTool(t)
              close()
            }}
          />
        )}
      </Caret>
      {engineering && (
        <>
          <ChromeButton
            label={WB.toolCircuit.text}
            tip={toolLabel(gateTool)}
            pressed={isCircuitLabel(tool)}
            disabled={!editable}
            onClick={() => onTool(gateTool)}
            data-armed={gateTool}
          >
            <Icon name="ph-circuitry" size={18} />
          </ChromeButton>
          <Caret label={TOOLBOX_TEXT.chooseGate} disabled={!editable}>
            {(close) => (
              <GatesMenu
                value={tool}
                onPick={(t) => {
                  onTool(t)
                  close()
                }}
              />
            )}
          </Caret>
        </>
      )}
      {toolButton('frame', 'ph-frame-corners', hint(WB.shortcutFrame.text, KEY_HINT.frame))}
      {inkSlot && (
        <>
          <Divider />
          {inkSlot}
        </>
      )}
      <Divider />
      <ChromeButton label={WB.undo.text} tip={hint(WB.shortcutUndo.text, KEY_HINT.undo)} disabled={!canUndo} onClick={onUndo}>
        <Icon name="ph-arrow-counter-clockwise" size={18} />
      </ChromeButton>
      <ChromeButton label={WB.redo.text} tip={hint(WB.shortcutRedo.text, KEY_HINT.redo)} disabled={!canRedo} onClick={onRedo}>
        <Icon name="ph-arrow-clockwise" size={18} />
      </ChromeButton>
      <ChromeButton
        label={locked ? WB.toolUnlock.text : WB.toolLock.text}
        pressed={locked}
        disabled={readOnly}
        onClick={() => onLock(!locked)}
      >
        <Icon name={locked ? 'ph-lock-simple' : 'ph-lock-simple-open'} size={18} />
      </ChromeButton>
      <PopoverMenu label={WB.toolMore.text} trigger={<Icon name="ph-dots-three" size={18} />} align="end">
        {() => <DisplayMenu settings={settings} onSettings={onSettings} />}
      </PopoverMenu>
    </div>
  )
}
