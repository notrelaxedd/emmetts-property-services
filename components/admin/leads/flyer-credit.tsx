"use client"

import * as React from "react"
import { setLeadFlyerWorker } from "@/app/admin/actions/flyers"
import { NativeSelect } from "@/components/ui/native-select"
import { useToast } from "@/components/ui/toast"

/** Which flyer worker gets credit for a lead: set by the QR link, or by hand for phone-ins. */
export function FlyerCredit({
  leadId,
  current,
  workers,
}: {
  leadId: string
  current: string | null
  workers: { id: string; name: string; code: string }[]
}) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [value, setValue] = React.useState(current ?? "")
  React.useEffect(() => setValue(current ?? ""), [current])

  return (
    <NativeSelect
      aria-label="Flyer worker credited with this lead"
      value={value}
      disabled={pending}
      className="h-8 max-w-xs"
      onChange={(e) => {
        const next = e.target.value
        setValue(next)
        startTransition(async () => {
          const r = await setLeadFlyerWorker(leadId, next || null)
          if (r.ok) toast({ title: r.message ?? "Saved", variant: "success" })
          else {
            setValue(current ?? "")
            toast({ title: "Couldn't save", description: r.reason, variant: "destructive" })
          }
        })
      }}
    >
      <option value="">None</option>
      {workers.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name} ({w.code})
        </option>
      ))}
    </NativeSelect>
  )
}
