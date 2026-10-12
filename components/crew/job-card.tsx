import { ChevronRight, CloudRain, Navigation, Users } from "lucide-react"
import Link from "next/link"
import type * as React from "react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import type { AssignmentStatus, CrewJob } from "@/lib/db/types"
import { cn } from "@/lib/utils"
import { ASSIGNMENT_STATUS_LABEL, JOB_STATUS_LABEL, directionsUrl, formatDuration, jobDay, jobTime } from "./format"

export type JobCardProps = {
  job: CrewJob
  assignmentStatus?: AssignmentStatus
  /** Opens the job detail page when set. */
  href?: string
  /** Show the day as well as the time (e.g. on Offers, which isn't grouped by day). */
  showDay?: boolean
  /** Extra line under the title, e.g. "Swap from Jake". */
  eyebrow?: React.ReactNode
  children?: React.ReactNode
  className?: string
}

/** One job, crew-safe: time, customer name, address, services. Never prices or contact details. */
export function JobCard({ job, assignmentStatus, href, showDay, eyebrow, children, className }: JobCardProps) {
  const status = JOB_STATUS_LABEL[job.status]
  const mine = assignmentStatus && assignmentStatus !== "accepted" ? ASSIGNMENT_STATUS_LABEL[assignmentStatus] : null
  const maps = directionsUrl(job)

  const heading = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold tabular-nums text-ink-muted">
          {showDay ? `${jobDay(job)} · ` : ""}
          {jobTime(job)}
          <span className="font-normal"> · {formatDuration(job.est_minutes)}</span>
        </p>
        <p className="mt-0.5 truncate text-lg font-bold leading-tight text-ink">{job.customer_name}</p>
        {eyebrow ? <p className="mt-0.5 text-sm text-ink-muted">{eyebrow}</p> : null}
      </div>
      {href ? <ChevronRight className="mt-1 size-5 shrink-0 text-ink-muted" aria-hidden="true" /> : null}
    </div>
  )

  return (
    <Card className={cn("overflow-hidden", className)}>
      {href ? (
        <Link href={href} className="block p-4 pb-2 outline-none hover:bg-ink/[0.03] focus-visible:bg-ink/[0.04]">
          {heading}
        </Link>
      ) : (
        <div className="p-4 pb-2">{heading}</div>
      )}

      <div className="flex flex-col gap-3 px-4 pb-4">
        {job.services.length ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Services">
            {job.services.map((s, i) => (
              <li key={`${s}-${i}`} className="rounded-md bg-gray-light px-2 py-1 text-sm font-medium text-ink">
                {s}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5">
          {mine ? <Badge variant={mine.variant}>{mine.label}</Badge> : null}
          <Badge variant={status.variant}>{status.label}</Badge>
          {job.weather_hold ? (
            <Badge variant="warning">
              <CloudRain aria-hidden="true" />
              Weather hold
            </Badge>
          ) : null}
          {job.crew_size > 1 ? (
            <Badge variant="outline">
              <Users aria-hidden="true" />
              Crew of {job.crew_size}
            </Badge>
          ) : null}
        </div>

        {job.address ? (
          maps ? (
            <a
              href={maps}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 items-center gap-2 rounded-md border border-ink/15 px-3 py-2 text-sm font-semibold text-ink hover:bg-ink/[0.04]"
            >
              <Navigation className="size-4 shrink-0 text-brand-green-dark" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{job.address}</span>
              <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-brand-green-dark">
                Directions
              </span>
            </a>
          ) : (
            <p className="text-sm text-ink">{job.address}</p>
          )
        ) : null}

        {children}
      </div>
    </Card>
  )
}
