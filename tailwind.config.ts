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
