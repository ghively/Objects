/**
 * The Gates menu (Engineering mode only): the logic gates, then "I/O" with HIGH and LOW. A gate
 * persists as a rectangle whose text block is exactly its label (`whiteboard.model.ts`).
 */
import type { WhiteboardCircuitLabel, WhiteboardTool } from '@/api/whiteboardTypes'
import { CIRCUIT_TEXT } from '../model'
import { WB } from '../strings'
import { MenuHeading, MenuRow, MenuSeparator, toolLabel } from './controls'

export const GATE_TOOLS = ['not', 'and', 'nand', 'or', 'nor', 'xor', 'xnor'] as const satisfies readonly WhiteboardCircuitLabel[]
export const IO_TOOLS = ['high', 'low'] as const satisfies readonly WhiteboardCircuitLabel[]

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
