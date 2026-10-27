/**
 * The canvas connectors (Task 11): `edgeTypes` maps React Flow's `connector` edge type to
 * `ConnectorEdge`, and `MarkerDefs` renders the tip definitions once per board. Export names and
 * prop types are fixed by `canvasTypes.ts`.
 */
import type { EdgeTypes } from '../canvasTypes'
import { ConnectorEdge } from './ConnectorEdge'

export const edgeTypes: EdgeTypes = { connector: ConnectorEdge }

export { MarkerDefs } from './Markers'
export { ConnectorEdge } from './ConnectorEdge'
export { EdgeLabel } from './EdgeLabel'
export { edgeColor, markerIds, pathFor, strokeFor } from './connectorStyle'
