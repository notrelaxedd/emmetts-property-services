import { DoorForm } from "@/components/door/door-form";

/** /door: the door-to-door reps' booking form. Hidden from the nav, footer, sitemap and search. */

// Rendered per request so "tomorrow" and the date picker's earliest day are today's, not the build's.
export const dynamic = "force-dynamic";

export default function DoorPage() {
  return <DoorForm />;
}
