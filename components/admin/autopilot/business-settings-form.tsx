"use client"

import * as React from "react"
import { saveBusinessSettings, type BusinessSettingsInput } from "@/app/admin/actions/autopilot"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/toast"

type Field = {
  key: keyof BusinessSettingsInput
  label: string
  hint?: string
  /** Shown as percent; stored as a fraction. */
  percent?: boolean
  prefix?: string
  suffix?: string
  nullable?: boolean
  /** Blank means an open question for the owner (docs/PLAN.md). */
  todo?: string
  type?: "number" | "text" | "email"
  step?: number
}

const FIELDS: Field[] = [
  { key: "default_wage", label: "Default crew wage", prefix: "$", suffix: "/hr", step: 0.25 },
  { key: "margin", label: "Target margin", percent: true, suffix: "%", step: 1, hint: "price = labor ÷ (1 − margin)" },
  { key: "min_job_price", label: "Minimum job price", prefix: "$", nullable: true, todo: "MIN PRICE", step: 5 },
  { key: "card_fee_pct", label: "Card fee", percent: true, suffix: "%", step: 0.1 },
  { key: "card_fee_fixed", label: "Card fee (fixed)", prefix: "$", step: 0.01 },
  { key: "drop_notice_hours", label: "Drop notice window", suffix: "hours", step: 1, hint: "Drops/time off inside this need your OK" },
  { key: "quote_valid_days", label: "Quotes valid for", suffix: "days", step: 1 },
  { key: "ai_monthly_cap", label: "AI monthly spend cap", prefix: "$", nullable: true, todo: "CAP $", step: 5, hint: "Blank = no cap" },
  { key: "partner_tree_service_name", label: "Partner tree service", type: "text", nullable: true, todo: "PARTNER" },
  { key: "partner_tree_service_email", label: "Partner email", type: "email", nullable: true, todo: "PARTNER EMAIL" },
  { key: "base_lat", label: "Base latitude", nullable: true, step: 0.0001, hint: "Service-area centre for weather & drive time" },
  { key: "base_lng", label: "Base longitude", nullable: true, step: 0.0001 },
]

function toText(f: Field, v: unknown): string {
  if (v === null || v === undefined) return ""
  if (f.percent && typeof v === "number") return String(Math.round(v * 10000) / 100)
  return String(v)
}

export function BusinessSettingsForm({ initial }: { initial: BusinessSettingsInput }) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, toText(f, initial[f.key])])),
  )

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const out: Record<string, unknown> = {}
    for (const f of FIELDS) {
      const raw = values[f.key].trim()
      if (f.type === "text" || f.type === "email") {
        out[f.key] = raw === "" ? null : raw
        continue
      }
      if (raw === "") {
        if (!f.nullable) {
          toast({ title: `${f.label} is required`, variant: "destructive" })
          return
        }
        out[f.key] = null
        continue
      }
      const n = Number(raw)
      if (!Number.isFinite(n)) {
        toast({ title: `${f.label} must be a number`, variant: "destructive" })
        return
      }
      out[f.key] = f.percent ? Math.round(n * 100) / 10000 : n
    }
    startTransition(async () => {
      const r = await saveBusinessSettings(out as BusinessSettingsInput)
      toast(r.ok ? { title: r.message ?? "Saved", variant: "success" } : { title: "Couldn't save settings", description: r.reason, variant: "destructive" })
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {FIELDS.map((f) => {
          const id = `bs-${f.key}`
          const missing = f.todo && values[f.key].trim() === ""
          return (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={id} className="flex items-center gap-2">
                {f.label}
                {missing ? (
                  <Badge variant="warning" title="Open question in docs/PLAN.md">
                    TODO [{f.todo}]
                  </Badge>
                ) : null}
              </Label>
              <div className="flex items-center gap-1.5">
                {f.prefix ? <span className="text-sm text-ink-muted">{f.prefix}</span> : null}
                <Input
                  id={id}
                  type={f.type ?? "number"}
                  inputMode={f.type ? undefined : "decimal"}
                  step={f.type ? undefined : (f.step ?? "any")}
                  value={values[f.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
                {f.suffix ? <span className="whitespace-nowrap text-sm text-ink-muted">{f.suffix}</span> : null}
              </div>
              {f.hint ? <p className="text-xs text-ink-muted">{f.hint}</p> : null}
            </div>
          )
        })}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save business settings"}
      </Button>
    </form>
  )
}
