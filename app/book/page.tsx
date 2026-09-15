import type { Metadata } from "next";
import { BookingSection } from "@/components/sections/booking";
import { content } from "@/lib/content";

export const metadata: Metadata = {
  title: "Book a Service",
  description:
    "Book lawn mowing, fall cleanup, leaf removal, gutter cleaning, or snow removal in Rocky River, OH. We'll call you back to confirm the day and price.",
  alternates: { canonical: "/book" },
  openGraph: { url: "/book" },
};

export default function BookPage() {
  return <BookingSection headingLevel="h1" headline={content.bookPage.headline} body={content.bookPage.body} />;
}
