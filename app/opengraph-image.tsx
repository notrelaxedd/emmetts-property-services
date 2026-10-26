import { ImageResponse } from "next/og";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";

// Edge runtime: Next 14's Node build of @vercel/og fails to prerender on Windows + newer Node.
export const runtime = "edge";
export const alt = `${siteConfig.name}: lawn care, fall cleanup, and snow removal in Northeast Ohio`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const FOREST = "#0E2C1C";
const CREAM = "#FAFAF6";

function toBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(binary);
}

/** Social share card: the badge, the seasonal headline, and the phone, in the badge's forest on cream. */
export default async function OpenGraphImage() {
  // Trimmed-down copies: everything here is inlined into the edge bundle, which has a 1 MB limit.
  // (assets/og/* are ASCII subsets of Montserrat and a small copy of public/logo.png — see README.)
  const [heavy, medium, logo] = await Promise.all([
    fetch(new URL("../assets/og/Montserrat-800-Subset.ttf", import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(new URL("../assets/og/Montserrat-600-Subset.ttf", import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(new URL("../assets/og/logo-og.png", import.meta.url)).then((r) => r.arrayBuffer()),
  ]);
  const logoSrc = `data:image/png;base64,${toBase64(logo)}`;
  const rule = { width: 44, height: 2, background: FOREST };

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", background: CREAM, fontFamily: "Montserrat" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 0 0 84px", width: 660 }}>
          {/* The site's left-aligned eyebrow: letterspaced caps behind one rule. */}
          <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 22, fontWeight: 600, letterSpacing: 7, color: FOREST }}>
            <div style={rule} />
            {content.hero.kicker.place.toUpperCase()}
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 28, fontSize: 92, fontWeight: 800, lineHeight: 1, letterSpacing: -1, color: FOREST }}>
            {content.hero.headline.map((line) => (
              <span key={line}>{line.toUpperCase()}</span>
            ))}
          </div>
          <div style={{ display: "flex", marginTop: 44 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "18px 36px",
                borderRadius: 999,
                background: FOREST,
                color: CREAM,
                fontSize: 26,
                fontWeight: 600,
                letterSpacing: 3,
              }}
            >
              {`CALL ${siteConfig.phone.display}`}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, justifyContent: "center", paddingRight: 40 }}>
          {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
          <img src={logoSrc} width={460} height={402} style={{ objectFit: "contain" }} />
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Montserrat", data: heavy, style: "normal", weight: 800 },
        { name: "Montserrat", data: medium, style: "normal", weight: 600 },
      ],
    },
  );
}
