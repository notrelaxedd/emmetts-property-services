import Link from "next/link"
import { CalendarClock, DoorOpen, Inbox } from "lucide-react"
import { AdminBrand } from "@/components/admin/brand"
import { AdsBody, parseAdStatus } from "@/components/admin/stages/ads-body"
import { AutopilotBody } from "@/components/admin/stages/autopilot-body"
import { CrewPanel } from "@/components/admin/stages/crew-panel"
import { AddCustomerCard, CustomerDetailBody, CustomersBody } from "@/components/admin/stages/customers-body"
import { FleetBody } from "@/components/admin/stages/fleet-body"
import { LeadDetailBody, LeadsBody } from "@/components/admin/stages/leads-body"
import { loadFrontPage } from "@/components/admin/stages/load-counts"
import { MoneyPanel } from "@/components/admin/stages/money-panel"
import { QuoteDetailBody, QuotesBody } from "@/components/admin/stages/quotes-body"
import { SchedulePanel } from "@/components/admin/stages/schedule-panel"
import { StagePanel } from "@/components/admin/stages/stage-panel"
import { StageRow } from "@/components/admin/stages/stage-row"
import { isStage, type StageKey } from "@/components/admin/stages/stages"
import { Button } from "@/components/ui/button"
import { requireOwner } from "@/lib/auth/session"

export const dynamic = "force-dynamic"
export const metadata = { title: "Home" }

type Params = { stage?: string; id?: string; add?: string; adStatus?: string; q?: string }

function PanelBody({ stage, params }: { stage: StageKey; params: Params }) {
  const id = typeof params.id === "string" && params.id ? params.id : null
  switch (stage) {
    case "ads":
      return <AdsBody variant="panel" status={parseAdStatus(params.adStatus)} />
    case "leads":
      return id ? <LeadDetailBody variant="panel" id={id} /> : <LeadsBody variant="panel" status="all" />
    case "customers":
      if (id) return <CustomerDetailBody variant="panel" id={id} />
      if (params.add === "1") return <AddCustomerCard variant="panel" />
      return <CustomersBody variant="panel" q={typeof params.q === "string" ? params.q.slice(0, 100) : ""} />
    case "quotes":
      return id ? <QuoteDetailBody variant="panel" id={id} /> : <QuotesBody variant="panel" status="all" />
    case "schedule":
      return <SchedulePanel />
    case "money":
      return <MoneyPanel />
    case "crew":
      return <CrewPanel />
    case "fleet":
      return <FleetBody variant="panel" />
    case "autopilot":
      return <AutopilotBody variant="panel" />
  }
}

/**
 * The console's front page: one row of stages showing where every customer is, from first ad to money
 * in the bank. Tapping a box opens that stage's menu under the row (`?stage=`, plus `&id=` for one record).
 */
export default async function AdminHomePage({ searchParams }: { searchParams: Params }) {
  await requireOwner()
  const stage = isStage(searchParams.stage) ? searchParams.stage : null
  const { counts, pendingApprovals } = await loadFrontPage()

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <AdminBrand />
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button asChild variant="ghost" className="h-11 px-3 text-ink-muted hover:text-ink">
            <Link href="/admin/canvass">
              <DoorOpen aria-hidden="true" /> Canvass
            </Link>
          </Button>
          <Button asChild variant="ghost" className="h-11 px-3 text-ink-muted hover:text-ink">
            <Link href="/admin/availability">
              <CalendarClock aria-hidden="true" /> Availability
            </Link>
          </Button>
          <Button asChild className="h-11 px-4">
            <Link href="/admin/inbox">
              <Inbox aria-hidden="true" /> Inbox
              {pendingApprovals ? (
                <span
                  className="min-w-5 rounded-full bg-brand-green px-1.5 text-center text-xs font-bold leading-5 tabular-nums text-ink"
                  aria-label={`${pendingApprovals} pending`}
                >
                  {pendingApprovals > 99 ? "99+" : pendingApprovals}
                </span>
              ) : null}
            </Link>
          </Button>
        </div>
      </header>

      <StageRow counts={counts} open={stage} />

      {stage ? (
        <StagePanel stage={stage} view={[stage, searchParams.id, searchParams.add].filter(Boolean).join(":")}>
          <PanelBody stage={stage} params={searchParams} />
        </StagePanel>
      ) : null}
    </div>
  )
}
