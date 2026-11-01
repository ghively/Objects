const { chromium } = require('playwright')
const port = process.argv[2] || '8800'
const base = `http://127.0.0.1:${port}`
;(async () => {
  const browser = await chromium.launch()
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('aside[aria-label="Sidebar"] .tabular-nums', { timeout: 60000 })
  await page.waitForTimeout(1000)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 })
  await cdp.send('Profiler.start')
  const t0 = Date.now()
  await page.click('aside[aria-label="Sidebar"] nav button:has-text("Graph")')
  await page.waitForSelector('[data-testid="graph-canvas"]', { timeout: 60000 })
  const tCanvas = Date.now() - t0
  await page.waitForTimeout(1500)
  const { profile } = await cdp.send('Profiler.stop')
  // Self time per node, aggregated by function+url:line.
  const byId = new Map(profile.nodes.map((n) => [n.id, n]))
  const self = new Map()
  const dt = profile.timeDeltas
  for (let i = 0; i < profile.samples.length; i++) {
    const n = byId.get(profile.samples[i])
    const cf = n.callFrame
    const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber}`
    self.set(key, (self.get(key) || 0) + (dt[i] || 0))
  }
  const total = dt.reduce((a, b) => a + b, 0) / 1000
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22).map(([k, v]) => `${(v / 1000).toFixed(0).padStart(6)} ms  ${k}`)
  // Also by URL.
  const byUrl = new Map()
  for (let i = 0; i < profile.samples.length; i++) {
    const cf = byId.get(profile.samples[i]).callFrame
    const u = cf.url ? cf.url.split('/').pop().slice(0, 30) : `(${cf.functionName || 'native/idle'})`
    byUrl.set(u, (byUrl.get(u) || 0) + (dt[i] || 0))
  }
  console.log(`graph canvas after ${tCanvas} ms; profile total ${total.toFixed(0)} ms`)
  console.log('by url:', [...byUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${(v / 1000).toFixed(0)}ms`).join(' | '))
  console.log(top.join('\n'))
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
