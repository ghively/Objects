export interface Serializer<Values = unknown> {
  /*
   * Serialize any given value.
   *
   * @param {Values} value - The value to serialize.
   * @returns {string} The serialized value as a string.
   */
  serialize: (value: Values) => string

  /*
   * Deserialize a string.
   *
   * @param {string} value - The value to deserialize.
   * @returns {Values} The deserialized value.
   */
  deserialize: (value: string) => Values
  [key: string]: unknown
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Primitive<Type, Values = any> = {
  is: (v: unknown) => boolean
  stringify: (v: Type, serializer: Serializer<Values>) => string
  parse: (v: string, serializer: Serializer<Values>) => Type
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Primitives = Record<string, Primitive<any>>

type N = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

type Extract<T extends Primitives> = {
  [K in keyof T]: T[K] extends Primitive<infer U> ? U : never
}[keyof T]

export type ValuesOf<
  T extends Primitives,
  Depth extends N[number] | 0 = 10,
  Level extends N[number] | 0 = 0,
> = Extract<{
  [K in keyof T]: T[K] extends Primitive<infer U>
    ? U extends Array<Primitives>
      ? Level extends Depth
        ? Primitive<Array<unknown>>
        : Primitive<Array<ValuesOf<T, Depth, NonNullable<N[Level]>>>>
      : U extends Map<Primitives, Primitives>
        ? Level extends Depth
          ? Primitive<Map<unknown, unknown>>
          : Primitive<Map<ValuesOf<T, Depth, NonNullable<N[Level]>>, ValuesOf<T, Depth, NonNullable<N[Level]>>>>
        : U extends Set<Primitives>
          ? Level extends Depth
            ? Primitive<Set<unknown>>
            : Primitive<Set<ValuesOf<T, Depth, NonNullable<N[Level]>>>>
          : U extends Record<string, Primitives>
            ? Level extends Depth
              ? Primitive<Record<string, unknown>>
              : Primitive<Record<string, ValuesOf<T, Depth, NonNullable<N[Level]>>>>
            : T[K]
    : never
}>

export class PrimitiveSerializer<P extends Primitives, Depth extends N[number] | 0 = 10> implements Serializer<
  ValuesOf<P, Depth>
> {
  primitives: P

  /*
   * Serialize any given value.
   *
   * @param {ValuesOf<P, Depth>} value - The value to serialize.
   * @returns {string} The serialized value as a string.
   */
  serialize(value: ValuesOf<P, Depth>): string {
    const entry = Object.entries(this.primitives).find(([_, { is: is }]) => is(value))
    if (!entry) throw new Error('No serializer found')

    const type = entry[0]
    const string = entry[1].stringify(value, {
      serialize: (value: ValuesOf<P, Depth>) => this.serialize(value),
      deserialize: (value: string) => this.deserialize(value),
    })

    return `${type}:${string}`
  }

  /*
   * Deserialize a string.
   *
   * @param {string} value - The value to deserialize.
   * @returns {ValuesOf<P, Depth>} The deserialized value.
   */
  deserialize(value: string): ValuesOf<P, Depth> {
    const index = value.indexOf(':')
    if (index === -1) throw new Error('No type found')

    const type = value.slice(0, index)
    const string = value.slice(index + 1)

    if ('type' in this.primitives) throw new Error(`Unknown type: ${type}`)

    const result = this.primitives[type as keyof typeof this.primitives].parse(string, {
      serialize: (value: ValuesOf<P, Depth>) => this.serialize(value),
      deserialize: (value: string) => this.deserialize(value),
    })

    const entry = Object.entries(this.primitives).find(([_, { is: is }]) => is(result))
    if (!entry) throw new Error('No serializer found')

    if (entry[0] !== type) throw new Error('Type mismatch')

    return result
  }

  constructor(primitives: P) {
    this.primitives = primitives
  }

  [key: string]: unknown
}

export class PseudoSerializer implements Serializer<ValuesOf<typeof primitives>> {
  serialize: (value: ValuesOf<typeof primitives>) => string = (_value) => {
    return ''
  }
  deserialize: (value: string) => ValuesOf<typeof primitives> = (_value) => {
    return undefined
  };

  [key: string]: unknown
}

export function define<T>(entry: Primitive<T>): Primitive<T> {
  return entry
}

export const primitives = Object.freeze({
  null: define<null>({
    is: (v) => v === null,
    stringify: () => '',
    parse: () => null,
  }),

  undefined: define<undefined>({
    is: (v) => v === undefined,
    stringify: () => '',
    parse: () => undefined,
  }),

  set: define<Set<Primitives>>({
    is: (v) => v instanceof Set,
    stringify: (v, { serialize }) => JSON.stringify(Array.from(v, serialize)),
    parse: (v, { deserialize }) => new Set(JSON.parse(v).map(deserialize)),
  }),

  map: define<Map<Primitives, Primitives>>({
    is: (v) => v instanceof Map,
    stringify: (v, { serialize }) => JSON.stringify(Array.from(v, ([key, v]) => [key, serialize(v)])),
    parse: (v, { deserialize }) => new Map(JSON.parse(v).map(([key, v]: [string, string]) => [key, deserialize(v)])),
  }),

  date: define<Date>({
    is: (v) => v instanceof Date,
    stringify: (v) => v.toISOString(),
    parse: (v) => new Date(v),
  }),

  url: define<URL>({
    is: (v) => v instanceof URL,
    stringify: (v) => v.toString(),
    parse: (v) => new URL(v),
  }),

  bigint: define<bigint>({
    is: (v) => typeof v === 'bigint',
    stringify: (v) => String(v),
    parse: (v) => BigInt(v),
  }),

  boolean: define<boolean>({
    is: (v) => typeof v === 'boolean',
    stringify: (v) => String(v),
    parse: (v) => v === 'true',
  }),

  string: define<string>({
    is: (v) => typeof v === 'string',
    stringify: (v) => String(v),
    parse: (v) => String(v),
  }),

  number: define<number>({
    is: (v) => typeof v === 'number',
    stringify: (v) => String(v),
    parse: (v) => Number(v),
  }),

  array: define<Array<Primitives>>({
    is: (v) => Array.isArray(v),
    stringify: (v, { serialize }) => JSON.stringify(v.map(serialize)),
    parse: (v, { deserialize }) => JSON.parse(v).map(deserialize),
  }),

  // regex: define<RegExp>({
  //   is: (v) => v instanceof RegExp,
  //   read: (v) => {
  //     const match = v.match(/\/(.*)\/(.*)/)
  //     if (!match) throw new Error('Invalid RegExp')
  //     return new RegExp(match[1], match[2])
  //   },
  //   write: (v) => v.toString(),
  // }),

  // function: define<Function>({
  //   is: (v) => typeof v === 'function',
  //   read: (v) => eval(`(${v})`),
  //   write: (v) => v.toString(),
  // }),

  object: define<Record<string, Primitives>>({
    is: (v) => v !== null && typeof v === 'object',
    stringify: (v, { serialize }) =>
      JSON.stringify(
        v,
        (key, current) => {
          if (key.length === 0) return v
          return serialize(current)
        },
        0
      ),
    parse: (v, { deserialize }) =>
      JSON.parse(v, (_, current) => {
        if (typeof current !== 'string') return current
        return deserialize(current)
      }),
  }),
}) satisfies Primitives
