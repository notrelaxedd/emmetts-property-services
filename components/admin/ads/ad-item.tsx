"use client"

import * as React from "react"
import Link from "next/link"
import { Check, CheckCircle2, ExternalLink, ImageIcon, Pencil, Trash2 } from "lucide-react"
import { deleteAd, markAdPosted, updateAd } from "@/app/admin/actions/ads"
import { targetingSummary } from "@/components/admin/inbox/cards/ad-card"
import { CopyButton } from "@/components/admin/inbox/copy-button"
import { dateTime, label } from "@/components/admin/inbox/format"
import { useActionRunner, useDecide } from "@/components/admin/inbox/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { Ad, AdChannel, AdStatus } from "@/lib/db/types"

/** v1 doesn't auto-post: plain outbound links to where the owner pastes the copy. */
export const AD_DESTINATIONS: Record<AdChannel, { href: string; label: string }> = {
  facebook: { href: "https://adsmanager.facebook.com/", label: "Open Ads Manager" },
  instagram: { href: "https://adsmanager.facebook.com/", label: "Open Ads Manager" },
  nextdoor: { href: "https://nextdoor.com/", label: "Open Nextdoor" },
}

const STATUS_VARIANT: Record<AdStatus, "warning" | "success" | "secondary"> = {
  draft: "warning",
  approved: "success",
  posted: "secondary",
}

export function adCopyText(ad: Pick<Ad, "headline" | "body" | "cta">): string {
  return [ad.headline, ad.body, ad.cta].filter(Boolean).join("\n\n")
}

/** True when `image_path` is something a browser can load directly (absolute URL or a site path). */
function imageSrc(path: string | null): string | null {
  if (!path) return null
  return /^https?:\/\//i.test(path) || path.startsWith("/") ? path : null
}

/** How the post will look: the ad's image, or a branded block where the image goes. */
function AdPreview({ ad }: { ad: Ad }) {
  const src = imageSrc(ad.image_path)
  return (
    <div className="-mx-4 mb-2 overflow-hidden border-y border-ink/10 bg-brand-green/15">
      {src ? (
        // Ad images are plain URLs (no next/image config for them).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="aspect-video w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-1.5 text-brand-green-dark">
          <ImageIcon className="size-8" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wide">{ad.image_path ? "Image on file" : "Add a photo when you post"}</span>
          {ad.image_path ? <span className="max-w-[90%] truncate font-mono text-[0.6875rem] text-ink-muted">{ad.image_path}</span> : null}
        </div>
      )}
    </div>
  )
}

/**
 * One ad. On the Ads page it's the plain card; with `preview` (the front page's Ads stage) it shows the
 * post as it will look (image or a branded block) and, for a draft with its pending inbox card
 * (`approvalId`), an Approve button that runs the same decision as the inbox ad card.
 */
export function AdItem({ ad, preview = false, approvalId = null }: { ad: Ad; preview?: boolean; approvalId?: string | null }) {
  const { pending: runPending, run } = useActionRunner()
  const d = useDecide(approvalId ?? "")
  const pending = runPending || d.pending
  const dest = AD_DESTINATIONS[ad.channel]
  const original = { headline: ad.headline, body: ad.body, cta: ad.cta ?? "", offer: ad.offer ?? "" }
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(original)
  const ids = { h: React.useId(), b: React.useId(), c: React.useId(), o: React.useId() }
  const startEdit = () => {
    setDraft(original)
    setEditing(true)
  }
  const save = () => void run(() => updateAd(ad.id, draft), { onSuccess: () => setEditing(false) })
  const remove = () => {
    if (!window.confirm(`Delete "${ad.headline}"? This can't be undone.`)) return
    void run(() => deleteAd(ad.id))
  }
  return (
    <Card className={preview ? "flex h-full flex-col overflow-hidden" : "flex h-full flex-col"}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{label(ad.channel)}</Badge>
          <Badge variant={STATUS_VARIANT[ad.status]}>{label(ad.status)}</Badge>
          {ad.season ? <Badge variant="secondary">{label(ad.season)}</Badge> : null}
          {ad.topic ? <Badge variant="secondary">{ad.topic}</Badge> : null}
          <span className="ml-auto text-xs text-ink-muted">{dateTime(ad.created_at)}</span>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-2">
        {preview ? <AdPreview ad={ad} /> : null}
        {editing ? (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={ids.h}>Headline</Label>
              <Input id={ids.h} value={draft.headline} maxLength={200} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={ids.b}>Body</Label>
              <Textarea id={ids.b} rows={6} value={draft.body} maxLength={3000} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={ids.c}>Call to action</Label>
              <Input id={ids.c} value={draft.cta} maxLength={100} onChange={(e) => setDraft({ ...draft, cta: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={ids.o}>Offer</Label>
              <Input id={ids.o} value={draft.offer} maxLength={300} onChange={(e) => setDraft({ ...draft, offer: e.target.value })} />
            </div>
          </div>
        ) : (
          <>
            <p className="font-semibold text-ink">{ad.headline}</p>
            <p className="whitespace-pre-line text-sm text-ink-body">{ad.body}</p>
            {ad.cta ? <p className="inline-block rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white">{ad.cta}</p> : null}
          </>
        )}
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 pt-1 text-xs">
          <dt className="text-ink-muted">UTM</dt>
          <dd className="break-all font-mono text-ink">{ad.utm_code}</dd>
          {ad.offer ? (
            <>
              <dt className="text-ink-muted">Offer</dt>
              <dd className="text-ink">{ad.offer}</dd>
            </>
          ) : null}
          <dt className="text-ink-muted">Targeting</dt>
          <dd className="text-ink">{targetingSummary(ad.targeting)}</dd>
          {ad.posted_at ? (
            <>
              <dt className="text-ink-muted">Posted</dt>
              <dd className="text-ink">{dateTime(ad.posted_at)}</dd>
            </>
          ) : null}
        </dl>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t border-ink/10 pt-3">
        {editing ? (
          <>
            <Button type="button" size="sm" disabled={pending} onClick={save}>
              <Check aria-hidden="true" />
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </>
        ) : (
          actions()
        )}
      </CardFooter>
    </Card>
  )

  function actions() {
    return (
      <>
        <CopyButton text={adCopyText(ad)} label="Copy text" />
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={startEdit}>
          <Pencil aria-hidden="true" />
          Edit
        </Button>
        {ad.status === "draft" && preview && approvalId ? (
          <Button type="button" size="sm" disabled={pending} onClick={() => void d.decide("approved")}>
            <Check aria-hidden="true" />
            {d.pending ? "Approving…" : "Approve"}
          </Button>
        ) : null}
        {ad.status === "draft" ? (
          <Button asChild size="sm" variant="ghost">
            <Link href="/admin/inbox?filter=ads">Review in inbox</Link>
          </Button>
        ) : (
          <Button asChild size="sm" variant="outline">
            <a href={dest.href} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden="true" />
              {dest.label}
            </a>
          </Button>
        )}
        {ad.status === "approved" ? (
          <Button type="button" size="sm" disabled={pending} onClick={() => void run(() => markAdPosted(ad.id))}>
            <CheckCircle2 aria-hidden="true" />
            {pending ? "Saving…" : "Mark posted"}
          </Button>
        ) : null}
        {ad.status !== "posted" ? (
          <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={remove}>
            <Trash2 aria-hidden="true" />
            Delete
          </Button>
        ) : null}
      </>
    )
  }
}
