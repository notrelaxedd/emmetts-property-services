import type { Metadata } from "next";
import { ContactSection } from "@/components/sections/contact";
import { content } from "@/lib/content";

export const metadata: Metadata = {
  title: "Contact Us",
  description:
    "Call Emmett's Property Services for lawn mowing, fall cleanup, leaf removal, gutter cleaning, and snow removal in Northeast Ohio and the west-side Cleveland suburbs.",
  alternates: { canonical: "/contact" },
  openGraph: { url: "/contact" },
};

export default function ContactPage() {
  return <ContactSection headingLevel="h1" headline={content.contactPage.headline} body={content.contactPage.body} />;
}
