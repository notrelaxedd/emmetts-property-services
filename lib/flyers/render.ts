import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import sharp, { type OverlayOptions } from "sharp";
import { jpegPagePdf } from "./pdf";

/**
 * The flyer template and where each worker's QR code goes on it. Coordinates are pixels in the
 * template image (its flat gray placeholder box). The template is rendered from
 * assets/flyer/fall-cleanup.html by `npm run flyer:template`, which prints the size and box to paste
 * here (update the paths in next.config.mjs too if the file name changes).
 */
export const FLYER_TEMPLATE = {
  file: "assets/flyer/fall-cleanup.webp",
  width: 2550,
  height: 3300,
  qrBox: { left: 1695, top: 2025, width: 480, height: 540 },
} as const;

/** The site's heading face (Montserrat SemiBold): the ASCII subset the share image also uses. */
const FONT_FILE = "assets/og/Montserrat-600-Subset.ttf";

/** The template is already print resolution (US Letter at 300 dpi), so it's used as is: no upscaling, crisp text. */
export const PRINT_SCALE = 1;

/** In template pixels: the code label's cap height, and the padding around the QR and above the label. */
const LABEL_HEIGHT = 24;
const PAD = 14;

let templateCache: Promise<Buffer> | null = null;
function template(): Promise<Buffer> {
  templateCache ??= readFile(path.join(process.cwd(), FLYER_TEMPLATE.file)).catch((e) => {
    templateCache = null;
    throw e;
  });
  return templateCache;
}

/**
 * The worker's code in small, lightly letterspaced light-gray Montserrat under the QR, like a
 * reference number: easy to read out on the phone if asked, easy to overlook otherwise. Codes are
 * caps and digits, so the image is about `height` px tall. Null if text rendering isn't available.
 */
async function codeLabel(code: string, height: number): Promise<Buffer | null> {
  try {
    return await sharp({
      text: {
        // letter_spacing is in 1/1024 px here: about 0.1em.
        text: `<span foreground="#9a9a9a" letter_spacing="${Math.round(height * 0.15 * 1024)}">${code}</span>`,
        fontfile: path.join(process.cwd(), FONT_FILE),
        font: "Montserrat SemiBold",
        // Pango sets its default 12pt at this dpi; Montserrat's caps are 0.7em, so they come out `height` px tall.
        dpi: Math.round(height * 8.6),
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
  const pad = Math.round(PAD * scale);
  const label = await codeLabel(code, Math.round(LABEL_HEIGHT * scale));
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

  const base = sharp(await template());
  if (scale !== 1) base.resize(FLYER_TEMPLATE.width * scale, FLYER_TEMPLATE.height * scale, { kernel: "lanczos3" });
  const flyer = await base
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
