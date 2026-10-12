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
import { AUTOPILOT_KINDS as KINDS, HIDDEN_AUTOPILOT_NOTE, type AutopilotKind } from "./kinds"

type Kind = AutopilotKind

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
      <p className="text-sm text-ink-muted">{HIDDEN_AUTOPILOT_NOTE}</p>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save autopilot rules"}
        </Button>
        {dirty ? <span className="text-sm text-ink-muted">Unsaved changes</span> : null}
      </div>
    </div>
  )
}
