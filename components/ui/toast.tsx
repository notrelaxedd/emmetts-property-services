"use client"

import * as React from "react"
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react"

import { cn } from "@/lib/utils"

export type ToastVariant = "default" | "success" | "destructive"

export interface ToastOptions {
  title: string
  description?: string
  variant?: ToastVariant
  /** Milliseconds before auto-dismiss. Default 4500; 0 keeps it until dismissed. */
  duration?: number
}

interface ToastItem extends ToastOptions {
  id: string
}

interface ToastContextValue {
  /** Show a toast. Returns its id (pass to `dismiss`). */
  toast: (options: ToastOptions) => string
  dismiss: (id?: string) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

/**
 * `const { toast } = useToast(); toast({ title: "Saved", variant: "success" })`.
 * Outside a ToastProvider this returns no-ops rather than throwing.
 */
export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext)
  return ctx ?? { toast: () => "", dismiss: () => {} }
}

const icons = {
  default: Info,
  success: CheckCircle2,
  destructive: AlertCircle,
} as const

const styles: Record<ToastVariant, string> = {
  default: "border-ink/15 bg-white text-ink",
  success: "border-brand-green-dark/50 bg-white text-ink",
  destructive: "border-destructive/60 bg-white text-ink",
}

const iconStyles: Record<ToastVariant, string> = {
  default: "text-ink-muted",
  success: "text-brand-green-dark",
  destructive: "text-destructive",
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const variant = item.variant ?? "default"
  const Icon = icons[variant]
  const duration = item.duration ?? 4500

  React.useEffect(() => {
    if (duration <= 0) return
    const t = window.setTimeout(() => onDismiss(item.id), duration)
    return () => window.clearTimeout(t)
  }, [duration, item.id, onDismiss])

  return (
    <div
      role={variant === "destructive" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex w-full items-start gap-3 rounded-lg border p-3 shadow-lg animate-in fade-in-0 slide-in-from-bottom-2",
        styles[variant]
      )}
    >
      <Icon className={cn("mt-0.5 size-5 shrink-0", iconStyles[variant])} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-tight">{item.title}</p>
        {item.description ? <p className="mt-0.5 text-sm leading-snug text-ink-muted">{item.description}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        className="-m-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-accent hover:text-ink"
      >
        <X className="size-4" aria-hidden="true" />
        <span className="sr-only">Dismiss</span>
      </button>
    </div>
  )
}

const MAX_TOASTS = 4

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([])
  const counter = React.useRef(0)

  const dismiss = React.useCallback((id?: string) => {
    setItems((prev) => (id ? prev.filter((t) => t.id !== id) : []))
  }, [])

  const toast = React.useCallback((options: ToastOptions) => {
    counter.current += 1
    const id = `toast-${counter.current}`
    setItems((prev) => [...prev, { ...options, id }].slice(-MAX_TOASTS))
    return id
  }, [])

  const value = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-toast flex flex-col items-center gap-2 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:items-end"
      >
        <div className="flex w-full max-w-sm flex-col gap-2">
          {items.map((item) => (
            <ToastView key={item.id} item={item} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  )
}
