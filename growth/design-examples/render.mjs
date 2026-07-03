import { chromium } from "playwright";
import path from "node:path";

const dir = "/Users/MHolley/Desktop/thesmos-governance/growth/design-examples";

const targets = [
  { file: "ph-01-council-transcript.html", out: "ph-01-council-transcript.jpg", width: 1270, height: 760 },
  { file: "ph-02-live-routing.html", out: "ph-02-live-routing.jpg", width: 1270, height: 760 },
  { file: "ph-03-decision-card.html", out: "ph-03-decision-card.jpg", width: 1270, height: 760 },
  { file: "ph-04-platform-grid.html", out: "ph-04-platform-grid.jpg", width: 1270, height: 760 },
  { file: "ph-05-tiers.html", out: "ph-05-tiers.jpg", width: 1270, height: 760 },
  { file: "x-god-drop-card.html", out: "x-god-drop-card.jpg", width: 1200, height: 675 },
  { file: "email-header-banner.html", out: "email-header-banner.jpg", width: 1200, height: 400 },
];

const browser = await chromium.launch();
for (const t of targets) {
  const page = await browser.newPage({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: 2 });
  await page.goto(`file://${path.join(dir, t.file)}`);
  await page.screenshot({ path: path.join(dir, t.out), type: "jpeg", quality: 92 });
  await page.close();
  console.log(`rendered ${t.out}`);
}
await browser.close();
