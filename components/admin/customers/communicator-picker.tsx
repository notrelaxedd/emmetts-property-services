"use client"

import * as React from "react"
import { MessagesSquare } from "lucide-react"
import { setCustomerCommunicator } from "@/app/admin/actions/customers"
import { NativeSelect } from "@/components/ui/native-select"
import { useToast } from "@/components/ui/toast"
import type { TeamMember } from "@/lib/ops/communicators"

/**
 * "Talking to them": which team member handles this customer's calls and texts. Saves as soon as it
 * changes. `team` is who can be picked (owners first, then crew); `meId` labels the signed-in owner "(you)".
 */
export function CommunicatorPicker({
  customerId,
  initial,
  team,
  meId,
}: {
  customerId: string
  initial: string | null
  team: TeamMember[]
  meId: string | null
}) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [value, setValue] = React.useState(initial ?? "")
  const owners = team.filter((m) => m.role === "owner")
  const crew = team.filter((m) => m.role !== "owner")
  const label = (m: TeamMember) => `${m.name}${m.id === meId ? " (you)" : ""}${m.removed ? " (removed)" : ""}`

  const change = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value
    const prev = value
    setValue(next)
    startTransition(async () => {
      const r = await setCustomerCommunicator(customerId, next || null)
      if (r.ok) {
        toast({ title: r.message ?? "Saved", variant: "success" })
      } else {
        setValue(prev)
        toast({ title: "Couldn't change who's talking to them", description: r.reason, variant: "destructive" })
      }
    })
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={`communicator-${customerId}`} className="flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-ink">
        <MessagesSquare className="size-4 text-ink-muted" aria-hidden="true" /> Talking to them
      </label>
      <NativeSelect
        id={`communicator-${customerId}`}
        value={value}
        onChange={change}
        disabled={pending}
        aria-busy={pending}
        className="min-w-40"
      >
        <option value="">Nobody yet</option>
        {owners.length ? (
          <optgroup label="Owners">
            {owners.map((m) => (
              <option key={m.id} value={m.id}>
                {label(m)}
              </option>
            ))}
          </optgroup>
        ) : null}
        {crew.length ? (
          <optgroup label="Crew">
            {crew.map((m) => (
              <option key={m.id} value={m.id}>
                {label(m)}
              </option>
            ))}
          </optgroup>
        ) : null}
      </NativeSelect>
    </div>
  )
}
