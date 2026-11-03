import { redirect } from "next/navigation"

/** Leads now live on Jobs: incoming requests, their estimates, and the calendar in one place. */
export default function Page() {
  redirect("/admin/schedule")
}
