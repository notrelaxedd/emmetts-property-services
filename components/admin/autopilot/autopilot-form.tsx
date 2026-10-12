"use client"

import * as React from "react"
import { saveAutopilot, type AutopilotInput } from "@/app/admin/actions/autopilot"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { NumberStepper } from "@/components/ui/number-stepper"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"

type Kind = keyof AutopilotInput

const KINDS: { kind: Kind; title: string; skips: string }[] = [
  { kind: "ad", title: "Ads", skips: "New ad drafts are approved without your review, ready to post." },
  { kind: "quote", title: "Quotes", skips: "Standard quotes go straight to the customer with a Stripe pay link." },
  {
    kind: "custom_item",
    title: "Custom requests",
    skips: "Refer-to-partner and decline emails go out without your OK. Custom work is still never priced automatically.",
  },
  { kind: "booking", title: "Appointments", skips: "Once every crew member accepts, the job is booked and the customer is confirmed." },
  { kind: "followup", title: "Follow-ups", skips: "Review requests, day-before reminders and snow-plan emails send on their own." },
  {
    kind: "crew_change",
    title: "Crew time off",
    skips: "Time off that hits a booked job or falls inside the notice window is approved automatically.",
  },
  { kind: "drop", title: "Crew drops", skips: "Crew can drop a job inside the notice window; the scheduler looks for cover." },
  { kind: "weather_hold", title: "Weather holds", skips: "Rain and snow holds from the weather watch are applied without asking." },
]

export function AutopilotForm({ initial }: { initial: AutopilotInput }) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [rules, setRules] = React.useState<AutopilotInput>(initial)
  const [maxDraft, setMaxDraft] = React.useState(initial.quote.max_total ?? 150)
  const dirty = JSON.stringify(rules) !== JSON.stringify(initial)

  const set = (kind: Kind, enabled: boolean) => setRules((r) => ({ ...r, [kind]: { ...r[kind], enabled } }))

  const save = () =>
    startTransition(async () => {
      const r = await saveAutopilot(rules)
      toast(r.ok ? { title: r.message ?? "Saved", variant: "success" } : { title: "Couldn't save autopilot", description: r.reason, variant: "destructive" })
    })

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        {KINDS.map(({ kind, title, skips }) => {
          const on = rules[kind].enabled
          return (
            <Card key={kind} className={cn("transition-colors", on && "border-brand-green-dark/60")}>
              <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <label htmlFor={`ap-${kind}`}>{title}</label>
                    {on ? <Badge variant="success">Autopilot</Badge> : <Badge variant="outline">Needs your OK</Badge>}
                  </CardTitle>
                  <CardDescription>{skips}</CardDescription>
                </div>
                <Switch id={`ap-${kind}`} checked={on} onCheckedChange={(v) => set(kind, v)} />
              </CardHeader>
              {kind === "quote" ? (
                <CardContent className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <Checkbox
                      checked={rules.quote.max_total === null}
                      onCheckedChange={(c) =>
                        setRules((r) => ({ ...r, quote: { ...r.quote, max_total: c === true ? null : maxDraft } }))
                      }
                    />
                    Any total
                  </label>
                  <NumberStepper
                    label="Only when the quote total is at most"
                    prefix="$"
                    min={0}
                    max={100000}
                    step={25}
                    value={rules.quote.max_total ?? maxDraft}
                    disabled={rules.quote.max_total === null}
                    onChange={(v) => {
                      setMaxDraft(v)
                      setRules((r) => ({ ...r, quote: { ...r.quote, max_total: v } }))
                    }}
                    className="max-w-xs"
                  />
                </CardContent>
              ) : null}
            </Card>
          )
        })}
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save autopilot rules"}
        </Button>
        {dirty ? <span className="text-sm text-ink-muted">Unsaved changes</span> : null}
      </div>
    </div>
  )
}
