import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site-config";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: siteConfig.url, lastModified: now, changeFrequency: "monthly", priority: 1 },
    { url: `${siteConfig.url}/contact`, lastModified: now, changeFrequency: "yearly", priority: 0.8 },
    { url: `${siteConfig.url}/quote`, lastModified: now, changeFrequency: "yearly", priority: 0.9 },
  ];
}
