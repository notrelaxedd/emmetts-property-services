import { House, Leaf, Snowflake, Sprout, Wind, type LucideIcon } from "lucide-react";
import type { ServiceIcon } from "@/lib/services";
import { cn } from "@/lib/utils";

const iconMap: Record<ServiceIcon, LucideIcon> = {
  leaf: Leaf,
  sprout: Sprout,
  wind: Wind,
  house: House,
  snowflake: Snowflake,
};

/** A thin-line icon inside a thin forest ring: the badge's ring at icon scale. */
export function IconBadge({
  icon: Icon,
  size = "md",
  className,
}: {
  icon: LucideIcon;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border-[1.5px] border-forest text-forest",
        size === "sm" && "size-8 [&_svg]:size-4",
        size === "md" && "size-12 [&_svg]:size-5",
        size === "lg" && "size-16 [&_svg]:size-6",
        className,
      )}
    >
      <Icon strokeWidth={1.5} />
    </span>
  );
}

export function ServiceBadge({ icon, size = "md", className }: { icon: ServiceIcon; size?: "sm" | "md" | "lg"; className?: string }) {
  return <IconBadge icon={iconMap[icon]} size={size} className={className} />;
}
