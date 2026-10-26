import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The quiet text link: letterspaced caps on a hairline underline, arrow nudging on hover. When a long
 * label wraps, the last word and the arrow move down together; the padding makes a 44px target.
 */
export function ArrowLink({ href, children, className }: { href: string; children: string; className?: string }) {
  const split = children.lastIndexOf(" ") + 1;
  return (
    <Link
      href={href}
      className={cn(
        "group inline-block py-3 font-heading text-[0.8125rem] font-semibold uppercase leading-5 tracking-[0.16em] text-forest",
        className,
      )}
    >
      <span className="underline decoration-forest/30 decoration-1 underline-offset-[7px] transition-colors group-hover:decoration-current">
        {children.slice(0, split)}
        <span className="whitespace-nowrap">
          {children.slice(split)}
          <ArrowRight
            className="ml-2 inline-block size-4 align-[-0.1875rem] transition-transform duration-300 ease-out-quart group-hover:translate-x-1"
            aria-hidden="true"
            strokeWidth={1.75}
          />
        </span>
      </span>
    </Link>
  );
}
