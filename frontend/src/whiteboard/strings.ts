/**
 * Every UI string the whiteboard canvas uses; `ours: true` marks text of our own.
 * The ink (pen group) strings live in `ink/inkStrings.ts` (lane B).
 */
import type { WhiteboardTool } from '@/api/whiteboardTypes'

export interface WbString {
  text: string
  ours?: true
}

const s = (text: string, ours?: true): WbString => (ours ? { text, ours } : { text })

export const WB = {
  // Tools
  toolMove: s('Move'),
  toolHand: s('Hand'),
  toolText: s('Text'),
  toolLink: s('Existing object'),
  toolCreate: s('New object'),
  toolImage: s('Image'),
  toolPdf: s('PDF'),
  toolAudio: s('Audio'),
  toolFile: s('File'),
  toolWeblink: s('Web link'),
  toolMedia: s('Media'),
  toolShapes: s('Shapes'),
  toolCircuit: s('Gates'),
  toolIo: s('I/O'),
  toolFrame: s('Frame'),
  toolLine: s('Line'),
  toolArrow: s('Arrow'),
  toolRectangle: s('Rectangle'),
  toolRoundedRectangle: s('Rounded rectangle'),
  toolEllipse: s('Ellipse'),
  toolDiamond: s('Diamond'),
  toolParallelogram: s('Parallelogram'),
  toolTriangle: s('Triangle'),
  toolStar: s('Star'),
  toolBubble: s('Bubble'),
  toolBlockArrow: s('Arrow right'),
  toolHeart: s('Heart'),
  toolNot: s('NOT'),
  toolAnd: s('AND'),
  toolNand: s('NAND'),
  toolOr: s('OR'),
  toolNor: s('NOR'),
  toolXor: s('XOR'),
  toolXnor: s('XNOR'),
  toolHigh: s('HIGH'),
  toolLow: s('LOW'),
  toolLock: s('Lock whiteboard'),
  toolUnlock: s('Unlock whiteboard'),
  toolZoomIn: s('Zoom in'),
  toolZoomOut: s('Zoom out'),
  toolFitSelection: s('Zoom to selection'),
  toolMore: s('More options'),
  toolDisplay: s('Canvas display'),

  // Canvas display
  displaySnapToGrid: s('Snap to grid'),
  displaySnapToNodes: s('Snap to nodes'),
  displayShowDots: s('Show dots'),
  displayScrollZoom: s('Zoom with scroll wheel'),
  displayEngineeringMode: s('Engineering mode'),

  // Selection controls
  controlColor: s('Color'),
  controlFill: s('Fill'),
  controlAlign: s('Align'),
  controlTextAlign: s('Text alignment'),
  controlTextAlignLeft: s('Align text left'),
  controlTextAlignCenter: s('Align text center'),
  controlTextAlignRight: s('Align text right'),
  controlFlip: s('Flip'),
  controlFlipHorizontal: s('Flip horizontal'),
  controlFlipVertical: s('Flip vertical'),
  controlFront: s('Bring to front'),
  controlForward: s('Bring forward'),
  controlBackward: s('Send backward'),
  controlBack: s('Send to back'),
  controlDuplicate: s('Duplicate'),
  controlWrapInFrame: s('Wrap in new frame'),
  controlDelete: s('Delete'),
  controlAddLabel: s('Add arrow label'),
  controlRemoveLabel: s('Remove arrow label'),
  controlAddTitle: s('Add frame title'),
  controlRemoveTitle: s('Remove frame title'),
  controlView: s('View'),

  // The entity node View menu (M8): M7's four views
  viewInline: s('Link block'),
  viewSmallCard: s('Small card'),
  viewWideCard: s('Wide card'),
  viewEmbed: s('Embed'),

  // Quick-create on a connector drop (M8; "Link {name}" is a template: QUICK_CREATE_LINK_TYPED below)
  quickCreateObjects: s('Objects'),
  quickCreateCreateObject: s('Create Object'),
  quickCreateLinkObject: s('Link Object'),
  quickCreateShapes: s('Shapes'),
  quickCreateNone: s('Nothing'),
  quickCreateDiscard: s('Remove'),

  // Place
  placeLeft: s('Place left'),
  placeCenter: s('Place center'),
  placeRight: s('Place right'),
  placeTop: s('Place top'),
  placeMiddle: s('Place middle'),
  placeBottom: s('Place bottom'),
  placeRow: s('Place in a row'),
  placeColumn: s('Place in a column'),
  placeGrid: s('Place in a grid'),

  // Connectors
  edgeTipStart: s('Start tip'),
  edgeTipEnd: s('End tip'),
  edgeTipNone: s('None'),
  edgeTipArrow: s('Arrow'),
  edgeTipDot: s('Dot'),
  edgeTipDouble: s('Double arrow'),
  edgeConnection: s('Connection'),
  edgeConnectionStraight: s('Straight'),
  edgeConnectionCornered: s('Cornered'),
  edgeConnectionCurved: s('Curved'),
  edgeLine: s('Line'),
  edgeLineSolid: s('Solid'),
  edgeLineDashed: s('Dashed'),
  edgeLineDotted: s('Dotted'),

  // The web link input (M8)
  weblinkHeading: s('Add link'),
  weblinkPlaceholder: s('Paste URL'),
  weblinkTitle: s('Title'),
  weblinkAdd: s('Add'),
  weblinkInvalid: s('Invalid URL format'),

  // Empty and lost states
  emptyStateDescription: s('You can change this by creating a new node.'),
  lostTitle: s('Nothing in this view'),
  lostDescription: s("But don't worry, we can just take you back."),
  lostBackToContent: s('Back to content'),

  // Clear Whiteboard
  clearWhiteboard: s('Clear Whiteboard'),
  clearWhiteboardHeading: s('Clear this whiteboard?'),
  clearWhiteboardExplanation: s(
    'This removes every object and connector from the canvas. You can undo it.',
  ),
  clearWhiteboardConfirm: s('Clear Whiteboard'),

  // The Whiteboard type
  typeName: s('Whiteboard'),
  typePluralName: s('Whiteboards'),
  typeDescription: s('An infinite canvas for arranging blocks and objects'),
  typeCreate: s('Create whiteboard'),
  propCanvas: s('Canvas'),
  propNotes: s('Notes'),

  // Shortcut names
  shortcutSelect: s('Select tool'),
  shortcutHand: s('Hand tool'),
  shortcutText: s('Text'),
  shortcutRectangle: s('Rectangle'),
  shortcutEllipse: s('Ellipse'),
  shortcutTriangle: s('Triangle'),
  shortcutLine: s('Line'),
  shortcutArrow: s('Arrow'),
  shortcutFrame: s('Frame'),
  shortcutPan: s('Pan'),
  shortcutZoomIn: s('Zoom in'),
  shortcutZoomOut: s('Zoom out'),
  shortcutZoomReset: s('Zoom to 100%'),
  shortcutFitAll: s('Zoom to fit'),
  shortcutFitSelection: s('Zoom to selection'),
  shortcutDuplicate: s('Duplicate selection'),
  shortcutDuplicateDrag: s('Duplicate while dragging'),
  shortcutDisableSnap: s('Disable snapping while dragging'),
  shortcutNudge: s('Nudge selection'),
  shortcutNudgeLarge: s('Nudge selection farther'),
  shortcutBringToFront: s('Bring to front'),
  shortcutBringForward: s('Bring forward'),
  shortcutSendBackward: s('Send backward'),
  shortcutSendToBack: s('Send to back'),
  shortcutFlipHorizontal: s('Flip horizontal'),
  shortcutFlipVertical: s('Flip vertical'),
  shortcutWrapInFrame: s('Wrap in frame'),
  shortcutResize: s('Resize selection'),
  shortcutResizeDescription: s('Grows or shrinks from the right or bottom edge'),
  shortcutResizeLarge: s('Resize selection farther'),
  shortcutCycle: s('Cycle selected objects'),
  shortcutCycleBack: s('Cycle selected objects backward'),
  shortcutUndo: s('Undo last change'),
  shortcutRedo: s('Redo last change'),

  // Undo / redo buttons and general
  undo: s('Undo'),
  redo: s('Redo'),
  cancel: s('Cancel'),
  delete: s('Delete'),
  deleteObject: s('Delete'),
  versionHistory: s('Version History'),

  // The floating inspector (M8); the Stats rows are our choice of stats
  inspectorOutline: s('Outline'),
  inspectorFrames: s('Frames'),
  inspectorStats: s('Stats'),
  inspectorEmptyOutline: s('No headings in this page'),
  inspectorEmptyFrames: s('No frames on this whiteboard'),
  inspectorPin: s('Pin'),
  inspectorUnpin: s('Unpin'),
  statText: s('Text'),
  statObjects: s('Objects'),
  statMedia: s('Media'),
  statShapes: s('Shapes'),
  statFrames: s('Frames'),
  statWords: s('Words'),

  // The board presentation (M8)
  controlPlay: s('Play'),
  controlPagePrev: s('Previous page'),
  controlPageNext: s('Next page'),
  presentationExit: s('Exit presentation'),

  // Ours
  readOnly: s("This whiteboard file has content Object can't read, so it opens read-only.", true),
  newerVersion: s('This whiteboard was saved by a newer version of Object.', true),
  changedElsewhere: s('Changed elsewhere. Reloaded.', true),
  saveFailed: s('Could not save the whiteboard.', true),
  searchObjects: s('Search objects', true),
  pickType: s('Pick a type', true),
  // M8: the per-node lock
  nodeLock: s('Lock', true),
  nodeUnlock: s('Unlock', true),
  nodeLocked: s('Locked', true),
  // M8: the floating inspector's toggle and the Stats rows of our own
  inspector: s('Inspector', true),
  statWeblinks: s('Web links', true),
  statConnectors: s('Connectors', true),
  statStrokes: s('Ink strokes', true),
} as const satisfies Record<string, WbString>

/** "Link {name}", filled with a type's name. */
export const QUICK_CREATE_LINK_TYPED = { text: 'Link {name}' } as const
export function quickCreateLinkTyped(name: string): string {
  return QUICK_CREATE_LINK_TYPED.text.replace('{name}', name)
}

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
  image: WB.toolImage,
  pdf: WB.toolPdf,
  audio: WB.toolAudio,
  file: WB.toolFile,
  weblink: WB.toolWeblink,
  line: WB.toolLine,
  arrow: WB.toolArrow,
  rectangle: WB.toolRectangle,
  roundedRectangle: WB.toolRoundedRectangle,
  ellipse: WB.toolEllipse,
  diamond: WB.toolDiamond,
  triangle: WB.toolTriangle,
  // No label of their own for the two shapes kept only for existing boards; they are never in a menu.
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
