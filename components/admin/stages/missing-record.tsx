import Link from "next/link"
import { SearchX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { STAGE_META, stageHref, type StageKey } from "./stages"

/** A front-page `?id=` that points at nothing (deleted, or a bad link): say so instead of a 404 for the whole page. */
export function MissingRecord({ stage, what }: { stage: StageKey; what: string }) {
  return (
    <EmptyState
      icon={SearchX}
      title={`That ${what} isn't here any more`}
      description="It may have been deleted, or the link is wrong."
      action={
        <Button asChild variant="outline">
          <Link href={stageHref(stage)} scroll={false}>
            All {STAGE_META[stage].name.toLowerCase()}
          </Link>
        </Button>
      }
    />
  )
}
