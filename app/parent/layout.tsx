import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Work schedule", template: "%s | EOD Lawns" },
  // Hidden page for family: no login, not linked anywhere, not in the sitemap, not indexed.
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function ParentLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-dvh bg-paper text-ink-body">
      <main className="mx-auto w-full max-w-md px-4 py-6">{children}</main>
    </div>
  );
}
