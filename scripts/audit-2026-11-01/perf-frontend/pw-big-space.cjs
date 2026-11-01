const { chromium } = require('playwright')
const fs = require('fs')
const port = process.argv[2] || '8800'
const base = `http://127.0.0.1:${port}`
const touchFile = process.argv[3]
;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    window.__long = []
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)) }).observe({ type: 'longtask', buffered: true }) } catch {}
  })
  const t0 = Date.now()
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('aside[aria-label="Sidebar"] li', { timeout: 60000 })
  const tSidebar = Date.now() - t0
  await page.waitForSelector('aside[aria-label="Sidebar"] .tabular-nums', { timeout: 60000 })
  const tCounts = Date.now() - t0
  await page.waitForTimeout(1500)
  const start = await page.evaluate(() => ({
    paint: performance.getEntriesByType('paint').map((p) => `${p.name}@${Math.round(p.startTime)}`),
    heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
    long: window.__long,
    api: performance.getEntriesByType('resource').filter((r) => r.name.includes('/api/')).map((r) => `${r.name.split('/api/')[1].slice(0, 20)} ${r.transferSize || r.encodedBodySize}B ${Math.round(r.duration)}ms@${Math.round(r.startTime)}`),
  }))
  console.log(JSON.stringify({ tSidebar, tCounts, ...start }, null, 1))
  // Type page with 5000 rows.
  const t1 = Date.now()
  await page.evaluate(() => { window.__long = []; performance.clearResourceTimings() })
  await page.click('aside[aria-label="Sidebar"] ul li button:has-text("Pages")')
  await page.waitForSelector('[data-testid="data-view"] [data-path]', { timeout: 60000 })
  const tType = Date.now() - t1
  await page.waitForTimeout(1000)
  const typeInfo = await page.evaluate(() => ({
    long: window.__long,
    heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
    api: performance.getEntriesByType('resource').filter((r) => r.name.includes('/api/')).map((r) => `${r.name.split('/api/')[1].slice(0, 30)} ${r.transferSize || r.encodedBodySize}B ${Math.round(r.duration)}ms`),
    rows: document.querySelectorAll('[data-testid="data-view"] [data-path]').length,
  }))
  console.log(JSON.stringify({ tTypePage: tType, ...typeInfo }, null, 1))
  // Switch the view to table (Customize menu is complex) -> skip; open the palette and type.
  // An external change: append to one file, watch what the client fetches in the next 3 s.
  if (touchFile) {
    await page.evaluate(() => { window.__long = []; performance.clearResourceTimings() })
    const t2 = Date.now()
    fs.appendFileSync(touchFile, '\nEdited externally.\n')
    await page.waitForTimeout(3000)
    const ev = await page.evaluate(() => ({
      long: window.__long,
      heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
      api: performance.getEntriesByType('resource').filter((r) => r.name.includes('/api/')).map((r) => `${r.name.split('/api/')[1].slice(0, 40)} ${r.transferSize || r.encodedBodySize}B ${Math.round(r.duration)}ms@${Math.round(r.startTime)}`),
    }))
    console.log(JSON.stringify({ afterExternalEdit: ev }, null, 1))
  }
  // Graph with 5000 nodes.
  const t3 = Date.now()
  await page.evaluate(() => { window.__long = [] })
  await page.click('aside[aria-label="Sidebar"] nav button:has-text("Graph")')
  await page.waitForSelector('[data-testid="graph-canvas"]', { timeout: 60000 })
  const tCanvas = Date.now() - t3
  await page.waitForSelector('[data-testid="graph-loading"]', { state: 'detached', timeout: 60000 }).catch(() => {})
  const tLayout = Date.now() - t3
  const g = await page.evaluate(() => ({ long: window.__long, heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576), nodes: document.querySelector('[data-testid="graph-canvas"]')?.getAttribute('data-node-count') }))
  console.log(JSON.stringify({ tGraphCanvas: tCanvas, tGraphLayoutDone: tLayout, ...g }, null, 1))
  // Palette typing.
  await page.keyboard.press('Control+k')
  await page.waitForSelector('[role="dialog"] input, [cmdk-input]', { timeout: 10000 })
  await page.evaluate(() => { window.__long = [] })
  const t4 = Date.now()
  await page.keyboard.type('synthetic page 12', { delay: 30 })
  await page.waitForTimeout(800)
  const p = await page.evaluate(() => ({ long: window.__long, heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576) }))
  console.log(JSON.stringify({ paletteTypingMs: Date.now() - t4 - 800, ...p }, null, 1))
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
