import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Are you free?", template: "%s | Emmett's crew" },
  robots: { index: false, follow: false },
  // Keep the token out of Referer headers sent anywhere else.
  referrer: "no-referrer",
};

/** Minimal chrome: this page is opened from a crew email on a phone, no login needed. */
export default function RespondLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-dvh bg-paper text-ink-body">
      <main className="mx-auto w-full max-w-md px-4 py-8">{children}</main>
    </div>
  );
}
