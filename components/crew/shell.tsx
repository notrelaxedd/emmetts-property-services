import { LogOut } from "lucide-react"
import Image from "next/image"
import type * as React from "react"
import { signOut } from "@/app/login/actions"
import { CrewTabBar } from "./tab-bar"

/** Mobile-first crew chrome: sticky top bar, bottom tab bar, 480px column centred on desktop. */
export function CrewShell({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-gray-light">
      <div className="mx-auto min-h-dvh w-full max-w-[480px] bg-paper shadow-[0_0_0_1px_rgba(11,11,11,0.06)]">
        <header className="sticky top-0 z-sticky flex min-h-14 items-center justify-between gap-3 border-b border-ink/10 bg-paper px-4 pt-[env(safe-area-inset-top)]">
          <div className="flex min-w-0 items-center gap-2.5 py-2">
            <Image src="/logo.png" alt="" width={110} height={96} priority className="h-8 w-auto" />
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm font-bold text-ink">{name}</span>
              <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-brand-green-dark">
                Emmett&rsquo;s Crew
              </span>
            </div>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-ink hover:bg-ink/[0.06]"
            >
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </button>
          </form>
        </header>

        <main
          id="main"
          tabIndex={-1}
          className="px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-4 outline-none"
        >
          {children}
        </main>
      </div>
      <CrewTabBar />
    </div>
  )
}
