import type { Metadata, Viewport } from "next"
import { CrewShell } from "@/components/crew/shell"
import { ToastProvider } from "@/components/ui/toast"
import { requireCrew } from "@/lib/auth/session"

export const metadata: Metadata = {
  title: { default: "Emmett’s Crew", template: "%s | Emmett’s Crew" },
  robots: { index: false, follow: false },
  // Linked here only, so the marketing site doesn't advertise an installable app.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Emmett’s Crew", statusBarStyle: "default" },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F7F7F6",
}

export const dynamic = "force-dynamic"

export default async function CrewLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await requireCrew()
  return (
    <ToastProvider>
      <CrewShell name={session.profile.name}>{children}</CrewShell>
    </ToastProvider>
  )
}
