// One-off refactor: replace hard-coded type sizes, weights, radii and grey text colours in the
// app's live CSS with the design tokens from src/tokens.css. Run once; kept for reference.
import fs from "node:fs";

const files = ["theme", "features", "study-cards", "experience", "appearance", "study-session", "page-flow"].map((f) => `src/${f}.css`);

const size = (px) => {
  if (px <= 10) return px === 10 ? "var(--fs-tab)" : "var(--fs-caption)";
  if (px <= 11) return "var(--fs-caption)";
  if (px <= 12) return "var(--fs-small)";
  if (px <= 13) return "var(--fs-meta)";
  if (px <= 14) return "var(--fs-body)";
  if (px <= 15) return "var(--fs-body-l)";
  if (px <= 16) return "var(--fs-word)";
  if (px <= 20) return "var(--fs-title)";
  if (px <= 23) return "var(--fs-page)";
  return "var(--fs-display)";
};
const weight = { 400: "var(--fw-regular)", 500: "var(--fw-medium)", 550: "var(--fw-medium)", 600: "var(--fw-semibold)", 650: "var(--fw-bold)", 680: "var(--fw-bold)" };
const radius = (px) => {
  if (px <= 5) return null; // tiny decorative radii stay as they are
  if (px <= 9) return "var(--radius-xs)";
  if (px <= 14) return "var(--radius-sm)";
  if (px <= 20) return "var(--radius-md)";
  if (px <= 30) return "var(--radius-lg)";
  if (px <= 40) return "var(--radius-bar)";
  return "var(--radius-pill)";
};
function rgb(hex) {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
// Grey text colours collapse onto four text tokens; saturated colours (accents, greens) are kept.
const textColor = (hex) => {
  const [r, g, b] = rgb(hex);
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  if (chroma > 40) return null;
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (l < 70) return "var(--text-primary)";
  if (l < 105) return "var(--text-secondary)";
  if (l < 160) return "var(--text-muted)";
  return null; // light greys sit on dark fills; leave them
};

const stats = { size: 0, weight: 0, radius: 0, color: 0 };
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const out = src
    .split("\n")
    .map((line) => {
      // User-chosen "large" text size keeps its own explicit values.
      if (line.includes('data-size="large"')) return line;
      return line
        .replace(/font-size:\s*(\d+(?:\.\d+)?)px/g, (m, px) => { stats.size++; return "font-size: " + size(+px); })
        .replace(/font-weight:\s*(400|500|550|600|650|680)\b/g, (m, w) => { stats.weight++; return "font-weight: " + weight[w]; })
        .replace(/border-radius:\s*(\d+)px(\s*[;}!\n]|$)/g, (m, px, tail) => { const t = radius(+px); if (!t) return m; stats.radius++; return "border-radius: " + t + tail; })
        .replace(/(^|[;{\s])color:\s*(#[0-9a-fA-F]{3,8})\b/g, (m, pre, hex) => { const t = textColor(hex); if (!t) return m; stats.color++; return pre + "color: " + t; });
    })
    .join("\n");
  fs.writeFileSync(file, out);
}
console.log("replaced", stats);
