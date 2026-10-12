"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { Photo } from "./types"

/**
 * Thumbnails of signed `lead-photos` URLs; clicking one opens a lightbox. Signed URLs expire after
 * an hour, so plain <img> (not next/image, which would cache them under a stale key).
 */
export function PhotoGallery({ photos, size = "md" }: { photos: Photo[]; size?: "sm" | "md" }) {
  const [index, setIndex] = React.useState<number | null>(null)
  if (!photos.length) return <p className="text-sm text-ink-muted">No photos.</p>
  const current = index === null ? null : photos[index]
  const thumb = size === "sm" ? "size-16" : "size-24"

  return (
    <>
      <ul className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <li key={p.path}>
            <button
              type="button"
              onClick={() => p.url && setIndex(i)}
              disabled={!p.url}
              className={cn(
                "relative block overflow-hidden rounded-md border border-ink/15 bg-gray-light",
                thumb,
                p.url && "hover:ring-2 hover:ring-brand-green",
              )}
              aria-label={`Open photo ${i + 1} of ${photos.length}`}
            >
              {p.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.url} alt="" className="size-full object-cover" loading="lazy" />
              ) : (
                <span className="flex size-full items-center justify-center text-ink-muted">
                  <ImageOff className="size-5" aria-hidden="true" />
                  <span className="sr-only">Photo unavailable</span>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={index !== null} onOpenChange={(o) => !o && setIndex(null)}>
        <DialogContent className="max-w-4xl bg-ink p-3 text-white">
          <DialogTitle className="sr-only">
            Photo {index !== null ? index + 1 : ""} of {photos.length}
          </DialogTitle>
          <DialogDescription className="sr-only">Customer photo</DialogDescription>
          {current?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.url} alt={`Customer photo ${(index ?? 0) + 1}`} className="max-h-[78vh] w-full rounded object-contain" />
          ) : null}
          {photos.length > 1 ? (
            <div className="flex items-center justify-between">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-white hover:bg-white/10 hover:text-white"
                onClick={() => setIndex((i) => (i === null ? 0 : (i - 1 + photos.length) % photos.length))}
              >
                <ChevronLeft aria-hidden="true" /> Prev
              </Button>
              <span className="text-sm tabular-nums">
                {(index ?? 0) + 1} / {photos.length}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-white hover:bg-white/10 hover:text-white"
                onClick={() => setIndex((i) => (i === null ? 0 : (i + 1) % photos.length))}
              >
                Next <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
