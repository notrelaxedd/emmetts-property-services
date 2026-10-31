import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import type { StageCount } from "./load-counts"
import styles from "./stage-grid.module.css"
import { initials, STAGE_META, stageHref, STAGES, type StageKey } from "./stages"

/** Initials circles for the customers sitting in a stage (up to 4, then +N). */
function People({ names, total, dark }: { names: string[]; total: number; dark: boolean }) {
  if (!total) return null
  const more = total - names.length
  return (
    <span className="mt-2 flex items-center" aria-label={`${total} customer${total === 1 ? "" : "s"}: ${names.join(", ")}${more ? ` and ${more} more` : ""}`}>
      {names.map((n, i) => (
        <span
          key={`${n}-${i}`}
          title={n}
          aria-hidden="true"
          className={cn(
            "-ml-1.5 inline-flex size-6 items-center justify-center rounded-full text-[0.625rem] font-bold ring-2 first:ml-0",
            dark ? "bg-white text-ink ring-ink" : "bg-ink text-white ring-white",
          )}
        >
          {initials(n)}
        </span>
      ))}
      {more > 0 ? (
        <span aria-hidden="true" className={cn("ml-1 text-xs font-semibold", dark ? "text-white/80" : "text-ink-muted")}>
          +{more}
        </span>
      ) : null}
    </span>
  )
}

function StageBox({ stage, count, open }: { stage: StageKey; count: StageCount; open: boolean }) {
  const meta = STAGE_META[stage]
  const Icon = meta.icon
  // Money is the dark box, unless it's the open one (every open box looks the same).
  const dark = stage === "money" && !open
  return (
    <Link
      href={open ? "/admin" : stageHref(stage)}
      scroll={false}
      aria-expanded={open}
      aria-controls={open ? "stage-panel" : undefined}
      style={{ gridArea: stage }}
      className={cn(
        "relative flex min-h-[44px] flex-col rounded-lg border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
        meta.kind === "tool" && !open && "border-dashed",
        open
          ? "border-brand-green-dark bg-brand-green/15 text-ink ring-4 ring-brand-green/40"
          : dark
            ? "border-ink bg-ink text-white hover:bg-ink/90"
            : "border-ink/15 bg-white text-ink hover:border-ink/40",
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-semibold">
        <Icon className={cn("size-4 shrink-0", dark ? "text-brand-green" : "text-brand-green-dark")} aria-hidden="true" />
        <span className="truncate">{meta.name}</span>
      </span>
      {count.attention ? (
        <span className="absolute right-2 top-2 size-2.5 rounded-full bg-amber-500 ring-2 ring-white" aria-hidden="true" />
      ) : null}
      {count.attention ? <span className="sr-only">(needs you)</span> : null}
      <span className="mt-1 text-2xl font-bold leading-none tabular-nums sm:text-[1.75rem]">{count.value}</span>
      <span className={cn("mt-1 text-xs leading-snug", dark ? "text-white/80" : "text-ink-muted")}>{count.line}</span>
      {count.people ? <People names={count.people.names} total={count.people.total} dark={dark} /> : null}
    </Link>
  )
}

function Arrow({ area, dir }: { area: string; dir: "right" | "down" | "up" }) {
  return (
    <span className={cn(styles.arrow, styles[dir])} style={{ gridArea: area }} aria-hidden="true">
      <ArrowRight />
    </span>
  )
}

/**
 * The front page's one row of stages: Ads → Leads → Quotes → Schedule → Money, with Customers feeding
 * Leads and Crew feeding Schedule, and Fleet / Autopilot standing alone. Plain links: the open stage
 * lives in the URL (`?stage=`), so back / forward and shared links work.
 */
export function StageRow({ counts, open }: { counts: Record<StageKey, StageCount>; open: StageKey | null }) {
  return (
    <nav aria-label="Stages">
      <div className={styles.grid}>
        {STAGES.map((s) => (
          <StageBox key={s} stage={s} count={counts[s]} open={open === s} />
        ))}
        <Arrow area="a1" dir="right" />
        <Arrow area="a2" dir="right" />
        <Arrow area="a3" dir="right" />
        <Arrow area="a4" dir="right" />
        <Arrow area="cdown" dir="down" />
        <Arrow area="cup" dir="up" />
      </div>
    </nav>
  )
}
