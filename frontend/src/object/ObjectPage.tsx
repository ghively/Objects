import { ObjectView } from './ObjectView'

/** An object opened as a full page in the main panel. */
export function ObjectPage({ path }: { path: string }) {
  return <ObjectView key={path} path={path} mode="page" />
}
