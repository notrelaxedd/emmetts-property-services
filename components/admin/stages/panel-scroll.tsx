"use client"

import * as React from "react"

/**
 * Brings the stage panel into view when a stage or record opens and the panel's top is off screen
 * (on a phone the stacked boxes push it below the fold). Re-renders after a save keep `view`, so they
 * never scroll.
 */
export function PanelScroll({ view }: { view: string }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useEffect(() => {
    const panel = ref.current?.closest("section")
    if (!panel) return
    const top = panel.getBoundingClientRect().top
    if (top < 0 || top > window.innerHeight * 0.6) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      panel.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" })
    }
  }, [view])
  return <span ref={ref} hidden />
}
