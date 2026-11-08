/**
 * The Gates menu, shown in Engineering mode: the logic gates first, then the fixed inputs under
 * "I/O". Picking one arms that gate; how a gate is stored is described in `model.ts`.
 */
import type { WhiteboardCircuitLabel, WhiteboardTool } from '@/api/whiteboardTypes'
import { CIRCUIT_IO, CIRCUIT_LABELS, CIRCUIT_TEXT } from '../model'
import { WB } from '../strings'
import { MenuHeading, MenuRow, MenuSeparator, toolLabel } from './controls'

export const IO_TOOLS = CIRCUIT_IO
export const GATE_TOOLS = CIRCUIT_LABELS.filter((g) => !IO_TOOLS.includes(g))

export interface GatesMenuProps {
  value?: WhiteboardTool
  onPick(tool: WhiteboardCircuitLabel): void
  disabled?: boolean
}

function GateIcon({ label }: { label: WhiteboardCircuitLabel }) {
  return <span className="font-mono text-[9px] leading-none">{CIRCUIT_TEXT[label].slice(0, 2)}</span>
}

export function GatesMenu({ value, onPick, disabled }: GatesMenuProps) {
  const row = (tool: WhiteboardCircuitLabel) => (
    <MenuRow
      key={tool}
      label={toolLabel(tool)}
      icon={<GateIcon label={tool} />}
      selected={value === tool}
      disabled={disabled}
      onSelect={() => onPick(tool)}
    />
  )
  return (
    <div role="menu" aria-label={WB.toolCircuit.text} data-whiteboard-gates-menu="" className="flex flex-col">
      <MenuHeading>{WB.toolCircuit.text}</MenuHeading>
      {GATE_TOOLS.map(row)}
      <MenuSeparator />
      <MenuHeading>{WB.toolIo.text}</MenuHeading>
      {IO_TOOLS.map(row)}
    </div>
  )
}
