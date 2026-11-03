// Single source for the README look: palette + embedded fonts.
// Dark and light blue with one radiant orange accent.
// Fonts: Bricolage Grotesque (display) + JetBrains Mono (numbers, labels),
// both SIL Open Font License, subset to Latin, embedded as base64 so the SVGs
// render the same inside <img> on GitHub.
import { readFileSync } from "node:fs";

export const C = {
  ink: "#eaf3ff", // headline, light blue-white
  bio: "#a8c8f0", // light blue body text
  mute: "#6f93c0", // muted blue labels
  navy: "#0a1630", // dark blue
  blue: "#12274d", // lighter blue (card gradient end)
  line: "#9cc3ff22", // hairline borders
  accent: "#ff7a2e", // radiant orange, the only accent
  glow: "#4f8cff", // blue glow behind cards and hero
};

export const SANS = "'Bricolage', ui-sans-serif, -apple-system, 'Segoe UI', system-ui, sans-serif";
export const MONO = "'JBMono', ui-monospace, 'SF Mono', Consolas, monospace";

const FILES = {
  sans800: ["Bricolage", 800, "bricolage-grotesque-800.woff2"],
  sans500: ["Bricolage", 500, "bricolage-grotesque-500.woff2"],
  mono500: ["JBMono", 500, "jetbrains-mono-500.woff2"],
  mono700: ["JBMono", 700, "jetbrains-mono-700.woff2"],
};

// each SVG embeds only the faces it uses: fontCss("sans800", "mono700")
export function fontCss(...keys) {
  return keys
    .map((k) => {
      const [family, weight, file] = FILES[k];
      const b64 = readFileSync(`.github/fonts/${file}`).toString("base64");
      return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
    })
    .join("\n");
}

// shared gradient for every card surface
export const cardGradient = (id = "cardBg") =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${C.navy}"/><stop offset="100%" stop-color="${C.blue}"/></linearGradient>`;
