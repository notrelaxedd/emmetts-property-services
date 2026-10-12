"use client"

import * as React from "react"
import { Trash2 } from "lucide-react"
import { addExpense, deleteExpense } from "@/app/admin/actions/money"
import { EXPENSE_CATEGORIES, usd } from "@/app/admin/money/math"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/components/ui/toast"

export type ExpenseRow = { id: string; date: string; category: string; amount: number; note: string | null }

export function ExpenseForm({ defaultDate }: { defaultDate: string }) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [date, setDate] = React.useState(defaultDate)
  const [category, setCategory] = React.useState<string>("fuel")
  const [amount, setAmount] = React.useState("")
  const [note, setNote] = React.useState("")

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const r = await addExpense({ date, category, amount: Number(amount), note: note.trim() || null })
      if (r.ok) {
        toast({ title: r.message ?? "Added", variant: "success" })
        setAmount("")
        setNote("")
      } else toast({ title: "Couldn't add the expense", description: r.reason, variant: "destructive" })
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[9.5rem_9rem_8rem_1fr_auto] lg:items-end">
      <div className="space-y-1.5">
        <Label htmlFor="exp-date">Date</Label>
        <Input id="exp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="exp-cat">Category</Label>
        <NativeSelect id="exp-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c[0].toUpperCase() + c.slice(1)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="exp-amount">Amount ($)</Label>
        <Input id="exp-amount" type="number" inputMode="decimal" min={0.01} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="exp-note">Note</Label>
        <Input id="exp-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Gas for the mower" />
      </div>
      <Button type="submit" disabled={pending || !amount}>
        Add expense
      </Button>
    </form>
  )
}

export function ExpensesTable({ rows }: { rows: ExpenseRow[] }) {
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const remove = (r: ExpenseRow) => {
    if (!window.confirm(`Delete the ${usd(r.amount)} ${r.category} expense?`)) return
    startTransition(async () => {
      const res = await deleteExpense(r.id)
      toast(res.ok ? { title: res.message ?? "Deleted", variant: "success" } : { title: "Couldn't delete", description: res.reason, variant: "destructive" })
    })
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Note</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="text-right">
            <span className="sr-only">Delete</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="whitespace-nowrap">{r.date}</TableCell>
            <TableCell>
              <Badge variant="outline">{r.category}</Badge>
            </TableCell>
            <TableCell className="max-w-[20rem] truncate">{r.note ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{usd(r.amount)}</TableCell>
            <TableCell className="text-right">
              <Button variant="ghost" size="icon" className="size-8" disabled={pending} onClick={() => remove(r)}>
                <Trash2 />
                <span className="sr-only">Delete expense</span>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
