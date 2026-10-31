import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

/** Knock became Walk Mode; old bookmarks and the installed app's shortcut land here. */
export default function CrewKnockPage() {
  redirect("/crew/walk")
}
