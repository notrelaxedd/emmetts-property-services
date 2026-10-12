"use client"

import * as React from "react"
import { X } from "lucide-react"
import { Button, type ButtonProps } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

/** "Reject" button + dialog asking for an optional note. */
export function RejectDialog({
  onReject,
  disabled,
  label = "Reject",
  title = "Reject this item?",
  description = "Nothing is sent. Add a note if you want to remember why.",
  variant = "outline",
}: {
  onReject: (note: string) => Promise<unknown> | void
  disabled?: boolean
  label?: string
  title?: string
  description?: string
  variant?: ButtonProps["variant"]
}) {
  const [open, setOpen] = React.useState(false)
  const [note, setNote] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const id = React.useId()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={variant} size="sm" disabled={disabled}>
          <X aria-hidden="true" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor={id}>Note (optional)</Label>
          <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={3} />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onReject(note)
                setOpen(false)
                setNote("")
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? "Rejecting…" : label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
