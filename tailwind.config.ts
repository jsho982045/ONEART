import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        wall: "var(--wall)",
        gesso: "var(--gesso)",
        ink: "var(--ink)",
        graphite: "var(--graphite)",
        rule: "var(--rule)",
        alert: "var(--alert)",
      },
      fontFamily: {
        sans: [
          '"Bricolage Grotesque Variable"',
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
