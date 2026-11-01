import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Book a job" },
  // Reps open this straight from a saved link; it's not for customers or search engines.
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  alternates: { canonical: null },
  openGraph: null,
  twitter: null,
};

/**
 * No header, footer, call bar or JSON-LD: one short form on the badge's cream, used on a phone on a
 * porch. `theme-badge` gives it the marketing pages' forest focus ring.
 */
export default function DoorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="theme-badge min-h-dvh bg-cream text-forest-body">
      <main className="mx-auto w-full max-w-md px-4 pb-10 pt-6 sm:pt-10">{children}</main>
    </div>
  );
}
