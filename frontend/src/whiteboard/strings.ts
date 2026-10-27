/**
 * Every UI string the whiteboard canvas uses, with its Object i18n key (`ref`), or
 * `ref: 'ours'` for text with no Object original. `strings.test.ts` checks each referenced
 * text against docs/strings.txt.
 * The ink (pen group) strings live in `ink/inkStrings.ts` (lane B).
 */
import type { WhiteboardTool } from '@/api/whiteboardTypes'

export interface WbString {
  text: string
  ref: string
}

const s = (text: string, ref: string): WbString => ({ text, ref })

export const WB = {
  // Tools (Whiteboard.tools.*)
  toolMove: s('Move', 'Whiteboard.tools.move'),
  toolHand: s('Hand', 'Whiteboard.tools.hand'),
  toolText: s('Text', 'Whiteboard.tools.text'),
  toolLink: s('Existing object', 'Whiteboard.tools.link'),
  toolCreate: s('New object', 'Whiteboard.tools.create'),
  toolShapes: s('Shapes', 'Whiteboard.tools.shapes'),
  toolCircuit: s('Gates', 'Whiteboard.tools.circuit'),
  toolIo: s('I/O', 'Whiteboard.tools.io'),
  toolFrame: s('Frame', 'Whiteboard.tools.frame'),
  toolLine: s('Line', 'Whiteboard.tools.line'),
  toolArrow: s('Arrow', 'Whiteboard.tools.arrow'),
  toolRectangle: s('Rectangle', 'Whiteboard.tools.rectangle'),
  toolRoundedRectangle: s('Rounded rectangle', 'Whiteboard.tools.roundedRectangle'),
  toolEllipse: s('Ellipse', 'Whiteboard.tools.ellipse'),
  toolDiamond: s('Diamond', 'Whiteboard.tools.diamond'),
  toolParallelogram: s('Parallelogram', 'Whiteboard.tools.parallelogram'),
  toolTriangle: s('Triangle', 'Whiteboard.tools.triangle'),
  toolStar: s('Star', 'Whiteboard.tools.star'),
  toolBubble: s('Bubble', 'Whiteboard.tools.bubble'),
  toolBlockArrow: s('Arrow right', 'Whiteboard.tools.blockArrow'),
  toolHeart: s('Heart', 'Whiteboard.tools.heart'),
  toolNot: s('NOT', 'Whiteboard.tools.not'),
  toolAnd: s('AND', 'Whiteboard.tools.and'),
  toolNand: s('NAND', 'Whiteboard.tools.nand'),
  toolOr: s('OR', 'Whiteboard.tools.or'),
  toolNor: s('NOR', 'Whiteboard.tools.nor'),
  toolXor: s('XOR', 'Whiteboard.tools.xor'),
  toolXnor: s('XNOR', 'Whiteboard.tools.xnor'),
  toolHigh: s('HIGH', 'Whiteboard.tools.high'),
  toolLow: s('LOW', 'Whiteboard.tools.low'),
  toolLock: s('Lock whiteboard', 'Whiteboard.tools.lock'),
  toolUnlock: s('Unlock whiteboard', 'Whiteboard.tools.unlock'),
  toolZoomIn: s('Zoom in', 'Whiteboard.tools.zoomIn'),
  toolZoomOut: s('Zoom out', 'Whiteboard.tools.zoomOut'),
  toolFitSelection: s('Zoom to selection', 'Whiteboard.tools.fitSelection'),
  toolMore: s('More options', 'Whiteboard.tools.more'),
  toolDisplay: s('Canvas display', 'Whiteboard.tools.display'),

  // Canvas display (Whiteboard.display.*)
  displaySnapToGrid: s('Snap to grid', 'Whiteboard.display.snapToGrid'),
  displaySnapToNodes: s('Snap to nodes', 'Whiteboard.display.snapToNodes'),
  displayShowDots: s('Show dots', 'Whiteboard.display.showDots'),
  displayScrollZoom: s('Zoom with scroll wheel', 'Whiteboard.display.scrollZoom'),
  displayEngineeringMode: s('Engineering mode', 'Whiteboard.display.engineeringMode'),

  // Selection controls (Whiteboard.control.*)
  controlColor: s('Color', 'Whiteboard.control.color'),
  controlFill: s('Fill', 'Whiteboard.control.fill'),
  controlAlign: s('Align', 'Whiteboard.control.align'),
  controlTextAlign: s('Text alignment', 'Whiteboard.control.textAlign'),
  controlTextAlignLeft: s('Align text left', 'Whiteboard.control.textAlignLeft'),
  controlTextAlignCenter: s('Align text center', 'Whiteboard.control.textAlignCenter'),
  controlTextAlignRight: s('Align text right', 'Whiteboard.control.textAlignRight'),
  controlFlip: s('Flip', 'Whiteboard.control.flip'),
  controlFlipHorizontal: s('Flip horizontal', 'Whiteboard.control.flipHorizontal'),
  controlFlipVertical: s('Flip vertical', 'Whiteboard.control.flipVertical'),
  controlFront: s('Bring to front', 'Whiteboard.control.front'),
  controlForward: s('Bring forward', 'Whiteboard.control.forward'),
  controlBackward: s('Send backward', 'Whiteboard.control.backward'),
  controlBack: s('Send to back', 'Whiteboard.control.back'),
  controlDuplicate: s('Duplicate', 'Whiteboard.control.duplicate'),
  controlWrapInFrame: s('Wrap in new frame', 'Whiteboard.control.wrapInFrame'),
  controlDelete: s('Delete', 'Whiteboard.control.delete'),
  controlAddLabel: s('Add arrow label', 'Whiteboard.control.addLabel'),
  controlRemoveLabel: s('Remove arrow label', 'Whiteboard.control.removeLabel'),
  controlAddTitle: s('Add frame title', 'Whiteboard.control.addTitle'),
  controlRemoveTitle: s('Remove frame title', 'Whiteboard.control.removeTitle'),

  // Place (Whiteboard.align.*)
  placeLeft: s('Place left', 'Whiteboard.align.left'),
  placeCenter: s('Place center', 'Whiteboard.align.center'),
  placeRight: s('Place right', 'Whiteboard.align.right'),
  placeTop: s('Place top', 'Whiteboard.align.top'),
  placeMiddle: s('Place middle', 'Whiteboard.align.middle'),
  placeBottom: s('Place bottom', 'Whiteboard.align.bottom'),
  placeRow: s('Place in a row', 'Whiteboard.align.row'),
  placeColumn: s('Place in a column', 'Whiteboard.align.column'),
  placeGrid: s('Place in a grid', 'Whiteboard.align.grid'),

  // Connectors
  edgeTipStart: s('Start tip', 'Whiteboard.edgeTips.labelStart'),
  edgeTipEnd: s('End tip', 'Whiteboard.edgeTips.labelEnd'),
  edgeTipNone: s('None', 'Whiteboard.edgeTips.none'),
  edgeTipArrow: s('Arrow', 'Whiteboard.edgeTips.arrow'),
  edgeTipDot: s('Dot', 'Whiteboard.edgeTips.dot'),
  edgeTipDouble: s('Double arrow', 'Whiteboard.edgeTips.double'),
  edgeConnection: s('Connection', 'Whiteboard.edgeConnection.label'),
  edgeConnectionStraight: s('Straight', 'Whiteboard.edgeConnection.straight'),
  edgeConnectionCornered: s('Cornered', 'Whiteboard.edgeConnection.cornered'),
  edgeConnectionCurved: s('Curved', 'Whiteboard.edgeConnection.curved'),
  edgeLine: s('Line', 'Whiteboard.edgeLine.label'),
  edgeLineSolid: s('Solid', 'Whiteboard.edgeLine.solid'),
  edgeLineDashed: s('Dashed', 'Whiteboard.edgeLine.dashed'),
  edgeLineDotted: s('Dotted', 'Whiteboard.edgeLine.dotted'),

  // Empty and lost states
  emptyStateDescription: s('You can change this by creating a new node.', 'Whiteboard.emptyState.description'),
  lostTitle: s('Nothing in this view', 'Whiteboard.lost.title'),
  lostDescription: s("But don't worry, we can just take you back.", 'Whiteboard.lost.description'),
  lostBackToContent: s('Back to content', 'Whiteboard.lost.backToContent'),

  // Clear Whiteboard (EntityMenu.clearWhiteboard.*)
  clearWhiteboard: s('Clear Whiteboard', 'EntityMenu.clearWhiteboard.text'),
  clearWhiteboardHeading: s('Clear this whiteboard?', 'EntityMenu.clearWhiteboard.modal.heading'),
  clearWhiteboardExplanation: s(
    'This removes every object and connector from the canvas. You can undo it.',
    'EntityMenu.clearWhiteboard.modal.explanation',
  ),
  clearWhiteboardConfirm: s('Clear Whiteboard', 'EntityMenu.clearWhiteboard.modal.confirm'),

  // The Whiteboard type (components.RootWhiteboard.*)
  typeName: s('Whiteboard', 'components.RootWhiteboard.name'),
  typePluralName: s('Whiteboards', 'components.RootWhiteboard.pluralName'),
  typeDescription: s('An infinite canvas for arranging blocks and objects', 'components.RootWhiteboard.description'),
  typeCreate: s('Create whiteboard', 'components.RootWhiteboard.create'),
  propCanvas: s('Canvas', 'components.RootWhiteboard.propertyDefinitions.RootWhiteboard_canvas.name'),
  propNotes: s('Notes', 'components.RootWhiteboard.propertyDefinitions.RootWhiteboard_notes.name'),

  // Shortcut names (shortcuts.*.name)
  shortcutSelect: s('Select tool', 'shortcuts.whiteboardSelect.name'),
  shortcutHand: s('Hand tool', 'shortcuts.whiteboardHand.name'),
  shortcutText: s('Text', 'shortcuts.whiteboardText.name'),
  shortcutRectangle: s('Rectangle', 'shortcuts.whiteboardRectangle.name'),
  shortcutEllipse: s('Ellipse', 'shortcuts.whiteboardEllipse.name'),
  shortcutTriangle: s('Triangle', 'shortcuts.whiteboardTriangle.name'),
  shortcutLine: s('Line', 'shortcuts.whiteboardLine.name'),
  shortcutArrow: s('Arrow', 'shortcuts.whiteboardArrow.name'),
  shortcutFrame: s('Frame', 'shortcuts.whiteboardFrame.name'),
  shortcutPan: s('Pan', 'shortcuts.whiteboardPan.name'),
  shortcutZoomIn: s('Zoom in', 'shortcuts.whiteboardZoomIn.name'),
  shortcutZoomOut: s('Zoom out', 'shortcuts.whiteboardZoomOut.name'),
  shortcutZoomReset: s('Zoom to 100%', 'shortcuts.whiteboardZoomReset.name'),
  shortcutFitAll: s('Zoom to fit', 'shortcuts.whiteboardFitAll.name'),
  shortcutFitSelection: s('Zoom to selection', 'shortcuts.whiteboardFitSelection.name'),
  shortcutDuplicate: s('Duplicate selection', 'shortcuts.whiteboardDuplicate.name'),
  shortcutDuplicateDrag: s('Duplicate while dragging', 'shortcuts.whiteboardDuplicateDrag.name'),
  shortcutDisableSnap: s('Disable snapping while dragging', 'shortcuts.whiteboardDisableSnap.name'),
  shortcutNudge: s('Nudge selection', 'shortcuts.whiteboardNudge.name'),
  shortcutNudgeLarge: s('Nudge selection farther', 'shortcuts.whiteboardNudgeLarge.name'),
  shortcutBringToFront: s('Bring to front', 'shortcuts.whiteboardBringToFront.name'),
  shortcutBringForward: s('Bring forward', 'shortcuts.whiteboardBringForward.name'),
  shortcutSendBackward: s('Send backward', 'shortcuts.whiteboardSendBackward.name'),
  shortcutSendToBack: s('Send to back', 'shortcuts.whiteboardSendToBack.name'),
  shortcutFlipHorizontal: s('Flip horizontal', 'shortcuts.whiteboardFlipHorizontal.name'),
  shortcutFlipVertical: s('Flip vertical', 'shortcuts.whiteboardFlipVertical.name'),
  shortcutWrapInFrame: s('Wrap in frame', 'shortcuts.whiteboardWrapInFrame.name'),
  shortcutCycle: s('Cycle selected objects', 'shortcuts.whiteboardCycle.name'),
  shortcutCycleBack: s('Cycle selected objects backward', 'shortcuts.whiteboardCycleBack.name'),
  shortcutUndo: s('Undo last change', 'shortcuts.undo.name'),
  shortcutRedo: s('Redo last change', 'shortcuts.redo.name'),

  // Undo / redo buttons and general
  undo: s('Undo', 'changeStack.undo'),
  redo: s('Redo', 'changeStack.redo'),
  cancel: s('Cancel', 'general.cancel'),
  delete: s('Delete', 'general.delete'),
  deleteObject: s('Delete', 'EntityMenu.delete'),

  // Ours: no Object original
  readOnly: s("This whiteboard file has content Object can't read, so it opens read-only.", 'ours'),
  newerVersion: s('This whiteboard was saved by a newer version of Object.', 'ours'),
  changedElsewhere: s('Changed elsewhere. Reloaded.', 'ours'),
  searchObjects: s('Search objects', 'ours'),
  pickType: s('Pick a type', 'ours'),
} as const satisfies Record<string, WbString>

