import Link from "next/link"
import { ExternalLink, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PanelScroll } from "./panel-scroll"
import styles from "./stage-grid.module.css"
import { STAGE_META, type StageKey } from "./stages"

/** The open stage's menu, under the row: step label, name, one line, Full page link and close. */
export function StagePanel({ stage, view, children }: { stage: StageKey; view: string; children: React.ReactNode }) {
  const meta = STAGE_META[stage]
  return (
    <section
      id="stage-panel"
      aria-labelledby="stage-panel-title"
      className="scroll-mt-16 rounded-lg border-2 border-brand-green-dark/50 bg-white shadow-sm lg:scroll-mt-4"
    >
      <PanelScroll view={view} />
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-ink/10 p-4">
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-brand-green-dark">{meta.step}</p>
          <h2 id="stage-panel-title" className="text-xl font-bold leading-tight text-ink">
            {meta.name}
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">{meta.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" className="h-11 sm:h-9">
            <Link href={meta.fullPage}>
              <ExternalLink aria-hidden="true" /> Full page
            </Link>
          </Button>
          <Button asChild variant="ghost" size="icon" className="size-11">
            <Link href="/admin" scroll={false} aria-label={`Close ${meta.name}`}>
              <X className="size-5" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </header>
      <div className={`${styles.panelBody} p-3 sm:p-4`}>{children}</div>
    </section>
  )
}
