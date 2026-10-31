import { redirect } from "next/navigation"

/** The Stats tab became Insights (summary + stats + hanger conversions + pitches). Old links and bookmarks land there. */
export default function CanvassStatsRedirect() {
  redirect("/admin/canvass/insights")
}