export type WbKey = keyof typeof WB

/** The text of a whiteboard string. */
export function t(key: WbKey): string {
  return WB[key].text
}

/** Tool labels by tool id, for the toolbox and menus. */
export const TOOL_LABEL = {
  select: WB.toolMove,
  hand: WB.toolHand,
  text: WB.toolText,
  link: WB.toolLink,
  create: WB.toolCreate,
  line: WB.toolLine,
  arrow: WB.toolArrow,
  rectangle: WB.toolRectangle,
  roundedRectangle: WB.toolRoundedRectangle,
  ellipse: WB.toolEllipse,
  diamond: WB.toolDiamond,
  triangle: WB.toolTriangle,
  // No reference label for the two shapes kept only for existing boards; they are never in a menu.
  triangleDown: WB.toolTriangle,
  star: WB.toolStar,
  parallelogram: WB.toolParallelogram,
  bubble: WB.toolBubble,
  blockArrow: WB.toolBlockArrow,
  blockArrowLeft: WB.toolBlockArrow,
  heart: WB.toolHeart,
  not: WB.toolNot,
  and: WB.toolAnd,
  nand: WB.toolNand,
  or: WB.toolOr,
  nor: WB.toolNor,
  xor: WB.toolXor,
  xnor: WB.toolXnor,
  high: WB.toolHigh,
  low: WB.toolLow,
  frame: WB.toolFrame,
} as const satisfies Record<WhiteboardTool, WbString>
