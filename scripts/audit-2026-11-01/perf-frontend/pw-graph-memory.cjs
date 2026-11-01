const { chromium } = require('playwright')
const port = process.argv[2] || '8800'
const base = `http://127.0.0.1:${port}`
;(async () => {
  const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] })
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const page = await ctx.newPage()
  let workers = 0
  page.on('worker', () => workers++)
  await page.addInitScript(() => {
    window.__long = []
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)) }).observe({ type: 'longtask', buffered: true }) } catch {}
  })
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('aside[aria-label="Sidebar"] .tabular-nums', { timeout: 60000 })
  await page.waitForTimeout(1000)
  const heap = () => page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576))
  const h0 = await heap()
  // Graph: API time vs canvas time, workers, long tasks.
  await page.evaluate(() => { window.__long = []; performance.clearResourceTimings() })
  const t0 = Date.now()
  await page.click('aside[aria-label="Sidebar"] nav button:has-text("Graph")')
  await page.waitForSelector('[data-testid="graph-canvas"]', { timeout: 60000 })
  const tCanvas = Date.now() - t0
  await page.waitForTimeout(5000)
  const g = await page.evaluate(() => ({
    long: window.__long,
    api: performance.getEntriesByType('resource').filter((r) => r.name.includes('/api/') || r.name.includes('/assets/')).map((r) => `${r.name.split('/').pop().slice(0, 30)} ${r.transferSize || r.encodedBodySize}B ${Math.round(r.duration)}ms@${Math.round(r.startTime)}`),
    loading: !!document.querySelector('[data-testid="graph-loading"]'),
  }))
  console.log(JSON.stringify({ tGraphCanvas: tCanvas, workers, heapBeforeMB: h0, heapGraphMB: await heap(), ...g }, null, 1))
  // Navigation loop: type page <-> graph, 6 round trips; heap after each.
  const heaps = []
  for (let i = 0; i < 6; i++) {
    await page.click('aside[aria-label="Sidebar"] ul li button:has-text("Pages")')
    await page.waitForSelector('[data-testid="data-view"] [data-path]', { timeout: 60000 })
    await page.click('aside[aria-label="Sidebar"] nav button:has-text("Graph")')
    await page.waitForSelector('[data-testid="graph-canvas"]', { timeout: 60000 })
    await page.waitForTimeout(1500)
    heaps.push(await heap())
  }
  // Peek 10 objects (open/close) from the type page.
  await page.click('aside[aria-label="Sidebar"] ul li button:has-text("Pages")')
  await page.waitForSelector('[data-testid="data-view"] [data-path]', { timeout: 60000 })
  const peekHeaps = []
  for (let i = 0; i < 10; i++) {
    const btns = await page.$$('[data-testid="data-view"] [data-path] button')
    await btns[i % btns.length].click()
    await page.waitForSelector('.object-editor', { timeout: 30000 })
    await page.waitForTimeout(300)
    await page.keyboard.press('Escape')
    await page.waitForSelector('.object-editor', { state: 'detached', timeout: 30000 }).catch(() => {})
    peekHeaps.push(await heap())
  }
  await page.evaluate(() => { window.__long = [] })
  await page.waitForTimeout(2000)
  console.log(JSON.stringify({ heapsAfterRoundTrips: heaps, heapsAfterPeeks: peekHeaps, workersTotal: workers, finalHeapMB: await heap() }, null, 1))
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
