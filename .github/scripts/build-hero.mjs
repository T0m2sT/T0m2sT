// Builds the animated hero and the two link pills (hero/*.svg).
// Static content, run by hand: node .github/scripts/build-hero.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { C, SANS, MONO, fontCss, cardGradient } from "./theme.mjs";

const HERO_FONTS = fontCss("sans800", "sans500", "mono500");
const PILL_FONTS = fontCss("mono700");

// ---- hero ---------------------------------------------------------------
// Motion (all on load, ends in the final state; ambient glow is the only loop):
//  1. name rises out of a clip box   2. accent line draws
//  3. bio lines fade up              4. glow drifts slowly
// Under prefers-reduced-motion every animation is off and the final frame shows.
const hero = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="270" viewBox="0 0 1000 270" role="img" aria-label="Pedro Tomás Teixeira. Student of LEIC@FEUP, ACM FEUP Vice President (Internal) and Head of Cybersecurity Department. Some of my work pinned below.">
<title>Pedro Tomás Teixeira</title>
<defs>
<style>
${HERO_FONTS}
.name{font-family:${SANS};font-weight:800;font-size:78px;letter-spacing:-0.035em;fill:${C.ink}}
.name .last{fill:${C.accent}}
.bio{font-family:${SANS};font-weight:500;font-size:18px;fill:${C.bio}}
.sub{font-family:${MONO};font-weight:500;font-size:13px;letter-spacing:.02em;fill:${C.mute}}
.card{fill:url(#bg);stroke:${C.line}}
.rule{stroke:${C.accent};stroke-width:4;stroke-linecap:round;fill:none;stroke-dasharray:120;stroke-dashoffset:0}
.rise{animation:rise 1s cubic-bezier(.16,1,.3,1) .15s both}
.draw{animation:draw .9s cubic-bezier(.16,1,.3,1) .85s both}
.fade1{animation:fade .9s cubic-bezier(.16,1,.3,1) 1.0s both}
.fade2{animation:fade .9s cubic-bezier(.16,1,.3,1) 1.2s both}
.glow{animation:drift 16s ease-in-out infinite alternate}
@keyframes rise{from{transform:translateY(96px)}to{transform:translateY(0)}}
@keyframes draw{from{stroke-dashoffset:120}to{stroke-dashoffset:0}}
@keyframes fade{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes drift{from{transform:translateX(-90px)}to{transform:translateX(120px)}}
@media (prefers-reduced-motion:reduce){.rise,.draw,.fade1,.fade2,.glow{animation:none}}
</style>
<clipPath id="card"><rect x="20" y="20" width="960" height="230" rx="16"/></clipPath>
<clipPath id="nameBox"><rect x="60" y="48" width="880" height="100"/></clipPath>
${cardGradient("bg")}
<radialGradient id="g" cx="50%" cy="50%" r="50%">
<stop offset="0%" stop-color="${C.glow}" stop-opacity=".30"/>
<stop offset="100%" stop-color="${C.glow}" stop-opacity="0"/>
</radialGradient>
</defs>
<rect x="20.5" y="20.5" width="959" height="229" rx="16" class="card"/>
<g clip-path="url(#card)"><ellipse class="glow" cx="760" cy="40" rx="360" ry="150" fill="url(#g)"/></g>
<g clip-path="url(#nameBox)"><g class="rise"><text class="name" x="60" y="124">Pedro Tomás <tspan class="last">Teixeira</tspan></text></g></g>
<path class="rule draw" d="M64 150 H184"/>
<text class="bio fade1" x="60" y="192">Student of LEIC@FEUP, ACM FEUP Vice President (Internal) &amp; Head of Cybersecurity Department.</text>
<text class="sub fade2" x="60" y="222">Some of my work pinned below.</text>
</svg>
`;

// ---- link pills ----------------------------------------------------------
const pill = (label, w) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="48" viewBox="0 0 ${w} 48" role="img" aria-label="${label}">
<title>${label}</title>
<style>
${PILL_FONTS}
.p{fill:${C.navy};stroke:${C.accent}66}
.t{font-family:${MONO};font-weight:700;font-size:13px;letter-spacing:.04em;fill:${C.accent}}
.in{animation:in .8s cubic-bezier(.16,1,.3,1) 1.5s both}
@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@media (prefers-reduced-motion:reduce){.in{animation:none}}
</style>
<g class="in"><rect class="p" x="2.5" y="2.5" width="${w - 5}" height="43" rx="21.5"/>
<text class="t" x="${w / 2}" y="29" text-anchor="middle">${label}</text></g>
</svg>
`;

mkdirSync("hero", { recursive: true });
writeFileSync("hero/hero.svg", hero);
writeFileSync("hero/linkedin.svg", pill("LinkedIn", 128));
writeFileSync("hero/cv.svg", pill("CV", 84));
console.log("wrote hero/hero.svg, hero/linkedin.svg, hero/cv.svg");
