import { describe, expect, test } from 'vitest'
import { flushAll, registerFlusher } from './flush'

describe('flush', () => {
  test('test flushAll awaits every flusher and reports errors after all ran', async () => {
    const ran: string[] = []
    const offs = [
      registerFlusher(async () => {
        await new Promise((r) => setTimeout(r, 10))
        ran.push('slow')
      }),
      registerFlusher(async () => {
        ran.push('bad')
        throw new Error('save failed')
      }),
      registerFlusher(async () => {
        ran.push('fast')
      }),
    ]
    await expect(flushAll()).rejects.toThrow('save failed')
    expect(ran.sort()).toEqual(['bad', 'fast', 'slow'])
    offs.forEach((off) => off())
  })

  test('two errors are reported together; unregistered flushers do not run', async () => {
    const ran: string[] = []
    const a = registerFlusher(async () => {
      throw new Error('a')
    })
    const b = registerFlusher(async () => {
      throw new Error('b')
    })
    const c = registerFlusher(async () => {
      ran.push('c')
    })
    c()
    const err = await flushAll().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AggregateError)
    expect((err as AggregateError).errors.map((e: Error) => e.message)).toEqual(['a', 'b'])
    expect(ran).toEqual([])
    a()
    b()
    await expect(flushAll()).resolves.toBeUndefined()
  })
})
