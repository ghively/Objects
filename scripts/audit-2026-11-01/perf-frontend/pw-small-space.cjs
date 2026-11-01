// Headless timing of the built app against the local back end (port from argv).
const { chromium } = require('playwright')
const port = process.argv[2] || '8799'
const base = `http://127.0.0.1:${port}`
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
  const tDcl = Date.now() - t0
  await page.waitForSelector('aside[aria-label="Sidebar"] li', { timeout: 60000 })
  const tSidebar = Date.now() - t0
  // Counts next to the types appear once /api/objects is in.
  await page.waitForSelector('aside[aria-label="Sidebar"] .tabular-nums', { timeout: 60000 })
  const tCounts = Date.now() - t0
  await page.waitForTimeout(1500)
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0]
    const res = performance.getEntriesByType('resource').map((r) => ({ name: r.name.split('/').pop().slice(0, 60), size: r.transferSize || r.encodedBodySize, dur: Math.round(r.duration), start: Math.round(r.startTime) }))
    const paint = performance.getEntriesByType('paint').map((p) => ({ name: p.name, t: Math.round(p.startTime) }))
    const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null
    return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), paint, mem, long: window.__long, res }
  })
  console.log(JSON.stringify({ tDcl, tSidebar, tCounts, nav: { dcl: nav.dcl, load: nav.load, paint: nav.paint, heapMB: nav.mem, longTasks: nav.long } }, null, 1))
  console.log('resources at startup:')
  for (const r of nav.res.sort((a, b) => a.start - b.start)) console.log(`  t=${r.start}ms ${String(r.size).padStart(8)} B ${r.dur}ms ${r.name}`)
  // Navigation: click the first type in the sidebar, wait for the data view.
  const t1 = Date.now()
  await page.evaluate(() => { window.__long = [] })
  await page.click('aside[aria-label="Sidebar"] ul li button')
  await page.waitForSelector('[data-testid="data-view"] [data-path]', { timeout: 30000 })
  const tType = Date.now() - t1
  // Open the first object (peek) then a page.
  const t2 = Date.now()
  await page.click('[data-testid="data-view"] [data-path] button')
  await page.waitForSelector('.object-editor, [role="dialog"]', { timeout: 30000 })
  const tObj = Date.now() - t2
  const long2 = await page.evaluate(() => window.__long)
  const mem2 = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null)
  // Graph page.
  const t3 = Date.now()
  await page.keyboard.press('Escape')
  await page.click('aside[aria-label="Sidebar"] nav button:has-text("Graph")')
  await page.waitForSelector('[data-testid="graph-canvas"]', { timeout: 30000 })
  const tGraph = Date.now() - t3
  await page.waitForTimeout(1000)
  const res2 = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => r.name.includes('/assets/')).map((r) => `${r.name.split('/').pop().slice(0, 40)} ${r.transferSize || r.encodedBodySize}B`))
  const mem3 = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null)
  console.log(JSON.stringify({ tTypePage: tType, tOpenObject: tObj, longTasksDuringNav: long2, heapAfterNavMB: mem2, tGraph, heapAfterGraphMB: mem3, assetsLoadedSoFar: res2 }, null, 1))
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
