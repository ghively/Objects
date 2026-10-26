const objectToString: typeof Object.prototype.toString = Object.prototype.toString

/**
 * Returns the type string of a given value.
 *
 * @param value - The value to get the type string of.
 * @returns The type string of the value.
 */
const toTypeString = (value: unknown): string => objectToString.call(value)

/**
 * Checks if a value is a plain object.
 *
 * @param val - The value to check.
 * @returns True if the value is a plain object, false otherwise.
 */
const isPlainObject = (val: unknown): val is object => toTypeString(val) === '[object Object]'

export type Delta = {
  type: 'set' | 'delete'
  path: string[]
  value: unknown
  previous: unknown
}

/**
 * Computes the difference between two objects.
 *
 * @param current - The current object.
 * @param update - The updated object.
 * @param path - The path to the current property (used internally).
 * @returns An array of Delta objects representing the differences.
 */
export function diff<T extends object>(current: T, update: T, path: string[] = []): Delta[] {
  const deltas: Delta[] = []

  const keys = new Set([...Object.keys(current), ...Object.keys(update)])

  for (const key of keys) {
    const position = [...path, key]
    const previous = current[key as keyof T]
    const value = update[key as keyof T]

    if (previous === value) continue
    else if (typeof previous === 'undefined' && typeof value !== 'undefined') {
      deltas.push({ type: 'set', path: position, value, previous })
    } else if (typeof previous !== 'undefined' && typeof value === 'undefined') {
      deltas.push({ type: 'delete', path: position, value, previous })
      continue
    } else if (isPlainObject(previous) && isPlainObject(value)) {
      deltas.push(...diff(previous, value, position))
      continue
    } else if (Array.isArray(previous) && Array.isArray(value)) {
      deltas.push(...diff({ ...previous }, { ...value }, position))
      continue
    } else if (previous instanceof Map && value instanceof Map) {
      deltas.push(...diff(Object.fromEntries(previous), Object.fromEntries(value), position))
      continue
    } else if (previous instanceof Set && value instanceof Set) {
      deltas.push({
        type: 'set',
        path: position,
        value: new Set(Object.values(apply(Array.from(previous), diff(Array.from(previous), Array.from(value))))),
        previous,
      })
      continue
    } else if (typeof previous !== typeof value) {
      deltas.push({ type: 'set', path: position, value, previous })
      continue
    } else if (previous !== value) {
      deltas.push({ type: 'set', path: position, value, previous })
      continue
    }
  }

  return deltas
}

/**
 * Applies a series of deltas to an object.
 *
 * @param current - The current object.
 * @param deltas - The deltas to apply.
 * @returns A new object with the deltas applied.
 */
export function apply<T extends object>(current: T, ...deltas: Delta[][]): T {
  const copy = { ...current }

  deltas.flat(1).forEach(({ type, path, value }) => {
    const last = path.at(-1)
    if (!last) return

    let target = copy

    for (const key of path.slice(0, -1)) {
      const _key = key as keyof typeof target
      if (typeof target[_key] === 'undefined') throw new Error('Path does not exist')
      target = target[_key] as typeof target
    }

    if (target instanceof Map) {
      if (type === 'set') target.set(last, value)
      else if (type === 'delete') target.delete(last)
    } else {
      if (type === 'set') target[last as keyof typeof target] = value as (typeof target)[keyof typeof target]
      else if (type === 'delete') delete target[last as keyof typeof target]
    }
  })

  return copy
}
