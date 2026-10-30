"use client"

import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"

/** Opens the browser's print dialog; the page's print CSS leaves only the hanger sheet. */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button type="button" onClick={() => window.print()}>
      <Printer /> {label}
    </Button>
  )
}
