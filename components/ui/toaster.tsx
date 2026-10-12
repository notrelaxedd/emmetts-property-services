"use client"

/**
 * shadcn-style entry point. `Toaster` is the provider (state + viewport in one), so mount it once
 * around the tree: `<Toaster>{children}</Toaster>`. Same component as `ToastProvider`.
 */
export { ToastProvider as Toaster } from "./toast"
