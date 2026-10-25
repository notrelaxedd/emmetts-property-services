"use client"

import * as React from "react"
import { updateCustomer, type CustomerPatch } from "@/app/admin/actions/customers"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"

export function CustomerEditForm({ id, initial }: { id: string; initial: CustomerPatch }) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [v, setV] = React.useState(initial)
  const [acres, setAcres] = React.useState(initial.lot_acres === null ? "" : String(initial.lot_acres))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const lot = acres.trim() === "" ? null : Number(acres)
    if (lot !== null && (!Number.isFinite(lot) || lot < 0)) {
      toast({ title: "Lot size must be a number of acres", variant: "destructive" })
      return
    }
    startTransition(async () => {
      const r = await updateCustomer(id, { ...v, address: v.address?.trim() || null, lot_acres: lot })
      toast(r.ok ? { title: r.message ?? "Saved", variant: "success" } : { title: "Couldn't save", description: r.reason, variant: "destructive" })
    })
  }

  const box = (key: "email_opt_in" | "sms_opt_in" | "snow_list", label: string, hint: string) => (
    <label className="flex items-start gap-2.5 text-sm">
      <Checkbox className="mt-0.5" checked={v[key]} onCheckedChange={(c) => setV((s) => ({ ...s, [key]: c === true }))} />
      <span>
        <span className="font-medium text-ink">{label}</span>
        <span className="block text-xs text-ink-muted">{hint}</span>
      </span>
    </label>
  )

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="c-address">Address</Label>
        <Input
          id="c-address"
          value={v.address ?? ""}
          maxLength={200}
          onChange={(e) => setV((s) => ({ ...s, address: e.target.value }))}
          placeholder="123 Main St, Rocky River, OH 44116"
          autoComplete="off"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {box("email_opt_in", "Email updates", "Reviews, seasonal offers")}
        {box("sms_opt_in", "Texts", "Reminders by SMS")}
        {box("snow_list", "Snow list", "Gets snow-plan emails")}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="c-acres">Lot size (acres)</Label>
          <Input id="c-acres" type="number" min={0} step={0.01} inputMode="decimal" value={acres} onChange={(e) => setAcres(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-trees">Tree cover</Label>
          <NativeSelect
            id="c-trees"
            value={v.tree_cover ?? ""}
            onChange={(e) => setV((s) => ({ ...s, tree_cover: (e.target.value || null) as CustomerPatch["tree_cover"] }))}
          >
            <option value="">Unknown</option>
            <option value="none">None</option>
            <option value="light">Light</option>
            <option value="medium">Medium</option>
            <option value="heavy">Heavy</option>
          </NativeSelect>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="c-notes">Notes</Label>
        <Textarea
          id="c-notes"
          rows={4}
          maxLength={5000}
          value={v.notes ?? ""}
          onChange={(e) => setV((s) => ({ ...s, notes: e.target.value }))}
          placeholder="Gate code, dog in yard, prefers mornings…"
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save customer"}
      </Button>
    </form>
  )
}
