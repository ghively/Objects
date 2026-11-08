// Capture README screenshots of the demo space.
// node scripts/screenshots/scenes.js OUTDIR [dark|light] [scale] [scene ...]
// Object must be running on the demo space at OBJECT_URL (default http://127.0.0.1:8790/).
const { chromium } = require('playwright');
const [outDir, theme = 'dark', scale = '1', ...only] = process.argv.slice(2);
const url = process.env.OBJECT_URL || 'http://127.0.0.1:8790/';
const W = 1440, H = 900;

async function fresh(b) {
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: Number(scale), colorScheme: theme });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const wantLight = theme === 'light';
  const toLight = p.getByRole('button', { name: 'Light mode' });
  const toDark = p.getByRole('button', { name: 'Dark mode' });
  if (wantLight && await toLight.count()) await toLight.click();
  if (!wantLight && await toDark.count()) await toDark.click();
  await p.waitForTimeout(400);
  return { ctx, p };
}

async function nav(p, text) {
  await p.getByText(text, { exact: true }).first().click();
  await p.waitForTimeout(1000);
}

async function openPage(p, type, title) {
  await nav(p, type);
  await p.getByText(title, { exact: true }).first().click();
  await p.waitForTimeout(900);
  await p.getByRole('button', { name: 'Open as page' }).click();
  await p.waitForTimeout(1500);
}

const scenes = {
  async object(p) { await openPage(p, 'Projects', 'Atlas design system'); },
  async editor(p) {
    await openPage(p, 'Pages', 'Welcome');
    const hide = p.getByRole('button', { name: 'Hide properties' });
    if (await hide.count()) await hide.first().click();
    await p.waitForTimeout(500);
    await p.mouse.move(1000, 500);
    await p.mouse.wheel(0, 420);
    await p.waitForTimeout(2500);
  },
  async gallery(p) { await nav(p, 'Books'); },
  async kanban(p) { await nav(p, 'Projects'); },
  async tasks(p) { await nav(p, 'Tasks'); await p.getByText('Status', { exact: true }).first().click(); await p.waitForTimeout(1000); },
  async calendar(p) { await nav(p, 'Calendar'); await p.getByText('Day', { exact: true }).first().click(); await p.waitForTimeout(1500); },
  async meetings(p) { await nav(p, 'Meetings'); await p.getByText('Month', { exact: true }).first().click(); await p.waitForTimeout(1200); },
  async graph(p) { await nav(p, 'Graph'); await p.waitForTimeout(4000); },
  async search(p) {
    await nav(p, 'Books');
    await p.keyboard.press('Control+k');
    await p.waitForTimeout(500);
    await p.keyboard.type('atlas', { delay: 40 });
    await p.waitForTimeout(1200);
  },
  async work(p) { await nav(p, 'Work'); await p.getByText('Flow', { exact: true }).first().click(); await p.waitForTimeout(1200); },
};

(async () => {
  const b = await chromium.launch();
  for (const name of (only.length ? only : Object.keys(scenes))) {
    const { ctx, p } = await fresh(b);
    try {
      await scenes[name](p);
      await p.screenshot({ path: `${outDir}/${name}-${theme}.png` });
      console.log('ok', name);
    } catch (e) {
      console.log('FAIL', name, String(e).split('\n')[0]);
    }
    await ctx.close();
  }
  await b.close();
})();
