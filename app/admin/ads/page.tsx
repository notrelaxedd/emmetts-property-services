import { AdsBody, parseAdStatus } from "@/components/admin/stages/ads-body"
import { requireOwner } from "@/lib/auth/session"

export const dynamic = "force-dynamic"
export const metadata = { title: "Ads" }

export default async function AdsPage({ searchParams }: { searchParams: { status?: string } }) {
  await requireOwner()
  return <AdsBody status={parseAdStatus(searchParams.status)} />
}
