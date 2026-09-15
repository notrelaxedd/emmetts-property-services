import type { Metadata, Viewport } from "next";
import { Anton, Work_Sans } from "next/font/google";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { LocalBusinessJsonLd } from "@/components/site/json-ld";
import { MobileCallBar } from "@/components/site/mobile-call-bar";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";
import "./globals.css";

const display = Anton({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const body = Work_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: content.seo.title,
    template: `%s | ${siteConfig.name}`,
  },
  description: content.seo.description,
  applicationName: siteConfig.name,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: siteConfig.name,
    title: content.seo.title,
    description: content.seo.description,
  },
  twitter: {
    card: "summary_large_image",
    title: content.seo.title,
    description: content.seo.description,
  },
  // Our phone numbers are explicit tel: links; stop iOS from guessing at other digits.
  formatDetection: { telephone: false },
  other: {
    "geo.region": "US-OH",
    "geo.placename": "Rocky River",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F7F7F6",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={cn(display.variable, body.variable)}>
      <body>
        <a
          href="#main"
          className="sr-only z-toast rounded-full bg-ink px-5 py-3 font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" tabIndex={-1} className="outline-none">
          {children}
        </main>
        <SiteFooter />
        <MobileCallBar />
        <LocalBusinessJsonLd />
      </body>
    </html>
  );
}
