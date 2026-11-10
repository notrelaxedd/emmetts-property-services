import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Book a job", template: "%s | EOD Lawns" },
  // Hidden page for the door-to-door reps: not linked anywhere, not in the sitemap, not indexed.
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/** Minimal chrome: opened on a rep's phone at the door. */
export default function DoorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-dvh bg-paper text-ink-body">
      <main className="mx-auto w-full max-w-md px-4 py-6">{children}</main>
    </div>
  );
}
