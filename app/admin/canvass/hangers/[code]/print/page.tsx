import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, QrCode } from "lucide-react"
import QRCode from "qrcode"
import { HangerSheet } from "@/components/admin/canvass/hanger-sheet"
import { PrintButton } from "@/components/admin/canvass/print-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { requireOwner } from "@/lib/auth/session"
import { hangerUrl, normalizeHangerCode } from "@/lib/canvass/hangers"
import { currentSeasonFocus } from "@/lib/canvass/season"
import { getCanvassSettings } from "@/lib/canvass/settings"
import { hangerCopy } from "@/lib/canvass/streets"
import type { HangerCopy } from "@/lib/canvass/streets"
import type { HangerCode } from "@/lib/db/types"
import { check } from "@/lib/ops/types"
import { siteConfig } from "@/lib/site-config"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Print hangers" }

/**
 * Print CSS: landscape Letter with no margin so three 3.5in hangers fill the 11in width edge to edge; the admin
 * shell (sidebar, top bar, nav) is hidden and only the sheet is visible, pinned to the page.
 */
const PRINT_CSS = `
@page { size: letter landscape; margin: 0; }
@media print {
  html, body { height: 8.5in; overflow: hidden; background: #fff !important; }
  body * { visibility: hidden; }
  aside, header, nav { display: none !important; }
  main { padding: 0 !important; max-width: none !important; }
  #hanger-sheet, #hanger-sheet * { visibility: visible; }
  #hanger-sheet { position: fixed; left: 0; top: 0; margin: 0; box-shadow: none; }
}
`

async function load(code: string): Promise<{ row: HangerCode; copy: HangerCopy; qr: string; seasonLabel: string }> {
  const db = requireSupabaseAdmin()
  const [found, settings] = await Promise.all([db.from("hanger_codes").select("*").eq("code", code).maybeSingle(), getCanvassSettings(db)])
  const row: HangerCode | null = check(found, "hanger code")
  if (!row) notFound()
  const season = currentSeasonFocus(settings.season_map)
  const copy = hangerCopy(season, settings.offer_text)
  const qr = await QRCode.toDataURL(hangerUrl(siteConfig.url, row.code), { margin: 1, width: 360 })
  return { row, copy, qr, seasonLabel: season.label }
}

export default async function PrintHangersPage({ params }: { params: { code: string } }) {
  await requireOwner()
  const code = normalizeHangerCode(decodeURIComponent(params.code))
  if (!code) notFound()

  let data: Awaited<ReturnType<typeof load>> | null = null
  let error: string | null = null
  try {
    data = await load(code)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  return (
    <div className="space-y-4">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost">
          <Link href="/admin/canvass/hangers">
            <ArrowLeft /> Back
          </Link>
        </Button>
        {data ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-ink-muted">
              {data.row.street} <span className="font-mono font-semibold text-ink">{data.row.code}</span>
            </span>
            {data.row.active ? null : <Badge variant="outline">Paused</Badge>}
            <Badge variant="secondary">{data.seasonLabel}</Badge>
            <PrintButton label="Print sheet" />
          </div>
        ) : null}
      </div>

      {error || !data ? (
        <EmptyState icon={QrCode} title="Couldn't build the hanger sheet" description={error ?? undefined} />
      ) : (
        <>
          <p className="text-sm text-ink-muted">
            Landscape Letter, three hangers per sheet. Cut along the dashed lines and punch the circle for the door knob. The offer text and
            season focus come from Canvass settings.
          </p>
          <div className="overflow-x-auto pb-2">
            <HangerSheet
              code={data.row.code}
              street={data.row.street}
              qrDataUrl={data.qr}
              copy={data.copy}
              phone={siteConfig.phone.display}
              businessName={siteConfig.name}
            />
          </div>
        </>
      )}
    </div>
  )
}
