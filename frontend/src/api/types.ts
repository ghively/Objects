// TS mirrors of the back end's JSON (Task 3 dataclasses, Task 4 routes, Task 5 events).
// Field names match the Python side exactly.

export type PropertyKind =
  | 'text'
  | 'number'
  | 'boolean'
  | 'url'
  | 'datetime'
  | 'label'
  | 'entity'
  | 'blocks'

export interface PropertyDef {
  id: string
  key: string
  name: string
  type: PropertyKind
  isArray: boolean
}

export interface TypeDef {
  id: string
  name: string
  pluralName: string
  folder: string
  icon: string
  color: string
  propertyDefinitions: PropertyDef[]
}

export interface ObjectSummary {
  path: string
  id: string | null
  type: string
  title: string
  icon: string | null
  createdAt: string | null
  lastUpdated: string | null
  tags: string[]
  readOnly: boolean
}

/** GET /api/space */
export interface SpaceInfo {
  name: string
  root: string
  types: TypeDef[]
}

/** GET /api/object?path= */
export interface ObjectDetail {
  summary: ObjectSummary
  frontmatter: Record<string, unknown>
  body: string
  version: string
}

/** PUT /api/object/body → 200 */
export interface SaveResult {
  version: string
}

/** SSE event `change` on GET /api/events */
export interface ChangeEvent {
  kind: 'created' | 'changed' | 'deleted'
  path: string
  version: string | null
}
