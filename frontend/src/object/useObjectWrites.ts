/**
 * Serialized writes for one object: property edits and title renames go through one promise
 * queue that first flushes the body editor, so a body save and a property write never race.
 *
 * Each queued write, in order:
 *  1. awaits `bodyControl.flush()`; `{ok: false}` means the body save hit a conflict
 *  2. if not ok, stops: the write stays queued and nothing is sent (`onConflict` already ran,
 *     from the body save)
 *  3. sends with `versionRef.current`
 *  4. calls `adoptVersion(v)` and `bodyControl.resume(v)`
 *  5. hands the result to `onUpdated` / `onRenamed` (the view merges `frontmatter` and `links`)
 *
 * A 409 on the write itself calls `onConflict` and stops the queue too. Once the owner has
 * resolved the conflict (reload, or keep mine) it calls `replay()`, and the queued writes are
 * sent again on the resolved version; they are key-level, so replaying them is safe.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react'
import { api, ConflictError } from '@/api/client'
import type { RenameResult, UpdateResult } from '@/api/types'
import { taskClient } from '@/tasks/taskContract'

export interface BodyControl {
  /** Save pending body edits and wait for every save in flight; `ok: false` after a conflict. */
  flush(): Promise<{ ok: boolean }>
  /** Adopt `version` as the base of the next body save. */
  resume(version: string): void | Promise<void>
}

export interface ObjectWritesOptions {
  path: string
  /** The version the next write is based on (shared with the body editor). */
  versionRef: MutableRefObject<string>
  bodyControl: BodyControl
  adoptVersion(version: string): void
  /** A write was rejected with 409: reconcile, then call `replay()`. */
  onConflict(currentVersion: string): void
  /** A property write succeeded: merge `res.frontmatter` and `res.links`, drop `remove`. */
  onUpdated?(res: UpdateResult, updates: Record<string, unknown>, remove: string[]): void
  /** A rename to `title` succeeded (`res.path` may differ from `oldPath`, or not). */
  onRenamed?(res: RenameResult, oldPath: string, title: string): void
  /** A write failed for another reason (read-only, invalid value, gone). */
  onError?(err: unknown): void
}

export interface ObjectWrites {
  /** Set (or clear with `null`) properties; `remove` deletes keys. Resolves null when it failed. */
  updateProperties(updates: Record<string, unknown>, remove?: string[]): Promise<UpdateResult | null>
  /** M8: set (or clear with `null`) the reminder of date property `key` (`PUT /api/tasks/reminder`). */
  setReminder(key: string, remind: string | null): Promise<UpdateResult | null>
  /** Retitle the object (renames its file and relinks). Resolves null when it failed. */
  rename(title: string): Promise<RenameResult | null>
  /** The conflict that stopped the queue is resolved: send the queued writes again. */
  replay(): void
  /** How many writes are queued (including one in flight). */
  pending(): number
}

interface Op {
  path: string
  run(path: string, baseVersion: string): Promise<unknown>
  resolve(v: unknown): void
}

export function useObjectWrites(opts: ObjectWritesOptions): ObjectWrites {
  const optsRef = useRef(opts)
  useLayoutEffect(() => {
    optsRef.current = opts
  })

  const opsRef = useRef<Op[]>([])
  const runningRef = useRef(false)
  const blockedRef = useRef(false)
  /** The object's path as the queue knows it: follows our own renames before the parent re-renders. */
  const pathRef = useRef(opts.path)

  // Another object is shown (not one of our renames): drop what was queued for the old one.
  useEffect(() => {
    if (opts.path === pathRef.current) return
    pathRef.current = opts.path
    for (const op of opsRef.current.splice(0)) op.resolve(null)
    blockedRef.current = false
  }, [opts.path])

  const process = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    try {
      while (opsRef.current.length > 0 && !blockedRef.current) {
        const op = opsRef.current[0]
        const o = optsRef.current
        const { ok } = await o.bodyControl.flush()
        if (!ok) {
          blockedRef.current = true
          break
        }
        try {
          const res = await op.run(op.path, o.versionRef.current)
          opsRef.current.shift()
          op.resolve(res)
        } catch (err) {
          if (err instanceof ConflictError) {
            blockedRef.current = true
            optsRef.current.onConflict(err.currentVersion)
            break
          }
          opsRef.current.shift()
          op.resolve(null)
          const onError = optsRef.current.onError
          if (onError) onError(err)
          else console.error('write failed', err)
        }
      }
    } finally {
      runningRef.current = false
    }
  }, [])

  const enqueue = useCallback(
    <T>(run: (path: string, baseVersion: string) => Promise<T>): Promise<T | null> =>
      new Promise<T | null>((resolve) => {
        opsRef.current.push({ path: pathRef.current, run, resolve: resolve as (v: unknown) => void })
        void process()
      }),
    [process],
  )

  const updateProperties = useCallback(
    (updates: Record<string, unknown>, remove: string[] = []) =>
      enqueue(async (path, baseVersion) => {
        const res = await api.updateProperties(path, updates, baseVersion, remove.length ? remove : undefined)
        const o = optsRef.current
        o.adoptVersion(res.version)
        void o.bodyControl.resume(res.version)
        o.onUpdated?.(res, updates, remove)
        return res
      }),
    [enqueue],
  )

  const setReminder = useCallback(
    (key: string, remind: string | null) =>
      enqueue(async (path, baseVersion) => {
        const res = await taskClient.setReminder(path, key, remind, { baseVersion })
        const o = optsRef.current
        o.adoptVersion(res.version)
        void o.bodyControl.resume(res.version)
        // The result carries the whole frontmatter: no `reminders` means the last entry went.
        o.onUpdated?.(res, {}, res.frontmatter && !('reminders' in res.frontmatter) ? ['reminders'] : [])
        return res
      }),
    [enqueue],
  )

  const rename = useCallback(
    (title: string) =>
      enqueue(async (path, baseVersion) => {
        const res = await api.renameObject(path, title, baseVersion)
        // Writes queued behind the rename go to the new path.
        pathRef.current = res.path
        for (const op of opsRef.current) if (op.path === path) op.path = res.path
        const o = optsRef.current
        o.adoptVersion(res.version)
        void o.bodyControl.resume(res.version)
        o.onRenamed?.(res, path, title)
        return res
      }),
    [enqueue],
  )

  const replay = useCallback(() => {
    blockedRef.current = false
    void process()
  }, [process])

  const pending = useCallback(() => opsRef.current.length, [])

  return { updateProperties, setReminder, rename, replay, pending }
}
