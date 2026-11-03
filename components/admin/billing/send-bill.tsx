import { Mail, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { billMessage, mailtoHref, smsHref, type BillMessageInput } from "@/lib/billing/message"

/** "Text bill" / "Email bill": open the owner's Messages or mail app with the bill written out. */
export function SendBill({ bill, phone, email }: { bill: BillMessageInput; phone: string | null; email: string | null }) {
  if (!phone && !email) return <span className="text-xs text-ink-muted">No phone or email on file</span>
  const { subject, body } = billMessage(bill)
  return (
    <div className="flex gap-1.5">
      {phone ? (
        <Button asChild size="sm" variant="outline">
          <a href={smsHref(phone, body)}>
            <MessageSquare aria-hidden="true" /> Text bill
          </a>
        </Button>
      ) : null}
      {email ? (
        <Button asChild size="sm" variant="outline">
          <a href={mailtoHref(email, subject, body)}>
            <Mail aria-hidden="true" /> Email
          </a>
        </Button>
      ) : null}
    </div>
  )
}
