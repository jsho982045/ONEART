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
        sans: ['"EB Garamond Variable"', '"EB Garamond"', "Garamond", "Georgia", "serif"],
        display: ['"IM Fell English"', '"EB Garamond Variable"', "Georgia", "serif"],
        caps: ['"IM Fell English SC"', '"IM Fell English"', "Georgia", "serif"],
        hand: ['"La Belle Aurore"', "cursive"],
      },
    },
  },
  plugins: [],
};

export default config;
