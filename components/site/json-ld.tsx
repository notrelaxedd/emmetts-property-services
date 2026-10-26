import { services } from "@/lib/services";
import { siteConfig } from "@/lib/site-config";

/** schema.org LocalBusiness block for local search. Optional fields drop out until they're filled in. */
export function LocalBusinessJsonLd() {
  const { serviceArea } = siteConfig;

  const data = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": `${siteConfig.url}/#business`,
    name: siteConfig.name,
    alternateName: siteConfig.altName,
    url: siteConfig.url,
    telephone: siteConfig.phone.e164,
    image: `${siteConfig.url}/logo.png`,
    logo: `${siteConfig.url}/logo.png`,
    description:
      "Lawn mowing, fall cleanup, leaf removal, gutter cleaning, and snow removal by a locally owned crew.",
    address: {
      "@type": "PostalAddress",
      addressLocality: serviceArea.primary,
      addressRegion: serviceArea.region,
      addressCountry: "US",
    },
    areaServed: [
      ...serviceArea.cities.map((city) => ({
        "@type": "City",
        name: `${city}, ${serviceArea.regionName}`,
      })),
      { "@type": "AdministrativeArea", name: "West side suburbs of Cleveland, Ohio" },
    ],
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Property services",
      itemListElement: services.map((service) => ({
        "@type": "Offer",
        itemOffered: { "@type": "Service", name: service.title, description: service.blurb },
      })),
    },
    ...(siteConfig.email ? { email: siteConfig.email } : {}),
    ...(siteConfig.openingHoursSpec.length ? { openingHours: siteConfig.openingHoursSpec } : {}),
    ...(siteConfig.pricing.priceRange ? { priceRange: siteConfig.pricing.priceRange } : {}),
  };

  return (
    <script
      type="application/ld+json"
      // JSON.stringify output is safe here: all values come from our own config, and "<" is escaped.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
