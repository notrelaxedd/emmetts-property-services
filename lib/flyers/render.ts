import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import sharp, { type OverlayOptions } from "sharp";
import { jpegPagePdf } from "./pdf";

/**
 * The flyer template and where each worker's QR code goes on it. Coordinates are pixels in the
 * template image (the gray "QR code here" box). To swap in a new design, replace the file, then
 * update the size and box here (and the paths in next.config.mjs if the file name changes).
 */
export const FLYER_TEMPLATE = {
  file: "assets/flyer/fall-cleanup.webp",
  width: 1545,
  height: 1999,
  qrBox: { left: 1055, top: 696, width: 338, height: 312 },
} as const;

const FONT_FILE = "assets/fonts/Anton-Regular.ttf";

/** 2× the template: a crisp QR at ~360 dpi on US Letter. */
const PRINT_SCALE = 2;

let templateCache: Promise<Buffer> | null = null;
function template(): Promise<Buffer> {
  templateCache ??= readFile(path.join(process.cwd(), FLYER_TEMPLATE.file)).catch((e) => {
    templateCache = null;
    throw e;
  });
  return templateCache;
}

/** "CODE K7M2" in Anton, about `height` px tall. Null if text rendering isn't available. */
async function codeLabel(code: string, height: number): Promise<Buffer | null> {
  try {
    return await sharp({
      text: {
        text: `<span foreground="#1a1a1a">CODE  ${code}</span>`,
        fontfile: path.join(process.cwd(), FONT_FILE),
        font: "Anton",
        dpi: Math.round(height * 6.8),
        rgba: true,
      },
    })
      .png()
      .toBuffer();
  } catch (e) {
    console.error("[flyer] code label failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** The QR as a PNG no bigger than `max` px, using whole pixels per module so it stays sharp. */
async function qrPng(url: string, max: number): Promise<{ png: Buffer; size: number }> {
  const margin = 1;
  const modules = QRCode.create(url, { errorCorrectionLevel: "M" }).modules.size + margin * 2;
  const scale = Math.max(1, Math.floor(max / modules));
  const png = await QRCode.toBuffer(url, { type: "png", errorCorrectionLevel: "M", margin, scale });
  return { png, size: modules * scale };
}

/** The flyer with the worker's QR code (pointing at `url`) and code in the box, as an opaque PNG. */
async function compose(url: string, code: string, scale: number): Promise<Buffer> {
  const { qrBox } = FLYER_TEMPLATE;
  const box = {
    left: Math.round(qrBox.left * scale),
    top: Math.round(qrBox.top * scale),
    width: Math.round(qrBox.width * scale),
    height: Math.round(qrBox.height * scale),
  };
  const pad = Math.round(8 * scale);
  const label = await codeLabel(code, Math.round(30 * scale));
  const labelMeta = label ? await sharp(label).metadata() : null;
  const labelHeight = labelMeta?.height ?? 0;
  const qr = await qrPng(url, Math.min(box.width - pad * 2, box.height - pad * 2 - (labelHeight ? labelHeight + pad : 0)));
  const qrTop = box.top + Math.round((box.height - qr.size - (labelHeight ? labelHeight + pad : 0)) / 2);

  // Cover the gray placeholder (plus its anti-aliased edge) with white.
  const cover = await sharp({
    create: { width: box.width + 6 * scale, height: box.height + 6 * scale, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  const layers: OverlayOptions[] = [
    { input: cover, left: box.left - 3 * scale, top: box.top - 3 * scale },
    { input: qr.png, left: box.left + Math.round((box.width - qr.size) / 2), top: qrTop },
  ];
  if (label && labelMeta?.width) {
    layers.push({
      input: label,
      left: box.left + Math.round((box.width - labelMeta.width) / 2),
      top: qrTop + qr.size + pad,
    });
  }

  const flyer = await sharp(await template())
    .resize(FLYER_TEMPLATE.width * scale, FLYER_TEMPLATE.height * scale, { kernel: "lanczos3" })
    .composite(layers)
    .png()
    .toBuffer();
  return sharp(flyer).flatten({ background: "#ffffff" }).removeAlpha().png().toBuffer();
}

/** Print-ready US Letter PDF of a worker's flyer. */
export async function renderFlyerPdf(url: string, code: string): Promise<Buffer> {
  const jpeg = await sharp(await compose(url, code, PRINT_SCALE)).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
  return jpegPagePdf(jpeg, { width: FLYER_TEMPLATE.width * PRINT_SCALE, height: FLYER_TEMPLATE.height * PRINT_SCALE });
}

/** Full-resolution PNG of a worker's flyer. */
export async function renderFlyerPng(url: string, code: string): Promise<Buffer> {
  return compose(url, code, PRINT_SCALE);
}

/** Small JPEG for previewing the flyer in the console. */
export async function renderFlyerPreview(url: string, code: string): Promise<Buffer> {
  return sharp(await compose(url, code, 1)).resize({ width: 700 }).jpeg({ quality: 85 }).toBuffer();
}

/** Just the QR code (for adding to a different design), as a PNG. */
export async function renderQrPng(url: string): Promise<Buffer> {
  return (await qrPng(url, 1200)).png;
}
