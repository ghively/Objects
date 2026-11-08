// Pick each type's layout once through the UI (the app saves it in the demo space).
// node scripts/screenshots/setup_views.js   (Object running on OBJECT_URL, default http://127.0.0.1:8790/)
const { chromium } = require('playwright');
const url = process.env.OBJECT_URL || 'http://127.0.0.1:8790/';

async function pickLayout(p, type, layout) {
  await p.getByText(type, { exact: true }).first().click();
  await p.waitForTimeout(800);
  await p.getByRole('button', { name: 'Layout' }).click();
  await p.waitForTimeout(400);
  await p.locator('[data-radix-popper-content-wrapper]').getByText(layout, { exact: true }).click();
  await p.waitForTimeout(800);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
}

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(url, { waitUntil: 'networkidle' });
  await pickLayout(p, 'Books', 'Gallery');
  await pickLayout(p, 'People', 'Gallery');
  await pickLayout(p, 'Projects', 'Kanban');
  await pickLayout(p, 'Meetings', 'Calendar');
  await b.close();
})();
