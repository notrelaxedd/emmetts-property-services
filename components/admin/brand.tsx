import Image from "next/image"
import Link from "next/link"

/** Compact console lockup. Links to the inbox (not the marketing site). */
export function AdminBrand() {
  return (
    <Link href="/admin" className="flex items-center gap-2.5" aria-label="Owner console home">
      <Image src="/logo.png" alt="" width={110} height={96} priority className="h-9 w-auto" />
      <span className="flex flex-col leading-none">
        <span className="font-display text-xl uppercase leading-none tracking-[0.01em] text-ink">Emmett&rsquo;s</span>
        <span className="mt-1 text-[0.625rem] font-bold uppercase leading-none tracking-[0.08em] text-brand-green-dark">
          Owner console
        </span>
      </span>
    </Link>
  )
}
