import Image from "next/image";
import Link from "next/link";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

/** The badge's lettering set in type: a heavy EMMETT'S over a ruled, letterspaced PROPERTY SERVICES. */
export function Wordmark({ size = "sm", className }: { size?: "sm" | "lg"; className?: string }) {
  const lg = size === "lg";
  const rule = cn("h-px bg-forest/50", lg ? "w-6" : "w-2");
  return (
    <span className={cn("flex flex-col items-center leading-none text-forest", className)}>
      <span className={cn("font-heading font-black uppercase leading-none tracking-[0.02em]", lg ? "text-[2.5rem]" : "text-[1.3125rem]")}>
        Emmett&rsquo;s
      </span>
      <span
        className={cn(
          "flex items-center whitespace-nowrap font-heading font-semibold uppercase leading-none",
          lg ? "mt-3 gap-3 text-xs tracking-[0.3em]" : "mt-1.5 gap-1.5 text-[0.5rem] tracking-[0.24em]",
        )}
      >
        <span aria-hidden="true" className={rule} />
        {/* Left padding balances the trailing letter-spacing so the rules sit evenly. */}
        <span className={lg ? "pl-[0.3em]" : "pl-[0.24em]"}>Property Services</span>
        <span aria-hidden="true" className={rule} />
      </span>
    </span>
  );
}

/**
 * Header lockup: the badge plus the wordmark in type. At 44-48px the badge's own lettering is too
 * small to read, so the type carries the name.
 */
export function LogoLockup({ className }: { className?: string }) {
  return (
    <Link href="/" aria-label={`${siteConfig.name}, home`} className={cn("flex shrink-0 items-center gap-3", className)}>
      <Image src="/logo.png" alt={`${siteConfig.name} logo`} width={110} height={96} priority className="h-11 w-auto md:h-12" />
      <Wordmark />
    </Link>
  );
}
