"use client"

import * as React from "react"
import { Sparkles } from "lucide-react"
import { draftNewAd } from "@/app/admin/actions/ads"
import { useActionRunner } from "@/components/admin/inbox/use-action"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"

const SEASONS = ["spring", "summer", "fall", "winter"] as const

function currentSeason(): (typeof SEASONS)[number] {
  const m = new Date().getMonth()
  if (m >= 2 && m <= 4) return "spring"
  if (m >= 5 && m <= 7) return "summer"
  if (m >= 8 && m <= 10) return "fall"
  return "winter"
}

/** Queues an `ad_draft` fleet task; Claude's draft comes back as an inbox card. */
export function DraftAdForm() {
  const { pending, run } = useActionRunner()
  const [channel, setChannel] = React.useState("facebook")
  const [season, setSeason] = React.useState<string>(currentSeason)
  const [offer, setOffer] = React.useState("")
  const ids = { c: React.useId(), s: React.useId(), o: React.useId() }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-brand-green-dark" aria-hidden="true" /> Draft a new ad
        </CardTitle>
        <CardDescription>The ads worker writes it with Claude and sends it to your inbox for approval.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            void run(() => draftNewAd({ channel, season, offer }), { onSuccess: () => setOffer("") })
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={ids.c}>Channel</Label>
            <NativeSelect id={ids.c} value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="facebook">Facebook</option>
              <option value="instagram">Instagram</option>
              <option value="nextdoor">Nextdoor</option>
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={ids.s}>Season</Label>
            <NativeSelect id={ids.s} value={season} onChange={(e) => setSeason(e.target.value)}>
              {SEASONS.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={ids.o}>Offer (optional)</Label>
            <Input
              id={ids.o}
              value={offer}
              maxLength={300}
              onChange={(e) => setOffer(e.target.value)}
              placeholder="e.g. $20 off first fall cleanup"
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Queuing…" : "Draft ad"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
