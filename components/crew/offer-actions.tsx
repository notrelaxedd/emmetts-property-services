"use client"

import { Check, Loader2, X } from "lucide-react"
import { respondToOffer } from "@/app/crew/actions/offers"
import { Button } from "@/components/ui/button"
import { useCrewAction } from "./use-crew-action"

/** Accept / Can't make it for one offer (normal or swap). Big thumb-sized buttons. */
export function OfferActions({ assignmentId, swap = false }: { assignmentId: string; swap?: boolean }) {
  const { run, pending, busyKey } = useCrewAction()
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button
        type="button"
        variant="outline"
        className="h-12 text-base"
        disabled={pending}
        onClick={() => run("decline", () => respondToOffer(assignmentId, "declined"))}
      >
        {busyKey === "decline" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <X aria-hidden="true" />}
        {swap ? "Not for me" : "Can’t make it"}
      </Button>
      <Button
        type="button"
        className="h-12 text-base"
        disabled={pending}
        onClick={() => run("accept", () => respondToOffer(assignmentId, "accepted"))}
      >
        {busyKey === "accept" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
        {swap ? "Take it" : "Accept"}
      </Button>
    </div>
  )
}
