"use client"

import Link from "next/link"
import { CheckCircle2, ExternalLink } from "lucide-react"
import { markAdPosted } from "@/app/admin/actions/ads"
import { targetingSummary } from "@/components/admin/inbox/cards/ad-card"
import { CopyButton } from "@/components/admin/inbox/copy-button"
import { dateTime, label } from "@/components/admin/inbox/format"
import { useActionRunner } from "@/components/admin/inbox/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
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

export function AdItem({ ad }: { ad: Ad }) {
  const { pending, run } = useActionRunner()
  const dest = AD_DESTINATIONS[ad.channel]
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{label(ad.channel)}</Badge>
          <Badge variant={STATUS_VARIANT[ad.status]}>{label(ad.status)}</Badge>
          {ad.season ? <Badge variant="secondary">{label(ad.season)}</Badge> : null}
          <span className="ml-auto text-xs text-ink-muted">{dateTime(ad.created_at)}</span>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-2">
        <p className="font-semibold text-ink">{ad.headline}</p>
        <p className="whitespace-pre-line text-sm text-ink-body">{ad.body}</p>
        {ad.cta ? <p className="inline-block rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white">{ad.cta}</p> : null}
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
        <CopyButton text={adCopyText(ad)} label="Copy text" />
        {ad.status === "draft" ? (
          <Button asChild size="sm" variant="ghost">
            <Link href="/admin?filter=ads">Review in inbox</Link>
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
      </CardFooter>
    </Card>
  )
}
