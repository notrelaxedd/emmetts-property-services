import { requireOwner } from "@/lib/auth/session"
import { genericFlyerUrl } from "@/lib/flyers/codes"
import { renderFlyerPdf, renderFlyerPng, renderFlyerPreview, renderQrPng } from "@/lib/flyers/render"
import { siteConfig } from "@/lib/site-config"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const FORMATS = {
  pdf: { render: renderFlyerPdf, type: "application/pdf", ext: "pdf" },
  png: { render: renderFlyerPng, type: "image/png", ext: "png" },
  preview: { render: renderFlyerPreview, type: "image/jpeg", ext: "jpg" },
  qr: { render: renderQrPng, type: "image/png", ext: "png" },
} as const

/**
 * The generic flyer: the same design with a QR code straight to the quote form and no worker code,
 * for handing out yourself or leaving at a counter. Same formats as a worker's flyer route.
 */
export async function GET(request: Request) {
  await requireOwner()
  const search = new URL(request.url).searchParams
  const key = search.get("format") ?? "pdf"
  if (!Object.hasOwn(FORMATS, key)) return new Response("Unknown format", { status: 400 })
  const format = FORMATS[key as keyof typeof FORMATS]

  const body = await format.render(genericFlyerUrl(siteConfig.url))
  const filename = `${key === "qr" ? "qr" : "flyer"}-generic.${format.ext}`
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": format.type,
      "content-disposition": `${search.get("download") === "1" ? "attachment" : "inline"}; filename="${filename}"`,
      "cache-control": "private, max-age=300",
    },
  })
}
