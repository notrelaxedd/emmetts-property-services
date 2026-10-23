import { requireOwner } from "@/lib/auth/session"
import { flyerUrl } from "@/lib/flyers/codes"
import { renderFlyerPdf, renderFlyerPng, renderFlyerPreview, renderQrPng } from "@/lib/flyers/render"
import { siteConfig } from "@/lib/site-config"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const FORMATS = {
  pdf: { render: renderFlyerPdf, type: "application/pdf", ext: "pdf" },
  png: { render: renderFlyerPng, type: "image/png", ext: "png" },
  preview: { render: renderFlyerPreview, type: "image/jpeg", ext: "jpg" },
  qr: { render: (url: string) => renderQrPng(url), type: "image/png", ext: "png" },
} as const

/**
 * A flyer worker's flyer: ?format=pdf (print-ready US Letter, the default), png, preview (small
 * JPEG for the console) or qr (the QR code alone). Add &download=1 to save it as a file.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  await requireOwner()
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return new Response("Not found", { status: 404 })
  const search = new URL(request.url).searchParams
  const key = search.get("format") ?? "pdf"
  if (!Object.hasOwn(FORMATS, key)) return new Response("Unknown format", { status: 400 })
  const format = FORMATS[key as keyof typeof FORMATS]

  const db = requireSupabaseAdmin()
  const { data: worker, error } = await db.from("flyer_workers").select("name,code").eq("id", params.id).maybeSingle()
  if (error) return new Response(error.message, { status: 500 })
  if (!worker) return new Response("Not found", { status: 404 })

  const body = await format.render(flyerUrl(siteConfig.url, worker.code), worker.code)
  const slug = worker.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "flyer"
  const filename = `${key === "qr" ? "qr" : "flyer"}-${slug}-${worker.code}.${format.ext}`
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": format.type,
      "content-disposition": `${search.get("download") === "1" ? "attachment" : "inline"}; filename="${filename}"`,
      "cache-control": "private, max-age=300",
    },
  })
}
