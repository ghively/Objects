/**
 * jsdom stubs React Flow needs (call `installFlowEnv()` in a test file's `beforeAll`, or import
 * for its side effect via `import '@/whiteboard/test/flowEnv'`, which installs once).
 * `ResizeObserver` is already stubbed by `src/test/setup.ts`.
 */

class DOMMatrixReadOnlyStub {
  m22: number
  a: number
  d: number
  e: number
  f: number
  constructor(transform?: string) {
    const scale = /scale\(([-\d.e]+)\)/.exec(transform ?? '')?.[1]
    const translate = /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/.exec(transform ?? '')
    const k = scale !== undefined ? Number(scale) : 1
    this.a = k
    this.d = k
    this.m22 = k
    this.e = translate ? Number(translate[1]) : 0
    this.f = translate ? Number(translate[2]) : 0
  }
}

let installed = false

export function installFlowEnv(size = { width: 1280, height: 800 }): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  const g = globalThis as unknown as Record<string, unknown>
  g.DOMMatrixReadOnly ??= DOMMatrixReadOnlyStub
  Object.defineProperties(window.HTMLElement.prototype, {
    offsetWidth: { configurable: true, get: () => size.width },
    offsetHeight: { configurable: true, get: () => size.height },
    clientWidth: { configurable: true, get: () => size.width },
    clientHeight: { configurable: true, get: () => size.height },
  })
  const proto = (window as unknown as { SVGElement: { prototype: Record<string, unknown> } }).SVGElement.prototype
  proto.getBBox ??= () => ({ x: 0, y: 0, width: 0, height: 0 })
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, left: 0, top: 0, right: size.width, bottom: size.height, width: size.width, height: size.height, toJSON: () => ({}) } as DOMRect
  }
}

installFlowEnv()
