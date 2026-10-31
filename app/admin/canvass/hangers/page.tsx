import Link from "next/link"
import { QrCode } from "lucide-react"
import { CanvassTabs } from "@/components/admin/canvass/canvass-tabs"
import { StreetsTable } from "@/components/admin/canvass/streets-table"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { Stat } from "@/components/ui/stat"
import { requireOwner } from "@/lib/auth/session"
import { hangerConversions } from "@/lib/canvass/hangers"
import type { HangerEventRow } from "@/lib/canvass/hangers"
import { loadStreets } from "@/lib/canvass/load"
import { percent } from "@/lib/canvass/stats"
import { streetTotals, streetsWithConversions } from "@/lib/canvass/streets"
import type { StreetHangerRow, StreetTotals } from "@/lib/canvass/streets"
import { check } from "@/lib/ops/types"
import { requireSupabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { title: "Door hangers" }

async function load(): Promise<{ rows: StreetHangerRow[]; totals: StreetTotals }> {
  const db = requireSupabaseAdmin()
  const [streets, codes, events] = await Promise.all([
    loadStreets(db),
    db.from("hanger_codes").select("code,street"),
    db.from("hanger_events").select("code,event,visitor").limit(50_000),
  ])
  const codeRows = check(codes, "hanger codes") ?? []
  const eventRows: HangerEventRow[] = check(events, "hanger events") ?? []
  const rows = streetsWithConversions(streets, hangerConversions(codeRows, eventRows))
  return { rows, totals: streetTotals(rows) }
}

export default async function HangersPage() {
  await requireOwner()
  let data: Awaited<ReturnType<typeof load>> | null = null
  let error: string | null = null
  try {
    data = await load()
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Door hangers"
        description="One QR code per street. Print a sheet, leave a hanger when nobody answers, and see which streets scan and book."
      />
      <CanvassTabs active="hangers" />

      {error || !data ? (
        <EmptyState icon={QrCode} title="Couldn't load streets" description={error ?? undefined} />
      ) : data.rows.length === 0 ? (
        <EmptyState
          icon={QrCode}
          title="No streets yet"
          description="Streets come from the parcels you pull on the map. Draw an area there first, then come back to print hangers."
          action={
            <Button asChild variant="outline">
              <Link href="/admin/canvass">Go to the map</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Streets" value={data.totals.streets} hint={`${data.totals.withCode} with a code`} />
            <Stat label="Parcels" value={data.totals.parcels} />
            <Stat label="Unique scans" value={data.totals.scans} />
            <Stat label="Booked" value={data.totals.bookings} hint={`${percent(data.totals.rate)} of scans`} />
          </div>
          <StreetsTable rows={data.rows} totals={data.totals} />
        </>
      )}
    </div>
  )
}
