import type { Config } from "tailwindcss";

// Palette: Vanilla Cream base (#F0E7D5) + deep navy ink/accent (#1E2A44).
// Light, editorial theme. Single accent (navy), warm neutral base.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: {
          DEFAULT: "#F0E7D5",
          deep: "#E7DBC4", // slightly darker cream for surfaces/lines
          soft: "#F6F0E4", // lighter cream for raised cards
        },
        navy: {
          DEFAULT: "#1E2A44", // ink + accent
          soft: "#2c3a5c",
          line: "#d8ccb4", // hairline on cream
        },
        // Per-agent accents, tuned to sit on cream (desaturated, navy-leaning).
        triage: "#b5552e",
        mgmt: "#1f7d72",
        invest: "#1E2A44",
        doc: "#3f7a44",
        observer: "#9a7d18",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        breathe: {
          "0%, 100%": { opacity: "0.35" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        shimmer: "shimmer 1.6s infinite",
        breathe: "breathe 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
