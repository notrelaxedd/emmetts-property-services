import Image from "next/image";
import Link from "next/link";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

/**
 * Header lockup: the badge PNG plus a small wordmark. At 40–48px the badge's own lettering is too
 * small to read, so the wordmark carries the name.
 */
export function LogoLockup({ className }: { className?: string }) {
  return (
    <Link href="/" aria-label={`${siteConfig.name}, home`} className={cn("group flex items-center gap-3", className)}>
      <Image
        src="/logo.png"
        alt={`${siteConfig.name} logo`}
        width={96}
        height={96}
        priority
        className="h-10 w-auto transition-transform duration-300 ease-out-quart group-hover:-rotate-6 md:h-12"
      />
      <span className="flex flex-col leading-none">
        <span className="font-display text-[1.375rem] uppercase leading-none tracking-[0.01em] text-ink md:text-[1.5rem]">
          Emmett&rsquo;s
        </span>
        <span className="mt-1 text-[0.6875rem] font-bold uppercase leading-none tracking-[0.08em] text-brand-green-dark">
          Property Services
        </span>
      </span>
    </Link>
  );
}
