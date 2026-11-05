// M12: the `files` kind's values: space-relative paths under `Attachments/`.

/** A path's file name (`Attachments/a.pdf` → `a.pdf`). */
export const fileName = (path: string): string => path.split(/[\\/]/).pop() || path

/** A files value as a list of paths, whatever was sent (null, one path, a list). */
export function filePaths(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((p): p is string => typeof p === 'string' && p.trim() !== '')
  return typeof value === 'string' && value.trim() !== '' ? [value] : []
}
