import { Check, Plus } from "lucide-react";
import { Reveal } from "./reveal";
import { IconBadge } from "./icons";

/**
 * The flyer's benefits list: black pills, label right-aligned, green badge on the right end.
 * Widths step down so the pills' left ends trace a diagonal, echoing the panels.
 */
export function PillList({ items }: { items: readonly string[] }) {
  const last = items.length - 1;
  return (
    <ul className="flex flex-col items-end gap-3 md:gap-4">
      {items.map((label, i) => (
        <Reveal
          as="li"
          key={label}
          from="left"
          delay={i * 90}
          style={{ maxWidth: `${100 - i * 7}%` }}
          className="flex h-14 w-full items-center justify-end gap-4 rounded-full bg-ink pl-8 pr-2 md:h-16 md:pr-2.5"
        >
          <span className="font-display text-xl uppercase leading-none tracking-[0.02em] text-white md:text-2xl">
            {label}
          </span>
          <IconBadge icon={i === last ? Plus : Check} size="md" className="md:size-12" />
        </Reveal>
      ))}
    </ul>
  );
}
