/**
 * The fixed prop and data types the canvas sub-lanes implement against: Task 10 (nodes),
 * Task 11 (edges) and Task 12 (chrome) replace the stub `index.ts` files with components of
 * exactly these types, so nothing here may change without all three.
 */
import type { ComponentType, ReactNode } from 'react'
import type { EdgeProps, NodeProps } from '@xyflow/react'
import type {
  WhiteboardBlock,
  WhiteboardBoardToolMemory,
  WhiteboardData,
  WhiteboardEdge,
  WhiteboardNode,
  WhiteboardPosition,
  WhiteboardSettings,
  WhiteboardTool,
} from '@/api/whiteboardTypes'
import type { EdgeStyle, OrderMode, PlaceMode } from './actions'
import type { FlowEdge, FlowEdgeData, FlowNode, FlowNodeData, FlowNodeType } from './flowMapping'
import type { WhiteboardHost } from './host'
import type { Box } from './model'
import type { InkStroke } from './plugin'

export type { FlowEdge, FlowEdgeData, FlowNode, FlowNodeData, FlowNodeType }

/** React Flow `nodeTypes` keys (runtime only; the file stores each node's `kind`). */
export const NODE_TYPE_KEYS = ['boardBlock', 'boardShape', 'boardFrame', 'boardPoint'] as const
export type NodeTypeKey = (typeof NODE_TYPE_KEYS)[number]
/** React Flow `edgeTypes` key. */
export const EDGE_TYPE_KEY = 'connector'

/** What a node component receives (React Flow's props for our projected node). */
export type WhiteboardNodeProps = NodeProps<FlowNode>
/** What the connector component receives. */
export type WhiteboardEdgeProps = EdgeProps<FlowEdge>

export type NodeTypes = Record<NodeTypeKey, ComponentType<WhiteboardNodeProps>>
export type EdgeTypes = Record<typeof EDGE_TYPE_KEY, ComponentType<WhiteboardEdgeProps>>

/** SVG `<marker>` definitions, rendered once per board inside the canvas. */
export interface MarkerDefsProps {
  edges: WhiteboardEdge[]
}

/** The canvas display settings with the defaults filled in. */
export type ResolvedSettings = Required<WhiteboardSettings>
export type SettingKey = keyof WhiteboardSettings

/** Where a placement tool was used: a click (a point) or a drag (a box, or a segment for Line/Arrow). */
export type Placement = Box | WhiteboardPosition | { start: WhiteboardPosition; end: WhiteboardPosition }

/** The store's actions: what nodes, edges and chrome call (through `useBoardActions()`). */
export interface BoardActions {
  /** Applies `fn` to the board as one undo step (`coalesceKey` merges a gesture into one). */
  apply(label: string, fn: (board: WhiteboardData) => WhiteboardData, coalesceKey?: string): void
  undo(): void
  redo(): void
  /** Replace the selection (node and edge ids). */
  select(ids: string[]): void
  setTool(tool: WhiteboardTool): void
  beginEdit(id: string): void
  endEdit(): void
  /** Remember tool choices for this board (tool memory, kept in localStorage). */
  remember(patch: Partial<WhiteboardBoardToolMemory>): void

  createFromTool(tool: WhiteboardTool, at: Placement, opts?: { snap?: boolean; text?: string }): string | null
  createEntity(link: string, at: WhiteboardPosition, opts?: { snap?: boolean }): string | null
  connect(source: string, target: string, handles?: { sourceHandle?: string | null; targetHandle?: string | null }, style?: EdgeStyle): string | null
  updateNode(id: string, patch: Partial<WhiteboardNode>, coalesceKey?: string): void
  updateEdge(id: string, patch: Partial<WhiteboardEdge>, coalesceKey?: string): void
  setBlock(ownerId: string, block: WhiteboardBlock | null): void
  /** Removes the selection (or `ids`). */
  removeSelection(ids?: string[]): void
  /** Duplicates the selection (or `ids`) one grid cell down and right and selects the copies. */
  duplicate(ids?: string[]): void
  nudge(dx: number, dy: number, ids?: string[]): void
  order(mode: OrderMode, ids?: string[]): void
  place(mode: PlaceMode, ids?: string[]): void
  flip(axis: 'x' | 'y', ids?: string[]): void
  wrapInFrame(ids?: string[]): void
  /** "Clear Whiteboard": board and ink, one undo step. */
  clearBoard(): void
  setLocked(locked: boolean): void
  addEdgeLabel(edgeId: string): void
  removeEdgeLabel(edgeId: string): void
  addFrameTitle(frameId: string): void
  removeFrameTitle(frameId: string): void
  /** Ink strokes changed (one stroke or one erase gesture is one step). */
  setStrokes(next: InkStroke[], label: 'draw' | 'erase'): void
}

export interface ToolboxProps {
  tool: WhiteboardTool
  onTool(tool: WhiteboardTool): void
  settings: ResolvedSettings
  onSettings(key: SettingKey, value: boolean): void
  locked: boolean
  onLock(locked: boolean): void
  /** The ink plugin's toolbar (the pen group), when an ink plugin is given. */
  inkSlot?: ReactNode
  onUndo(): void
  onRedo(): void
  canUndo: boolean
  canRedo: boolean
  /** The board's tool memory (which shape and gate the Shapes and Gates buttons re-arm). */
  memory?: WhiteboardBoardToolMemory
  /** The whole board is read-only (an unreadable file): tools that edit are disabled. */
  readOnly?: boolean
  /** M8: "Play" presents the board frame by frame; the button shows when this is given. */
  onPlay?(): void
}

export interface SelectionToolbarProps {
  nodes: WhiteboardNode[]
  edges: WhiteboardEdge[]
  blocks: Record<string, WhiteboardBlock>
  actions: BoardActions
}

export type ZoomCommand = number | 'in' | 'out' | 'fit' | 'selection' | 'reset'

export interface ZoomMenuProps {
  zoom: number
  onZoom(z: ZoomCommand): void
}

export interface BoardMenuProps {
  onClear(): void
  onDelete(): void
  onOpenAsPage?(): void
  /** M8: "Export as PNG" (the whole board). */
  onExportPng?(): void
  /** M8: "Export selection as PNG", offered while something is selected. */
  onExportSelectionPng?(): void
  /** M8: "Version History" (opens the Version History dialog on the board). */
  onVersionHistory?(): void
  /** Clear is unavailable (locked or read-only board). */
  disabled?: boolean
}

export interface ObjectPickerProps {
  mode: 'link' | 'create'
  /** M8 ("Link {name}" in the quick-create menu): list only objects of this type. */
  typeId?: string
  host: WhiteboardHost
  onPick(result: { path: string }): void
  onClose(): void
}
