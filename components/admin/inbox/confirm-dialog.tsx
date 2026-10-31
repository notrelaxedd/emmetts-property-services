"use client"

import * as React from "react"
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

/** A trigger button + confirm dialog. `children` renders extra fields inside the dialog. */
export function ConfirmDialog({
  trigger,
  triggerVariant = "outline",
  triggerClassName,
  title,
  description,
  confirmLabel,
  confirmVariant = "default",
  onConfirm,
  disabled,
  confirmDisabled,
  children,
}: {
  trigger: React.ReactNode
  triggerVariant?: ButtonProps["variant"]
  /** Extra classes for the trigger button (e.g. a taller touch target). */
  triggerClassName?: string
  title: string
  description?: React.ReactNode
  confirmLabel: string
  confirmVariant?: ButtonProps["variant"]
  /** Return `false` to keep the dialog open. */
  onConfirm: () => Promise<unknown> | unknown
  disabled?: boolean
  confirmDisabled?: boolean
  children?: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant={triggerVariant} disabled={disabled} className={triggerClassName}>
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            disabled={busy || confirmDisabled}
            onClick={async () => {
              setBusy(true)
              try {
                const keep = await onConfirm()
                if (keep !== false) setOpen(false)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
