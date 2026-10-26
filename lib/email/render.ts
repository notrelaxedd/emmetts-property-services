/** Pure rendering helpers: no I/O. */

import { siteConfig } from "../site-config";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function unsubscribeUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/unsubscribe?token=${encodeURIComponent(token)}`;
}

export type RenderEmailInput = {
  subject: string;
  body: string;
  siteUrl: string;
  token: string;
  business: string;
};

export function renderEmail({ subject, body, siteUrl, token, business }: RenderEmailInput): {
  text: string;
  html: string;
} {
  const unsub = unsubscribeUrl(siteUrl, token);
  // Where we are and how to reach us, under every message.
  const contact = `Northeast Ohio · ${siteConfig.phone.display}`;

  const text = `${body.trim()}\n\n--\n${business} · ${contact}\nDon't want these emails? Unsubscribe: ${unsub}\n`;

  const paragraphs = body
    .trim()
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#1f2937;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<tr><td style="padding:20px 24px;background:#166534;color:#ffffff;font-size:18px;font-weight:600;border-radius:8px 8px 0 0;">${escapeHtml(business)}</td></tr>
<tr><td style="padding:24px;">${paragraphs}</td></tr>
<tr><td style="padding:16px 24px 24px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#6b7280;">${escapeHtml(business)} · ${escapeHtml(contact)}<br>Don't want these emails? <a href="${escapeHtml(unsub)}" style="color:#166534;">Unsubscribe</a></td></tr>
</table></td></tr></table>
</body></html>`;

  return { text, html };
}
