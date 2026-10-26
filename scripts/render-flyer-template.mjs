// Renders the flyer design (assets/flyer/fall-cleanup.html) to the template image the flyer
// renderer composites QR codes onto (assets/flyer/fall-cleanup.webp), at print resolution:
// US Letter at 300 dpi = 2550x3300. Prints the gray QR placeholder's box in template pixels for
// FLYER_TEMPLATE.qrBox in lib/flyers/render.ts.
//
//   npm run flyer:template
//
// Uses Playwright's Chromium (set PLAYWRIGHT_CHROMIUM_PATH to reuse a system Chromium, as with the e2e tests).
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(root, "assets/flyer/fall-cleanup.html");
const OUTPUT = path.join(root, "assets/flyer/fall-cleanup.webp");

const PAGE = { width: 816, height: 1056 }; // 8.5 x 11 in at 96 CSS px per inch
const DPI = 300;
const SCALE = DPI / 96; // CSS px -> template px (2550 / 816)
const SAFE = 0.4 * 96; // keep everything 0.4 in from the edges (home printers can't print the rim)

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);
try {
  const page = await browser.newPage({ viewport: PAGE, deviceScaleFactor: SCALE });
  await page.goto(pathToFileURL(SOURCE).href, { waitUntil: "load" });

  // Every declared font and image must load, or the template silently falls back to system fonts.
  const problems = await page.evaluate(async () => {
    const out = [];
    for (const face of document.fonts) {
      await face.load().catch(() => out.push(`font ${face.family} ${face.weight} did not load`));
    }
    await document.fonts.ready;
    for (const img of document.images) {
      if (!img.complete || img.naturalWidth === 0) out.push(`image ${img.getAttribute("src")} did not load`);
    }
    return out;
  });
  if (problems.length) throw new Error(problems.join("\n"));

  const { box, outside } = await page.evaluate((safe) => {
    const r = document.getElementById("qr-box").getBoundingClientRect();
    const outside = [];
    for (const el of document.querySelectorAll(".page *")) {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      if (b.left < safe || b.top < safe || b.right > innerWidth - safe || b.bottom > innerHeight - safe) {
        const cls = el.getAttribute("class");
        outside.push(`${el.tagName.toLowerCase()}${cls ? "." + cls.replace(/ +/g, ".") : ""}`);
      }
    }
    return { box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, outside };
  }, SAFE);
  if (outside.length) throw new Error(`Inside the 0.4 in print margin: ${outside.join(", ")}`);

  const png = await page.screenshot({ type: "png" });
  const meta = await sharp(png).metadata();
  if (meta.width !== 2550 || meta.height !== 3300) throw new Error(`Rendered ${meta.width}x${meta.height}, expected 2550x3300`);
  await sharp(png).removeAlpha().webp({ lossless: true, effort: 6 }).toFile(OUTPUT);

  const px = (v) => Math.round(v * SCALE);
  const qrBox = {
    left: px(box.left),
    top: px(box.top),
    width: px(box.right) - px(box.left),
    height: px(box.bottom) - px(box.top),
  };
  const { size } = await stat(OUTPUT);
  console.log(`Wrote ${path.relative(root, OUTPUT)} (${meta.width}x${meta.height}, ${(size / 1024).toFixed(0)} KB)`);
  console.log("FLYER_TEMPLATE in lib/flyers/render.ts:");
  console.log(`  width: ${meta.width},\n  height: ${meta.height},\n  qrBox: { left: ${qrBox.left}, top: ${qrBox.top}, width: ${qrBox.width}, height: ${qrBox.height} },`);
} finally {
  await browser.close();
}
