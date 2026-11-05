/**
 * M10: the writes an AI chat makes, each only on the user's click, through the normal object-write
 * calls with the object's version (so "never write on read", version checks and CRLF/BOM rules
 * hold). Each reads the object, writes with its version, and on a 409 reads it again and retries
 * once.
 */
import { api, ConflictError } from '@/api/client'
import { ensureNewTags } from '@/object/ObjectHeader'
import { appendToBody, ensureDailyNote } from '@/palette/paste'

/** Run `write` with a fresh read; on `ConflictError` read again and run it once more. */
async function withRetry<T>(path: string, write: (body: string, frontmatter: Record<string, unknown>, tags: string[], version: string) => Promise<T>): Promise<T> {
  const run = async () => {
    const d = await api.object(path)
    return write(d.body, d.frontmatter ?? {}, d.summary?.tags ?? [], d.version)
  }
  try {
    return await run()
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e
    return run()
  }
}

/** Append `text` to the body of the object at `path` (after one blank line). */
export function appendToObject(path: string, text: string): Promise<void> {
  return withRetry(path, async (body, _fm, _tags, version) => {
    await api.saveBody(path, appendToBody(body, text), version)
  })
}

/** Append `text` to today's daily note (created when there is none); resolves with its path. */
export async function appendToTodaysNote(text: string): Promise<string> {
  const path = await ensureDailyNote()
  await appendToObject(path, text)
  return path
}

/** Add `tags` to the object's tags (the union, its own first; case-insensitive). */
export function addTags(path: string, tags: readonly string[]): Promise<void> {
  return withRetry(path, async (_body, _fm, current, version) => {
    const seen = new Set(current.map((t) => t.toLowerCase()))
    const next = [...current]
    for (const t of tags) {
      const name = t.trim()
      if (!name || seen.has(name.toLowerCase())) continue
      seen.add(name.toLowerCase())
      next.push(name)
    }
    if (next.length === current.length) return
    ensureNewTags(current, next)
    await api.updateProperties(path, { tags: next }, version)
  })
}

/** Set only the given properties of the object. */
export function setProperties(path: string, values: Record<string, unknown>): Promise<void> {
  return withRetry(path, async (_body, _fm, _tags, version) => {
    if (Object.keys(values).length === 0) return
    await api.updateProperties(path, values, version)
  })
}
