"use client"

import * as React from "react"
import { Check, Copy } from "lucide-react"
import { Button, type ButtonProps } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"

/** Copies `text` to the clipboard and flips to a check for a moment. */
export function CopyButton({
  text,
  label = "Copy",
  variant = "outline",
  size = "sm",
}: {
  text: string
  label?: string
  variant?: ButtonProps["variant"]
  size?: ButtonProps["size"]
}) {
  const { toast } = useToast()
  const [copied, setCopied] = React.useState(false)
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        } catch {
          toast({ title: "Couldn't copy", description: "Select the text and copy it by hand.", variant: "destructive" })
        }
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied ? "Copied" : label}
    </Button>
  )
}
