"use client"

import { AdCard } from "./cards/ad-card"
import { AiCapCard } from "./cards/ai-cap-card"
import { BookingCard } from "./cards/booking-card"
import { CrewChangeCard } from "./cards/crew-change-card"
import { CustomItemCard } from "./cards/custom-item-card"
import { DropCard } from "./cards/drop-card"
import { FollowupCard } from "./cards/followup-card"
import { QuoteCard } from "./cards/quote-card"
import { WeatherHoldCard } from "./cards/weather-hold-card"
import type { InboxEntry } from "./types"

/** Picks the kind-specific card for one pending approval. */
export function InboxCard({ entry }: { entry: InboxEntry }) {
  const { approval, context } = entry
  switch (context.kind) {
    case "quote":
      return <QuoteCard approval={approval} context={context} />
    case "custom_item":
      return <CustomItemCard approval={approval} context={context} />
    case "ad":
      return <AdCard approval={approval} context={context} />
    case "booking":
      return <BookingCard approval={approval} context={context} />
    case "followup":
      return <FollowupCard approval={approval} context={context} />
    case "crew_change":
      return <CrewChangeCard approval={approval} context={context} />
    case "drop":
      return <DropCard approval={approval} context={context} />
    case "weather_hold":
      return <WeatherHoldCard approval={approval} context={context} />
    case "ai_cap":
      return <AiCapCard approval={approval} context={context} />
  }
}
