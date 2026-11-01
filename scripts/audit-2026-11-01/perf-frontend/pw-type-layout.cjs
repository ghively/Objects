const { chromium } = require('playwright')
const port = process.argv[2] || '8800'
const label = process.argv[3] || 'layout'
const base = `http://127.0.0.1:${port}`
;(async () => {
  const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] })
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
  await page.addInitScript(() => {
    window.__long = []
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)) }).observe({ type: 'longtask', buffered: true }) } catch {}
  })
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('aside[aria-label="Sidebar"] .tabular-nums', { timeout: 60000 })
  await page.waitForTimeout(800)
  await page.evaluate(() => { window.__long = []; performance.clearResourceTimings() })
  const h0 = await page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576))
  const t0 = Date.now()
  await page.click('aside[aria-label="Sidebar"] ul li button:has-text("Pages")')
  await page.waitForSelector('[data-testid="data-view"] [data-path]', { timeout: 120000 })
  const tRows = Date.now() - t0
  await page.waitForTimeout(2500)
  const info = await page.evaluate(() => ({
    long: window.__long,
    rowsApi: performance.getEntriesByType('resource').filter((r) => r.name.includes('/api/rows')).map((r) => `${r.transferSize || r.encodedBodySize}B ${Math.round(r.duration)}ms (ends @${Math.round(r.responseEnd)})`),
    dataPaths: document.querySelectorAll('[data-testid="data-view"] [data-path]').length,
    domNodes: document.getElementsByTagName('*').length,
    heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
    layout: document.querySelector('[data-testid="table-layout"]') ? 'table' : document.querySelector('[data-testid="kanban"], [data-kanban]') ? 'kanban' : 'other',
  }))
  // One inline edit in a table: type into the first title input and blur; measure the long tasks it causes.
  let edit = null
  if (info.layout === 'table') {
    await page.evaluate(() => { window.__long = [] })
    const t1 = Date.now()
    const inp = page.locator('[data-testid="table-layout"] input[aria-label="Title"]').first()
    await inp.click()
    await inp.press('End')
    await inp.type(' x', { delay: 20 })
    await inp.press('Enter')
    await page.waitForTimeout(1500)
    edit = { editWallMs: Date.now() - t1 - 1500, long: await page.evaluate(() => window.__long) }
  }
  console.log(JSON.stringify({ label, tFirstRows: tRows, heapBeforeMB: h0, ...info, edit }))
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
