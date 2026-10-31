import { QuoteDetailBody } from "@/components/admin/stages/quotes-body"
import { requireOwner } from "@/lib/auth/session"

export const dynamic = "force-dynamic"
export const metadata = { title: "Quote review" }

export default async function QuotePage({ params }: { params: { id: string } }) {
  await requireOwner()
  return <QuoteDetailBody id={params.id} />
}
