import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts}",
  ],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: "1.25rem", sm: "1.5rem", lg: "2rem" },
      screens: { "2xl": "1280px" },
    },
    extend: {
      colors: {
        // Brand tokens (from the flyer + logo)
        "brand-green": "#65C435", // sampled from the logo ring; CTAs — use on ink (8.9:1) or as a fill with ink text
        "brand-green-dark": "#327213", // same hue, darker: hover states, green text on light (5.9:1 on white, 4.8:1 on gray-light)
        ink: "#0B0B0B", // headlines, buttons, pills
        "ink-body": "#353837", // body copy — dark gray, not pure black
        "ink-muted": "#565A59", // secondary copy (≥5.6:1 on paper and gray-light)
        "gray-panel": "#8E9190", // dark diagonal panels
        "gray-mid": "#BFC1C0", // mid diagonal panels
        "gray-light": "#E8E8E8", // section backgrounds
        paper: "#F7F7F6", // page background

        // Marketing-site palette, from the 2026 badge (assets/logo-source-2026.webp): one deep green on
        // near-white, with the badge's three small season glyphs as the only other colors.
        forest: "#0E2C1C", // wordmark + ring: headlines, buttons, rules (14.4:1 on cream)
        pine: "#1E4421", // the tree line: hovers, secondary fills (10.5:1 on cream)
        "forest-body": "#36443C", // body copy (9.8:1 on cream, 8.8:1 on sage)
        "forest-muted": "#5B6860", // secondary copy (5.6:1 on cream, 5.0:1 on sage)
        cream: "#FAFAF6", // page background: the badge's paper
        sage: "#EBEFE8", // quiet tinted sections
        maple: "#BE4C23", // fall glyph, exact; icons and large type only (4.7:1 on cream, 4.25:1 on sage)
        "maple-ink": "#A9431D", // maple for small text (5.7:1 on cream, 5.1:1 on sage)
        frost: "#4C778B", // winter glyph, exact; icons and large type only
        "frost-ink": "#3F687A", // frost for small text (5.8:1 on cream, 5.2:1 on sage)
        // Season accents on a forest background (all ≥5.7:1 on forest).
        "maple-light": "#E08A62",
        "frost-light": "#8FB6C8",
        "grass-light": "#9CC58F",

        // shadcn/ui semantic tokens, mapped onto the brand palette in globals.css
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
      },
      fontFamily: {
        display: ["var(--font-display)", "Impact", "Arial Narrow", "sans-serif"],
        // The badge's heavy geometric wordmark (EMMETT'S) and its letterspaced PROPERTY SERVICES line.
        heading: ["var(--font-heading)", "Montserrat", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      fontSize: {
        hero: ["clamp(2.75rem, 7vw, 5.5rem)", { lineHeight: "0.85", letterSpacing: "-0.01em" }],
        section: ["clamp(2.25rem, 5vw, 4rem)", { lineHeight: "0.85", letterSpacing: "-0.01em" }],
        lead: ["1.1875rem", { lineHeight: "1.6" }],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      zIndex: {
        // Semantic stacking scale: content < sticky chrome < drawer < toast
        raised: "10",
        sticky: "30",
        overlay: "40",
        drawer: "50",
        toast: "60",
      },
      transitionTimingFunction: {
        "out-quart": "cubic-bezier(0.25, 1, 0.5, 1)",
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
