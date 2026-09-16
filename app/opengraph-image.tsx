import { ImageResponse } from "next/og";
import { content } from "@/lib/content";
import { siteConfig } from "@/lib/site-config";

// Edge runtime: Next 14's Node build of @vercel/og fails to prerender on Windows + newer Node.
export const runtime = "edge";
export const alt = `${siteConfig.name}: lawn care, fall cleanup, and snow removal in Rocky River, Ohio`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function toBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(binary);
}

/** Social share card: seasonal headline, phone, and the badge from /public/logo.png. */
export default async function OpenGraphImage() {
  // Trimmed-down copies: everything here is inlined into the edge bundle, which has a 1 MB limit.
  // (assets/og/* are generated from assets/fonts/Anton-Regular.ttf and public/logo.png — see README.)
  const [anton, logo] = await Promise.all([
    fetch(new URL("../assets/og/Anton-Subset.ttf", import.meta.url)).then((r) => r.arrayBuffer()),
    fetch(new URL("../assets/og/logo-og.png", import.meta.url)).then((r) => r.arrayBuffer()),
  ]);
  const logoSrc = `data:image/png;base64,${toBase64(logo)}`;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: "#F7F7F6" }}>
        {/* Diagonal panels (satori has no clip-path, so these are skewed blocks). */}
        <div style={{ position: "absolute", top: -40, bottom: -40, left: 640, width: 900, background: "#E8E8E8", transform: "skewX(-14deg)" }} />
        <div style={{ position: "absolute", top: -40, bottom: -40, left: 960, width: 600, background: "#BFC1C0", transform: "skewX(-14deg)" }} />
        <div style={{ position: "absolute", top: 380, bottom: -40, left: 1080, width: 600, background: "#8E9190", transform: "skewX(-24deg)" }} />

        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 72px", width: 720 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 28, color: "#0B0B0B", fontWeight: 600 }}>
            <div style={{ width: 40, height: 5, borderRadius: 4, background: "#65C435" }} />
            {siteConfig.altName} · Rocky River, OH
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 20, fontFamily: "Anton", fontSize: 132, lineHeight: 0.88, color: "#0B0B0B", textTransform: "uppercase" }}>
            {content.hero.headline.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
          <div style={{ display: "flex", marginTop: 36 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "18px 40px",
                borderRadius: 999,
                background: "#0B0B0B",
                color: "#FFFFFF",
                fontFamily: "Anton",
                fontSize: 36,
                letterSpacing: 1,
              }}
            >
              CALL {siteConfig.phone.display}
            </div>
          </div>
        </div>

        <div style={{ position: "absolute", right: 48, top: 105, display: "flex" }}>
          {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
          <img src={logoSrc} width={480} height={419} style={{ objectFit: "contain" }} />
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Anton", data: anton, style: "normal", weight: 400 }] },
  );
}
