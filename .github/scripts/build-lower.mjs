// Builds the lower README section as sliced SVGs in lower/:
//   ticker.svg (looping stats), term-top.svg, entry-<repo>.svg x4, term-stack.svg
// One terminal window drawn once, then cropped by viewBox into slices so every
// project entry can carry its own link. Run after refresh-stats.mjs (reads
// cards/*.svg and profile.svg, which that script keeps fresh):
//   node .github/scripts/build-lower.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { C, SANS, MONO, fontCss, cardGradient } from "./theme.mjs";

const OWNER = "T0m2sT";
const REPOS = { "market-pulse": "Market_Pulse", "trusty-shelf": "Trusty_Shelf", "the-forge": "The_Forge", "bob-the-destructor": "Bob_The_Destructor" };
const TECH_NAMES = ["Python", "C", "C++", "CSS", "HTML", "JavaScript", "PHP", "React"];

const read = (f) => readFileSync(f, "utf8");
const unesc = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- data -------------------------------------------------------------------
async function languages(repo) {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/languages`, {
    headers: process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {},
  });
  if (!r.ok) throw new Error(`languages ${repo}: HTTP ${r.status}`); // fail loudly, keep last good files
  const raw = await r.json();
  const tot = Object.values(raw).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(raw).map(([name, b]) => ({ name, pct: b / tot })).sort((a, b) => b.pct - a.pct);
}
const projects = [];
for (const [slug, repo] of Object.entries(REPOS)) {
  const s = read(`cards/${slug}.svg`);
  const [commits, loc, updated] = unesc(s.match(/class="muted" style="font-size:9.5px">([^<]*)</)[1]).split(" · ");
  projects.push({
    slug, repo, commits, loc, updated: updated.replace("updated ", ""),
    title: unesc(s.match(/class="title">([^<]*)</)[1]),
    desc: [...s.matchAll(/class="desc">([^<]*)</g)].map((m) => unesc(m[1])).join(" "),
    tags: [...s.matchAll(/class="accent" style="font-size:10px;font-weight:500">([^<]*)</g)].map((m) => unesc(m[1])),
    banner: s.match(/<image href="(data:image\/png;base64,[^"]+)"/)[1],
    langs: await languages(repo),
  });
}
const ps = read("profile.svg");
const sb = ps.slice(ps.indexOf("<!-- GH-STATS:BEGIN -->"), ps.indexOf("<!-- GH-STATS:END -->"));
const stat = Object.fromEntries([...sb.matchAll(/class="stat-key"[^>]*>([^<]+)<\/text><text[^>]*>([^<]*)/g)].map((m) => [m[1], m[2].trim()]));
const add = sb.match(/fill="#3ddc84">([^<]*)</)[1].replace("++", "");
const del = sb.match(/fill="#ff5c5c">([^<]*)</)[1].replace("--", "");
const stats = [["Stars", stat["Total Stars"]], ["Pull requests", stat["Pull Requests"]], ["Issues", stat["Issues"]], ["Repos touched", stat["Repos Touched"]], ["Lines", stat["Lines"]]];
const tech = [...ps.matchAll(/scale\(2\.2500\)" fill="(#[0-9A-Fa-f]{6})">\s*<path d="([^"]+)"/g)].map((m, i) => ({ name: TECH_NAMES[i], fill: m[1], d: m[2] }));
if (stats.some(([, v]) => !v) || tech.length !== 8) throw new Error("could not read stats or tech icons from profile.svg");

// ---- drawing helpers --------------------------------------------------------
const wrap = (text, maxW, fs, k) => {
  const out = []; let cur = "";
  for (const w of text.split(/\s+/)) {
    const t = cur ? `${cur} ${w}` : w;
    if (t.length * fs * k > maxW && cur) { out.push(cur); cur = w; } else cur = t;
  }
  return cur ? [...out, cur] : out;
};
const rr = (x, y, w, h, r) => `M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r} V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} H${x + r} A${r} ${r} 0 0 1 ${x} ${y + h - r} V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`;
const icon = (t, x, y, s) => `<g transform="translate(${x},${y}) scale(${s})" fill="${t.fill}"><path d="${t.d}"/></g>`;
const pills = (x, y, tags) => {
  let cx = x, out = "";
  for (const t of tags) {
    const w = Math.round(t.length * 6 + 18);
    out += `<rect x="${cx}" y="${y}" width="${w}" height="22" rx="11" class="pill"/><text x="${cx + w / 2}" y="${y + 15}" text-anchor="middle" class="a" style="font-size:10px;font-weight:500">${esc(t)}</text>`;
    cx += w + 8;
  }
  return out;
};
const langBar = (x, y, w, p) => {
  const cols = [C.accent, "#7fb2ff", "#3d6fb8", "#5f7ea8", "#8fa3c0"];
  let cx = x, out = `<clipPath id="lb"><rect x="${x}" y="${y}" width="${w}" height="5" rx="2.5"/></clipPath><g clip-path="url(#lb)">`;
  p.langs.slice(0, 5).forEach((l, i) => { const lw = Math.max(2, w * l.pct); out += `<rect x="${cx.toFixed(1)}" y="${y}" width="${lw.toFixed(1)}" height="5" fill="${cols[i]}"/>`; cx += lw; });
  return out + "</g>";
};
let uid = 0;
const bannerImg = (p, d, x, y, w, h) => { const id = `c${uid++}`; return `<clipPath id="${id}"><path d="${d}"/></clipPath><g clip-path="url(#${id})"><image href="${p.banner}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/></g>`; };
const IN = (d) => `class="in" style="animation-delay:${d.toFixed(2)}s"`;
const meta = (p) => `${p.commits} · ${p.loc} · updated ${p.updated}`;

