import { parseQuoteStatus, QuotesBody } from "@/components/admin/stages/quotes-body"
import { requireOwner } from "@/lib/auth/session"

export const dynamic = "force-dynamic"
export const metadata = { title: "Quotes" }

export default async function QuotesPage({ searchParams }: { searchParams: { status?: string } }) {
  await requireOwner()
  return <QuotesBody status={parseQuoteStatus(searchParams.status)} />
}
