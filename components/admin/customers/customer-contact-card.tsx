"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Pencil } from "lucide-react"
import { deleteCustomer, updateCustomerContact, type CustomerContact } from "@/app/admin/actions/customers"
import { ConfirmDialog } from "@/components/admin/inbox/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/toast"
import { formatPhone } from "@/lib/ops/phone"

/**
 * The customer log's Contact card: name, phone, email, address and parcel, editable in place
 * (an address can be added once it's known), plus deleting the customer outright.
 */
export function CustomerContactCard({
  id,
  initial,
  since,
  counts,
  afterDeleteHref = "/admin/customers",
  inlineDeleteError = false,
  fullDeleteWarning = false,
}: {
  id: string
  initial: { name: string; email: string | null; phone: string | null; address: string | null; parcel_id: string | null }
  since: string
  /** What deleting also removes, for the confirm dialog. */
  counts: { jobs: number; quotes: number; leads: number }
  /** Where to go once the customer is deleted. */
  afterDeleteHref?: string
  /** Also show a failed delete's reason inside the confirm dialog (not only as a toast). */
  inlineDeleteError?: boolean
  /** Always list everything a delete removes (leads, quotes, jobs, messages, price log), even at zero. */
  fullDeleteWarning?: boolean
}) {
  const { toast } = useToast()
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [editing, setEditing] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const blank = (c: typeof initial): CustomerContact => ({
    name: c.name,
    email: c.email ?? "",
    phone: c.phone ? formatPhone(c.phone) : "",
    address: c.address ?? "",
    parcel_id: c.parcel_id ?? "",
  })
  const [v, setV] = React.useState<CustomerContact>(() => blank(initial))

  const startEdit = () => {
    setV(blank(initial))
    setEditing(true)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const r = await updateCustomerContact(id, v)
      if (r.ok) {
        toast({ title: r.message ?? "Saved", variant: "success" })
        setEditing(false)
      } else {
        toast({ title: "Couldn't save", description: r.reason, variant: "destructive" })
      }
    })
  }

  const remove = async () => {
    setDeleteError(null)
    const r = await deleteCustomer(id)
    if (!r.ok) {
      toast({ title: "Couldn't delete", description: r.reason, variant: "destructive" })
      if (inlineDeleteError) setDeleteError(r.reason)
      return false
    }
    toast({ title: r.message ?? "Deleted", variant: "success" })
    router.push(afterDeleteHref)
  }

  const field = (key: keyof CustomerContact, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`cc-${key}`}>{label}</Label>
      <Input id={`cc-${key}`} value={v[key]} onChange={(e) => setV((s) => ({ ...s, [key]: e.target.value }))} {...props} />
    </div>
  )

  const row = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="break-words text-ink">{value}</dd>
    </div>
  )

  const linked = [
    counts.jobs && `${counts.jobs} job${counts.jobs === 1 ? "" : "s"}`,
    counts.quotes && `${counts.quotes} quote${counts.quotes === 1 ? "" : "s"}`,
    counts.leads && `${counts.leads} lead${counts.leads === 1 ? "" : "s"}`,
  ].filter(Boolean)

  return (
    <Card className="h-fit">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Contact</CardTitle>
        {editing ? null : (
          <Button type="button" size="sm" variant="ghost" onClick={startEdit}>
            <Pencil /> Edit
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <form onSubmit={submit} className="space-y-3">
            {field("name", "Name", { required: true, maxLength: 120, autoComplete: "off" })}
            {field("phone", "Phone", { type: "tel", inputMode: "tel", maxLength: 40, placeholder: "(440) 555-0100" })}
            {field("email", "Email", { type: "email", maxLength: 254, placeholder: "name@example.com" })}
            {field("address", "Address", { maxLength: 300, placeholder: "123 Main St, City, OH 44000" })}
            {field("parcel_id", "Parcel", { maxLength: 80 })}
            <div className="flex gap-2 pt-1">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <dl className="space-y-2 text-sm">
            {row("Phone", initial.phone ? formatPhone(initial.phone) : "—")}
            {row("Email", <span className="break-all">{initial.email ?? "—"}</span>)}
            {row(
              "Address",
              initial.address ?? (
                <button type="button" className="text-ink-muted underline underline-offset-2 hover:text-ink" onClick={startEdit}>
                  No address yet — add one
                </button>
              ),
            )}
            {row("Parcel", initial.parcel_id ?? "—")}
            {row("Customer since", since)}
          </dl>
        )}
        <div className="mt-4 border-t border-ink/10 pt-3">
          <ConfirmDialog
            trigger="Delete customer"
            triggerVariant="ghost"
            title={`Delete ${initial.name}?`}
            description={
              fullDeleteWarning
                ? `This removes them and their leads, quotes, jobs, messages and price log${linked.length ? ` (${linked.join(", ")})` : ""}. It can't be undone.`
                : linked.length
                ? `This also deletes their ${linked.join(", ")}, messages and price log. It can't be undone.`
                : "This also deletes their messages and price log. It can't be undone."
            }
            confirmLabel="Delete customer"
            onConfirm={remove}
          >
            {inlineDeleteError && deleteError ? (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {deleteError}
              </p>
            ) : null}
          </ConfirmDialog>
        </div>
      </CardContent>
    </Card>
  )
}