const CSS = `
text{font-family:${MONO};fill:${C.ink}}
.t{font-family:${SANS};font-weight:800;fill:${C.ink};letter-spacing:-.02em}
.m{fill:${C.mute}} .a{fill:${C.accent}} .g{fill:#3ddc84} .r{fill:#ff5c5c} .b{font-weight:700}
.cta{font-family:${SANS};font-weight:800;fill:${C.accent}}
.card{fill:url(#cardBg);stroke:${C.line}}
.pill{fill:${C.navy};stroke:${C.accent}55}
.hair{stroke:${C.line};fill:none}
.in{animation:in .9s cubic-bezier(.16,1,.3,1) both}
.tl{animation:tl .5s ease-out both}
.cursor{fill:${C.accent};animation:blink 1.1s steps(1) infinite}
@keyframes in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.sheen{animation:sheen 9s ease-in-out infinite}
.fsheen{animation:fsheen 9s ease-in-out infinite}
@keyframes sheen{0%,62%{transform:translateX(-320px)}100%{transform:translateX(1100px)}}
@keyframes fsheen{0%,62%{transform:translateX(-200px)}100%{transform:translateX(430px)}}
@keyframes tl{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes blink{50%{opacity:0}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}.sheen,.fsheen{display:none}}
`;
mkdirSync("lower", { recursive: true });
// one slice = the full canvas cropped to [y, y+h) by viewBox
const slice = (name, y, h, extraCss, body, label, faces = ["sans800", "mono500", "mono700"]) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${h}" viewBox="0 ${y} 1000 ${h}" role="img" aria-label="${esc(label)}">
<title>${esc(label)}</title>
<defs>
<style>${fontCss(...faces)}${CSS}${extraCss}</style>
${cardGradient("cardBg")}
<linearGradient id="sheenGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="${C.glow}" stop-opacity="0"/><stop offset="50%" stop-color="#cfe3ff" stop-opacity=".10"/><stop offset="100%" stop-color="${C.glow}" stop-opacity="0"/></linearGradient>
<filter id="glow" x="-10%" y="-3%" width="120%" height="106%"><feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="${C.glow}" flood-opacity=".16"/></filter>
</defs>
${body}
</svg>
`;
  writeFileSync(`lower/${name}.svg`, svg);
  console.log(`lower/${name}.svg ${(svg.length / 1024).toFixed(0)}KB`);
};

// ---- layout (absolute canvas coordinates, shared by all slices) ---------------
const FRAME = "#1d2d4c"; // C.line blended on navy: an opaque twin so the border looks identical over the screenshot
const T = 96, X = 90, RH = 220, FX = 122, FW = 400, FH = 191, BAR = 26; // image area 400x165 = 2.43:1, the banners' ratio, so screenshots show whole
const E0 = T + 114, EEND = E0 + projects.length * RH, SY = EEND + 20;
const H = SY + 24 + 2 * 34 + 70;
const termCard = `<path d="${rr(20, T, 960, H - T - 20, 16)}" class="card" filter="url(#glow)"/>`;

// ticker: three copies, slide exactly one copy (mono advance .6em + .04em spacing) so the loop never jumps
const SEP = "      ·      ";
const run = stats.map(([k, v]) => `${k.toUpperCase()}  ${v}${k === "Lines" ? `  (+${add} / -${del})` : ""}`).join(SEP) + SEP;
const richRun = stats.map(([k, v]) => `${esc(`${k.toUpperCase()}  ${v}`)}${k === "Lines" ? `  (<tspan class="g">+${esc(add)}</tspan> / <tspan class="r">-${esc(del)}</tspan>)` : ""}`).join(SEP) + SEP;
const tw = [...run].length * 13 * 0.64;
slice("ticker", 10, 86, `.tick{animation:tick 26s linear infinite}@keyframes tick{from{transform:translateX(0)}to{transform:translateX(-${tw.toFixed(2)}px)}}`,
  `<g ${IN(0.1)}><rect x="20.5" y="20.5" width="959" height="55" rx="16" class="card" filter="url(#glow)"/><clipPath id="tk"><rect x="21" y="21" width="958" height="54" rx="15"/></clipPath><g clip-path="url(#tk)"><g class="tick"><text x="0" y="55" class="b" xml:space="preserve" style="font-size:13px;letter-spacing:.04em;white-space:pre">${richRun + richRun + richRun}</text></g><polygon class="sheen" points="14,21 164,21 150,75 0,75" fill="url(#sheenGrad)"/></g></g>`,
  `GitHub stats: ${stats.map(([k, v]) => `${k} ${v}`).join(", ")}, lines +${add} -${del}`, ["mono700"]);

const dots = [44, 60, 76].map((x) => `<circle cx="${x}" cy="${T + 21}" r="4.5" fill="${C.mute}" opacity=".5"/>`).join("");
slice("term-top", T, E0 - T, "",
  `${termCard}<line x1="20" y1="${T + 42}" x2="980" y2="${T + 42}" class="hair"/>${dots}<text x="100" y="${T + 25}" class="m" style="font-size:12px">t0m2st@feup ~ portfolio</text><text x="44" y="${T + 84}" style="font-size:13.5px"><tspan class="a b">$</tspan> <tspan>ls -l projects/</tspan></text>`,
  "Terminal window: ls -l projects/", ["mono500", "mono700"]);

// entry building blocks: browser frame, timeline segment, node + date, description lines
let fid = 0;
const fr = (p, FX, y, FW, FH) => {
  const id = "f" + fid++;
  let b = `<rect x="${FX + .5}" y="${y + .5}" width="${FW - 1}" height="${FH - 1}" rx="10" fill="${C.navy}" stroke="${FRAME}"/><line x1="${FX}" y1="${y + BAR}" x2="${FX + FW}" y2="${y + BAR}" class="hair"/>`;
  [14, 27, 40].forEach((dx) => (b += `<circle cx="${FX + dx}" cy="${y + 13}" r="3.5" fill="${C.mute}" opacity=".5"/>`));
  b += `<text x="${FX + 58}" y="${y + 17}" class="m" style="font-size:9.5px">github.com/${OWNER}/${p.repo}</text>`;
  b += bannerImg(p, `M${FX} ${y + FH - 10} V${y + BAR} H${FX + FW} V${y + FH - 10} A10 10 0 0 1 ${FX + FW - 10} ${y + FH} H${FX + 10} A10 10 0 0 1 ${FX} ${y + FH - 10} Z`, FX, y + BAR, FW, FH - BAR);
  b += `<rect x="${FX + .5}" y="${y + .5}" width="${FW - 1}" height="${FH - 1}" rx="10" fill="none" stroke="${FRAME}"/>`;
  b += `<clipPath id="${id}"><path d="${rr(FX, y, FW, FH, 10)}"/></clipPath><g clip-path="url(#${id})"><polygon class="fsheen" points="${FX + 40},${y} ${FX + 190},${y} ${FX + 150},${y + FH} ${FX},${y + FH}" fill="url(#sheenGrad)"/></g>`;
  return b;
};
const tl = (i, y, ny, first, last, RH) => `<line x1="${X}" y1="${first ? ny : y}" x2="${X}" y2="${last ? ny : y + RH}" stroke="${C.accent}" stroke-width="2" pathLength="1" stroke-dasharray="1" class="tl" style="animation-delay:${(0.15 + i * 0.1).toFixed(2)}s"/>`;
const nd = (p, ny) => `<text x="${X - 14}" y="${ny + 4}" text-anchor="end" class="m" style="font-size:10px">${esc(p.updated)}</text><circle cx="${X}" cy="${ny}" r="7" fill="${C.navy}" stroke="${C.accent}" stroke-width="2"/><circle cx="${X}" cy="${ny}" r="2.5" fill="${C.accent}"/>`;
const lbl = (p) => `${p.title}: ${p.desc} ${p.tags.join(", ")}. ${meta(p)}.`;
const desc = (b, p, x, y, w, fs, lh) => wrap(p.desc, w, fs, 0.6).forEach((l, j) => (b.s += `<text x="${x}" y="${y + j * lh}" style="font-size:${fs - .5}px;fill:${C.bio}"><tspan class="m">#</tspan> ${esc(l)}</text>`));
projects.forEach((p, i) => {
  const FX = 122, FW = 400, FH = BAR + Math.round(FW / (1436 / 591)), y = E0 + i * RH, ny = y + FH / 2, first = i === 0, last = i === projects.length - 1, tx = FX + FW + 30;
  const b = { s: termCard + `<defs><linearGradient id="sc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.navy}" stop-opacity="0"/><stop offset="1" stop-color="${C.navy}" stop-opacity=".94"/></linearGradient></defs>` + tl(i, y, ny, first, last, RH) + `<g ${IN(0.15 + i * 0.1)}>` + nd(p, ny) + fr(p, FX, y, FW, FH) };
  b.s += `<clipPath id="sk"><path d="${rr(FX, y, FW, FH, 10)}"/></clipPath><g clip-path="url(#sk)"><rect x="${FX}" y="${y + FH - 96}" width="${FW}" height="96" fill="url(#sc)"/></g>`;
  b.s += `<text x="${FX + 16}" y="${y + FH - 44}" class="t" style="font-size:26px">${esc(p.title)}</text>` + pills(FX + 16, y + FH - 34, p.tags).replace(/class="pill"/g, 'class="pill" fill-opacity=".85"');
  desc(b, p, tx, y + 36, 410, 12.5, 19);
  b.s += langBar(tx, y + 120, 260, p);
  b.s += `<text x="${tx}" y="${y + 150}" class="m" style="font-size:10.5px">${esc(meta(p))}</text><text x="${tx}" y="${y + 174}" class="cta" style="font-size:12.5px">View project →</text></g>`;
  slice(`entry-${p.slug}`, y, RH, "", b.s, lbl(p));
});


let sb2 = termCard + `<text x="44" y="${SY}" style="font-size:13.5px"><tspan class="a b">$</tspan> <tspan>cat stack.txt</tspan></text>`;
tech.forEach((t, i) => { const cx = 44 + (i % 4) * 225, cy = SY + 36 + Math.floor(i / 4) * 34; sb2 += `<g ${IN(0.2 + i * 0.05)}>${icon(t, cx, cy - 12, 1)}<text x="${cx + 32}" y="${cy + 5}" style="font-size:13px">${t.name}</text></g>`; });
sb2 += `<text x="44" y="${SY + 36 + 2 * 34 + 14}" style="font-size:13.5px"><tspan class="a b">$</tspan> <tspan class="cursor">▋</tspan></text>`;
slice("term-stack", EEND, H - EEND, "", sb2, `Tech stack: ${TECH_NAMES.join(", ")}`, ["mono500", "mono700"]);
