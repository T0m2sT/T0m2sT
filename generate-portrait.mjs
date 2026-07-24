import { readFileSync, writeFileSync } from "node:fs";

const RAW_PATH = "portrait.raw";
const FRAME_W = 340;
const FRAME_H = 597;

const buf = readFileSync(RAW_PATH);
const cols = buf.readInt32LE(0);
const rows = buf.readInt32LE(4);
let off = 8;

const pixels = new Array(rows);
for (let y = 0; y < rows; y++) {
  const row = new Array(cols);
  for (let x = 0; x < cols; x++) {
    const r = buf[off], g = buf[off + 1], b = buf[off + 2];
    off += 3;
    row[x] = [r, g, b];
  }
  pixels[y] = row;
}

function blur3x3(grid) {
  return grid.map((row, y) =>
    row.map((_, x) => {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= rows) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= cols) continue;
          sum += grid[yy][xx];
          n++;
        }
      }
      return sum / n;
    })
  );
}

// light smoothing on luminance - the flat overcast sky is mostly JPEG noise
// at the pixel level, and any contrast stretch turns that into speckling
const lum = blur3x3(pixels.map((row) => row.map(([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b)));
const sat = pixels.map((row) =>
  row.map(([r, g, b]) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx === 0 ? 0 : (mx - mn) / mx;
  })
);

// ONE continuous brightness curve drives color for every pixel, sky included -
// a single monotonic mapping can never produce a seam, unlike splitting the
// image into two independently-equalized regions (which is what caused both
// the earlier "spots" - noise amplified by a region-local histogram stretch -
// and the visible seam at the sky/subject boundary).
const sorted = lum.flat().slice().sort((a, b) => a - b);
const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const lo = pct(0.02);
const hi = pct(0.88);
const range = Math.max(1, hi - lo);
const gamma = 0.85;
const norm = lum.map((row) =>
  row.map((v) => Math.pow(Math.min(1, Math.max(0, (v - lo) / range)), gamma))
);

// "skyness" only controls how airy/dense the glyphs look, never color - so it
// can be soft and approximate without risking any brightness discontinuity
const rawSky = lum.map((row, y) => row.map((v, x) => v > 150 && sat[y][x] < 0.14));
let skyness = rawSky.map((row) => row.map((v) => (v ? 1 : 0)));
skyness = blur3x3(skyness);

const RAMP = [
  " ", " ", ".", "`", ":", ";", "+", "<", "i", "l",
  "x", "f", "t", "j", "v", "7", "L", "J", "u", "n",
  "c", "C", "o", "X", "U", "O", "w", "m", "%", "&",
  "B", "#", "8", "@", "W", "W",
];
// blue ramp with a lifted floor - the darkest tones are a clear dark-blue
// rather than near-black, so the portrait's shadow areas stay visibly blue
// instead of merging into the dark card
const PALETTE = [
  "#1e4368", "#26527c", "#2f6290", "#3a72a4", "#4884ba",
  "#5a97cd", "#74aede", "#93c4e8", "#b6d8f1", "#daedf9", "#f2f8fe",
];

function escXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const fontSize = +(FRAME_W / (cols * 0.6)).toFixed(3);
const dy = +(FRAME_H / rows).toFixed(3);

const lines = [];
for (let y = 0; y < rows; y++) {
  const cells = [];
  for (let x = 0; x < cols; x++) {
    const n = norm[y][x];
    // background pixels fade fully into the canvas instead of rendering a glyph
    if (n < 0.035) {
      cells.push({ color: PALETTE[0], ch: " " });
      continue;
    }
    // sky-ish pixels stay restricted to the airier, low-ink end of the ramp so
    // they read as soft texture rather than competing with the portrait
    const s = skyness[y][x];
    const rampCap = Math.round(RAMP.length - 1 - s * (RAMP.length - 1) * 0.3);
    const ci = Math.min(rampCap, Math.round(n * (RAMP.length - 1)));
    const pi = Math.min(PALETTE.length - 1, Math.round(n * (PALETTE.length - 1)));
    cells.push({ color: PALETTE[pi], ch: RAMP[ci] });
  }

  // run-length encode consecutive same-color cells into one tspan
  const runs = [];
  for (const cell of cells) {
    const last = runs[runs.length - 1];
    if (last && last.color === cell.color) last.text += cell.ch;
    else runs.push({ color: cell.color, text: cell.ch });
  }

  const tspans = runs
    .map((r) => `<tspan fill="${r.color}">${escXml(r.text)}</tspan>`)
    .join("");
  // force every row to span exactly FRAME_W regardless of which fallback
  // monospace font a given viewer's browser actually renders with - relying
  // on an assumed em-width ratio left a gap at the row's right edge (visible
  // as a vertical black line against bright rows) whenever the real font's
  // advance width didn't match the assumption
  lines.push(`<text x="0" y="${(y * dy).toFixed(1)}" textLength="${FRAME_W}" lengthAdjust="spacingAndGlyphs" xml:space="preserve">${tspans}</text>`);
}

const g = [
  `<g font-family="'MonaspaceNeonLocal', ui-monospace, 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Consolas, 'Liberation Mono', monospace" font-size="${fontSize}px" letter-spacing="0">`,
  ...lines,
  `</g>`,
].join("\n");

writeFileSync("portrait-block.svg.txt", g, "utf8");
console.log(`cols=${cols} rows=${rows} fontSize=${fontSize} dy=${dy} cells=${cols * rows} bytes=${g.length}`);