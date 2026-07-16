import { readFile, writeFile } from "node:fs/promises";

const USERNAME = process.env.GH_STATS_USERNAME || "T0m2sT";
const SVG_PATH = process.env.PROFILE_SVG_PATH || "profile.svg";

// GitHub's API works unauthenticated (60 req/hour), but the per-repo
// contributor-stats calls used for the lines-of-code widget can burn through
// that fast on their own - authenticating with the Actions run's own
// GITHUB_TOKEN (no secret to set up, it's automatic in every workflow run)
// raises that to 5,000/hour. Falls back to unauthenticated for local runs.
const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
function ghHeaders() {
  const headers = { "User-Agent": "profile-svg-refresh", Accept: "application/vnd.github+json" };
  if (GH_TOKEN) headers.Authorization = `Bearer ${GH_TOKEN}`;
  return headers;
}

// the range tabs' from=/to= query params were previously hand-typed dates
// that froze the day this file was generated - now computed off today's
// real date every run, so the links stay accurate instead of quietly
// drifting stale.
function buildRangeTabs(username) {
  const today = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  const to = fmt(today);
  const monthsAgo = (n) => {
    const d = new Date(today);
    d.setUTCMonth(d.getUTCMonth() - n);
    return fmt(d);
  };
  const yearsAgo = (n) => {
    const d = new Date(today);
    d.setUTCFullYear(d.getUTCFullYear() - n);
    return fmt(d);
  };

  // active tab matches the activity chart's actual plotted window (30 days)
  const ranges = [
    { label: "1M", from: monthsAgo(1), active: true },
    { label: "3M", from: monthsAgo(3), active: false },
    { label: "6M", from: monthsAgo(6), active: false },
    { label: "1Y", from: yearsAgo(1), active: false },
  ];

  const tabW = 46, gap = 6, tabH = 24;
  const tabs = ranges.map((r, i) => {
    const x = i * (tabW + gap);
    const fill = r.active ? "#4f8cff" : "transparent";
    const textClass = r.active ? "tab-text-active" : "tab-text";
    return `<a class="tab-link" xlink:href="https://github.com/${username}?tab=overview&amp;from=${r.from}&amp;to=${to}">
        <rect class="tab-hit" x="${x}" y="0" width="${tabW}" height="${tabH}" rx="12" fill="${fill}"/>
        <text x="${x + tabW / 2}" y="16" text-anchor="middle" class="${textClass}">${r.label}</text>
      </a>`;
  });

  const allX = ranges.length * (tabW + gap);
  tabs.push(`<a class="tab-link" xlink:href="https://github.com/${username}">
        <rect class="tab-hit" x="${allX}" y="0" width="${tabW}" height="${tabH}" rx="12" fill="transparent"/>
        <text x="${allX + tabW / 2}" y="16" text-anchor="middle" class="tab-text">ALL</text>
      </a>`);

  return tabs.join("\n      ");
}

// the contributor-stats endpoint computes lazily - a cold repo answers 202
// while GitHub builds the weekly add/delete breakdown in the background, so
// we poll a few times before giving up on that one repo.
async function fetchContributorStats(username, repo) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`https://api.github.com/repos/${username}/${repo}/stats/contributors`, {
      headers: ghHeaders(),
    });
    if (res.status === 200) return res.json();
    if (res.status !== 202) return null;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return null;
}

// real "lines of code" - additions/deletions summed from GitHub's own
// per-repo contributor stats (not a clone + git log, so it works without a
// token and stays cheap enough to run daily), across every owned, non-fork
// repo, filtered down to commits actually authored by this user.
async function buildLinesOfCode(username) {
  const reposRes = await fetch(`https://api.github.com/users/${username}/repos?per_page=100&type=owner`, {
    headers: ghHeaders(),
  });
  if (!reposRes.ok) return null;
  const repos = (await reposRes.json()).filter((r) => !r.fork);

  const results = await Promise.all(repos.map((r) => fetchContributorStats(username, r.name)));

  let additions = 0, deletions = 0, any = false;
  for (const stats of results) {
    if (!Array.isArray(stats)) continue;
    const mine = stats.find((c) => c.author && c.author.login?.toLowerCase() === username.toLowerCase());
    if (!mine) continue;
    any = true;
    for (const w of mine.weeks) {
      additions += w.a;
      deletions += w.d;
    }
  }
  if (!any) return null;

  const net = additions - deletions;
  // ++ / -- colored like a diff (green additions, red deletions) instead of
  // plain text, so the row reads at a glance same as the candlestick chart
  const net_ = net.toLocaleString("en-US");
  const add_ = additions.toLocaleString("en-US");
  const del_ = deletions.toLocaleString("en-US");
  return `${net_} (<tspan fill="#3ddc84">${add_}++</tspan>, <tspan fill="#ff5c5c">${del_}--</tspan>)`;
}

// GH-STATS is now a custom "ledger" widget instead of the embedded default
// card - real numbers, parsed out of github-readme-stats' own SVG (so it
// stays accurate/auto-updating) rather than displaying that card's default
// icon-row look directly.
async function buildStatsLedger(username, width) {
  const raw = await fetchFirstOk([
    `https://github-readme-stats.vercel.app/api?username=${username}&show_icons=true`,
    `https://github-readme-stats-eight-theta.vercel.app/api?username=${username}&show_icons=true`,
  ]);
  if (!raw) return null;

  const grab = (testid) => {
    const m = raw.match(new RegExp(`data-testid="${testid}"[^>]*>\\s*([^<]+?)\\s*<`));
    return m ? m[1].trim() : "—";
  };
  const rankMatch = raw.match(/class="rank-text">[\s\S]*?<text[^>]*>\s*([^<]+?)\s*<\/text>/);
  const rank = rankMatch ? rankMatch[1].trim() : "—";
  const loc = await buildLinesOfCode(username);

  const rows = [
    ["Total stars", grab("stars")],
    ["Commits (2026)", grab("commits")],
    ["Pull requests", grab("prs")],
    ["Issues", grab("issues")],
    ["Contributed to", grab("contribs")],
    ["Rank", rank],
    ["Lines of code", loc || "—"],
  ];

  const rowH = 25;
  const lines = rows
    .map(([k, v], i) => {
      const y = i * rowH;
      const bg = i % 2 === 0 ? `<rect x="-6" y="${y - 4}" width="${width + 12}" height="${rowH}" rx="6" fill="#ffffff08"/>` : "";
      return `${bg}<text x="0" y="${y + 16}" style="font-size:14.5px;fill:#8b93a3">${k}</text><text x="${width}" y="${y + 16}" text-anchor="end" style="font-size:15px;font-weight:700">${v}</text>`;
    })
    .join("\n");

  return lines;
}

// GH-STREAK is now a custom "quote" widget - real total/streak numbers
// parsed from streak-stats' own SVG, paired with a real candlestick chart
// (see buildCandlestickChart) instead of streak-stats' default look.
async function buildContributionsQuote(username) {
  const raw = await fetchFirstOk([`https://streak-stats.demolab.com/?user=${username}`]);
  if (!raw) return null;

  const grabAfter = (comment) => {
    const idx = raw.indexOf(comment);
    if (idx === -1) return "—";
    const m = raw.slice(idx).match(/<text[^>]*>\s*([\s\S]*?)\s*<\/text>/);
    return m ? m[1].trim() : "—";
  };
  const longest = grabAfter("<!-- Longest Streak big number -->");

  // streak-stats' own "Total Contributions" is cached at their CDN for 24h
  // (cache-control: max-age=86400), which visibly lagged GitHub's live count
  // by several contributions - summing our own already-fetched calendar
  // series gives the true live total instead.
  const series = await fetchContributionSeries(username);
  const total = series ? series.reduce((sum, d) => sum + d.count, 0).toLocaleString("en-US") : grabAfter("<!-- Total Contributions big number -->");

  return { total, longest };
}

// commits-as-candlesticks: the daily contribution series bucketed into
// weeks and drawn as real OHLC bars (open/close = first/last day of the
// week, wick = the week's high/low) - the most literally "stock chart"
// reading of the same real data GH-ACTIVITY plots as a running total.
async function buildCandlestickChart(username, chartWidth, chartHeight, weeks = 24) {
  const series = await fetchContributionSeries(username);
  if (!series) return null;

  const recent = series.slice(-weeks * 7);
  const buckets = [];
  for (let i = 0; i < recent.length; i += 7) {
    const chunk = recent.slice(i, i + 7).map((d) => d.count);
    if (!chunk.length) continue;
    buckets.push({ open: chunk[0], close: chunk[chunk.length - 1], high: Math.max(...chunk), low: Math.min(...chunk) });
  }
  if (!buckets.length) return null;

  const maxVal = Math.max(1, ...buckets.map((b) => b.high));
  const gap = 6;
  const cw = chartWidth / buckets.length - gap;
  const bars = buckets
    .map((b, i) => {
      const x = i * (cw + gap);
      const up = b.close >= b.open;
      const color = up ? "#3ddc84" : "#ff5c5c";
      const yHigh = chartHeight - (b.high / maxVal) * chartHeight;
      const yLow = chartHeight - (b.low / maxVal) * chartHeight;
      const bodyTopVal = Math.max(b.open, b.close);
      const bodyBotVal = Math.min(b.open, b.close);
      let bodyTop = chartHeight - (bodyTopVal / maxVal) * chartHeight;
      let bodyH = ((bodyTopVal - bodyBotVal) / maxVal) * chartHeight;
      if (bodyH < 1.5) {
        bodyTop -= (1.5 - bodyH) / 2;
        bodyH = 1.5;
      }
      return `<line x1="${(x + cw / 2).toFixed(1)}" y1="${yHigh.toFixed(1)}" x2="${(x + cw / 2).toFixed(1)}" y2="${yLow.toFixed(1)}" stroke="${color}" stroke-width="1.5"/><rect x="${x.toFixed(1)}" y="${bodyTop.toFixed(1)}" width="${cw.toFixed(1)}" height="${bodyH.toFixed(1)}" rx="1" fill="${color}"/>`;
    })
    .join("\n");

  return bars;
}

// GH-PROJECTS: the "Highlighted projects" spotlight - real repo data (name,
// description, language, stars, last push) fetched live from the GitHub API,
// not hand-typed, so it stays accurate as the repos change.
function wrapText(text, maxChars, maxLines) {
  const words = (text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    } else {
      cur = next;
    }
  }
  const consumedAll = lines.length < maxLines;
  if (consumedAll && cur) lines.push(cur);
  const truncated = !consumedAll;
  if (truncated && lines.length === maxLines) {
    let last = lines[maxLines - 1];
    if (last.length > maxChars - 1) last = last.slice(0, maxChars - 1).trimEnd();
    lines[maxLines - 1] = last + "…";
  }
  return lines;
}

// prefer ending on a full sentence over an arbitrary word/char cutoff
function firstSentences(text, minChars) {
  const parts = (text || "").match(/[^.!?]+[.!?]+/g) || [text || ""];
  let out = "";
  for (const p of parts) {
    out += p;
    if (out.trim().length >= minChars) break;
  }
  return out.trim();
}

function escXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function relativeTime(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

async function fetchRepo(username, repo) {
  const res = await fetch(`https://api.github.com/repos/${username}/${repo}`, {
    headers: ghHeaders(),
  });
  if (!res.ok) {
    console.warn(`[skip] repo ${repo}: ${res.status}`);
    return null;
  }
  return res.json();
}

async function fetchTopLanguages(username, repo, limit = 3) {
  const res = await fetch(`https://api.github.com/repos/${username}/${repo}/languages`, {
    headers: ghHeaders(),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Object.entries(data)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name);
}

async function buildHighlightedProjects(username, spec) {
  const raw = await Promise.all(spec.map((s) => fetchRepo(username, s.repo)));
  if (raw.some((d) => !d)) return null;
  const langLists = await Promise.all(spec.map((s) => fetchTopLanguages(username, s.repo)));

  const projects = raw.map((d, i) => ({
    name: spec[i].display,
    desc: spec[i].desc || d.description || "",
    curated: Boolean(spec[i].desc),
    languages: langLists[i].length ? langLists[i] : [d.language || "—"],
    stars: d.stargazers_count,
    updated: relativeTime(d.pushed_at),
  }));
  const [hero, ...side] = projects;

  // hero and the side column now split the width evenly, and the side
  // column's two cards are the same width as the hero card - no more
  // "hero is a different shape than the others" mismatch
  const GAP = 20;
  const HERO_W = (960 - GAP) / 2, HERO_H = 340, PAD = 24;
  const heroLines = wrapText(hero.desc, 40, 8);
  const heroDescBlockH = (heroLines.length - 1) * 27;
  // center within the band actually free for the description - between the
  // title and the meta line - not the full card height, so a short
  // description doesn't drift toward the card's geometric middle and leave
  // lopsided gaps above/below
  const heroContentTop = PAD + 26 + 27;
  const heroContentBottom = HERO_H - PAD - 4 - 28;
  const heroDescStartY = (heroContentTop + heroContentBottom) / 2 - heroDescBlockH / 2;
  const heroDescSvg = heroLines
    .map((l, i) => `<text x="${PAD}" y="${(heroDescStartY + i * 27).toFixed(1)}" style="font-size:18px;fill:#c9d1d9">${escXml(l)}</text>`)
    .join("\n");
  const heroMeta = `${hero.languages.join(" · ")}${hero.stars ? ` · ★ ${hero.stars}` : ""} · updated ${hero.updated}`;

  // underline accent beneath each project title (hero + both side cards) is
  // the shared "highlighted" mark - forced to the title's exact text width
  // via textLength/lengthAdjust (same trick generate-portrait.mjs uses for
  // its glyph rows) instead of estimating pixel width from a char-count *
  // ratio guess, which drifted long or short depending on which fallback
  // monospace font the viewer's browser actually picked. Painted before the
  // title text (not after) so the text sits on top of the line, not the
  // other way around, wherever a descender dips into it.
  const HERO_TITLE_SIZE = 28;
  const heroTitleW = Math.round(hero.name.length * HERO_TITLE_SIZE * 0.6);
  const heroSvg = `<rect width="${HERO_W}" height="${HERO_H}" rx="16" fill="#10151d" stroke="#ffffff14" stroke-width="1" filter="url(#cardShadow)"/><rect width="${HERO_W}" height="${HERO_H}" rx="16" fill="url(#cardSheen)"/>
<rect x="${PAD}" y="${PAD + 30}" width="${heroTitleW}" height="3" rx="1.5" fill="#4f8cff"/>
<text x="${PAD}" y="${PAD + 26}" textLength="${heroTitleW}" lengthAdjust="spacingAndGlyphs" style="font-size:${HERO_TITLE_SIZE}px;font-weight:800;letter-spacing:-0.01em;fill:#e7ebf3">${escXml(hero.name)}</text>
${heroDescSvg}
<text x="${PAD}" y="${HERO_H - PAD - 4}" style="font-size:14px;fill:#4f8cff;font-weight:700">${escXml(heroMeta)}</text>`;

  const SIDE_W = HERO_W, SIDE_H = (HERO_H - GAP) / 2, SIDE_PAD = 20, SIDE_TITLE_SIZE = 22;
  const sideSvg = side
    .map((p, i) => {
      // curated descriptions are already hand-fit to the card; only repos
      // without one fall back to sentence-extraction off the live API text
      const summary = p.curated ? p.desc : firstSentences(p.desc, 150);
      const lines = wrapText(summary, 50, 4);
      const descBlockH = (lines.length - 1) * 21;
      const descStartY = SIDE_H / 2 + 10 - descBlockH / 2;
      const linesSvg = lines
        .map((l, j) => `<text x="${SIDE_PAD}" y="${(descStartY + j * 21).toFixed(1)}" style="font-size:14.5px;fill:#c9d1d9">${escXml(l)}</text>`)
        .join("\n");
      const y = i * (SIDE_H + GAP);
      const meta = `${p.languages.join(" · ")}${p.stars ? ` · ★ ${p.stars}` : ""}`;
      const titleW = Math.round(p.name.length * SIDE_TITLE_SIZE * 0.6);
      return `<g transform="translate(0, ${y})">
  <rect width="${SIDE_W}" height="${SIDE_H}" rx="16" fill="#10151d" stroke="#ffffff14" stroke-width="1" filter="url(#cardShadow)"/><rect width="${SIDE_W}" height="${SIDE_H}" rx="16" fill="url(#cardSheen)"/>
  <rect x="${SIDE_PAD}" y="${SIDE_PAD + 17}" width="${titleW}" height="3" rx="1.5" fill="#4f8cff"/>
  <text x="${SIDE_PAD}" y="${SIDE_PAD + 14}" textLength="${titleW}" lengthAdjust="spacingAndGlyphs" style="font-size:${SIDE_TITLE_SIZE}px;font-weight:700;fill:#e7ebf3">${escXml(p.name)}</text>
  ${linesSvg}
  <text x="${SIDE_PAD}" y="${SIDE_H - SIDE_PAD + 2}" style="font-size:12px;fill:#4f8cff;font-weight:700">${escXml(meta)}</text>
</g>`;
    })
    .join("\n");

  return `${heroSvg}\n<g transform="translate(${HERO_W + GAP}, 0)">\n${sideSvg}\n</g>`;
}

// shared by GH-ACTIVITY and the monthly stat - one fetch of GitHub's own
// public contribution calendar, parsed into a chronological {date,count}[]
let contributionSeriesCache = null;
async function fetchContributionSeries(username) {
  if (contributionSeriesCache) return contributionSeriesCache;
  const res = await fetch(`https://github.com/users/${username}/contributions`, {
    headers: { "User-Agent": "profile-svg-refresh" },
  });
  if (!res.ok) {
    console.warn(`[skip] contribution calendar: ${res.status}`);
    return null;
  }
  const html = await res.text();

  const dayIds = [...html.matchAll(/data-date="(\d{4}-\d{2}-\d{2})"[^>]*id="(contribution-day-component-\d+-\d+)"/g)];
  const tooltips = new Map();
  for (const m of html.matchAll(/for="(contribution-day-component-\d+-\d+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    tooltips.set(m[1], m[2].trim());
  }
  if (dayIds.length === 0) {
    console.warn("[skip] contribution calendar: no cells found");
    return null;
  }

  const series = dayIds
    .map(([, date, id]) => {
      const text = tooltips.get(id) || "";
      const m = text.match(/^(\d+|No) contributions?/);
      const count = !m ? 0 : m[1] === "No" ? 0 : Number(m[1]);
      return { date, count };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  contributionSeriesCache = series;
  return series;
}

// GH-ACTIVITY isn't a third-party card - it's built from GitHub's own public
// contribution calendar so it can be plotted as a cumulative running total
// (always trending up, "stock chart" shaped) instead of noisy daily counts,
// while still being 100% real data, refreshed on every run.
async function buildActivityChart(username, width, height, days = 90) {
  const full = await fetchContributionSeries(username);
  if (!full) return null;
  const series = full.slice(-days);

  let sum = 0;
  const cumulative = series.map((d) => (sum += d.count));
  const max = Math.max(1, ...cumulative);
  const n = cumulative.length;

  const padTop = 10;
  const padBottom = 4;
  const plotH = height - padTop - padBottom;
  const points = cumulative.map((v, i) => {
    const x = (i / (n - 1)) * width;
    const y = padTop + plotH - (v / max) * plotH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = points[points.length - 1].split(",").map(Number);

  return `<svg x="0" y="0" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#4f8cff" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#4f8cff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <polygon points="${points.join(" ")} ${width},${height} 0,${height}" fill="url(#activityFill)"/>
  <polyline points="${points.join(" ")}" fill="none" stroke="#4f8cff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${last[0]}" cy="${last[1]}" r="4" fill="#4f8cff"/>
  <circle cx="${last[0]}" cy="${last[1]}" r="8" fill="#4f8cff" opacity="0.25"/>
</svg>`;
}

// month-to-date contributions, and that month's share of the trailing-year
// total - both computed fresh from the live calendar on every run
async function buildMonthlyStat(username) {
  const series = await fetchContributionSeries(username);
  if (!series || series.length === 0) return null;

  const today = series[series.length - 1].date;
  const thisPrefix = today.slice(0, 7);
  const thisMonthSum = series.filter((d) => d.date.startsWith(thisPrefix)).reduce((a, b) => a + b.count, 0);
  const total = series.reduce((a, b) => a + b.count, 0);

  const pct = total === 0 ? 0 : Math.round((thisMonthSum / total) * 1000) / 10;
  const monthName = new Date(`${today}T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return { count: thisMonthSum, pct, monthName };
}

async function fetchFirstOk(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "profile-svg-refresh" } });
      if (!res.ok) {
        console.warn(`[skip] ${res.status} ${url}`);
        continue;
      }
      const text = await res.text();
      if (!text.includes("<svg")) {
        console.warn(`[skip] non-svg response from ${url}`);
        continue;
      }
      return text;
    } catch (err) {
      console.warn(`[skip] ${url} -> ${err.message}`);
    }
  }
  return null;
}

async function main() {
  let svg = await readFile(SVG_PATH, "utf8");
  let changed = false;

  {
    const beginTag = `<!-- GH-TABS:BEGIN -->`;
    const endTag = `<!-- GH-TABS:END -->`;
    const beginIdx = svg.indexOf(beginTag);
    const endIdx = svg.indexOf(endTag);
    if (beginIdx === -1 || endIdx === -1) {
      console.warn("[skip] markers for GH-TABS not found in " + SVG_PATH);
    } else {
      const tabs = buildRangeTabs(USERNAME);
      const replacement = `${beginTag}\n      ${tabs}\n      ${endTag}`;
      svg = svg.slice(0, beginIdx) + replacement + svg.slice(endIdx + endTag.length);
      changed = true;
      console.log("[ok] GH-TABS refreshed (dates recomputed from today)");
    }
  }

  {
    const beginTag = `<!-- GH-ACTIVITY:BEGIN -->`;
    const endTag = `<!-- GH-ACTIVITY:END -->`;
    const beginIdx = svg.indexOf(beginTag);
    const endIdx = svg.indexOf(endTag);
    if (beginIdx === -1 || endIdx === -1) {
      console.warn("[skip] markers for GH-ACTIVITY not found in " + SVG_PATH);
    } else {
      const chart = await buildActivityChart(USERNAME, 560, 202, 30);
      if (!chart) {
        console.warn("[skip] GH-ACTIVITY: build failed, keeping existing content");
      } else {
        const replacement = `${beginTag}\n${chart}\n${endTag}`;
        svg = svg.slice(0, beginIdx) + replacement + svg.slice(endIdx + endTag.length);
        changed = true;
        console.log("[ok] GH-ACTIVITY refreshed (cumulative, real data)");
      }
    }
  }

  {
    const beginTag = `<!-- GH-MONTHSTAT:BEGIN -->`;
    const endTag = `<!-- GH-MONTHSTAT:END -->`;
    const beginIdx = svg.indexOf(beginTag);
    const endIdx = svg.indexOf(endTag);
    if (beginIdx === -1 || endIdx === -1) {
      console.warn("[skip] markers for GH-MONTHSTAT not found in " + SVG_PATH);
    } else {
      const stat = await buildMonthlyStat(USERNAME);
      if (!stat) {
        console.warn("[skip] GH-MONTHSTAT: build failed, keeping existing content");
      } else {
        const replacement = `${beginTag}
<text x="0" y="0" text-anchor="end" style="font-size:11.5px;fill:#6c7689;letter-spacing:.05em">${stat.monthName.toUpperCase()}</text>
<text x="0" y="30" text-anchor="end" style="font-size:30px;font-weight:800;fill:#e7ebf3">${stat.count}</text>
<text x="0" y="51" text-anchor="end" style="font-size:12.5px;font-weight:700;fill:#4f8cff">${stat.pct}% of total ▲</text>
${endTag}`;
        svg = svg.slice(0, beginIdx) + replacement + svg.slice(endIdx + endTag.length);
        changed = true;
        console.log(`[ok] GH-MONTHSTAT refreshed (${stat.count}, ${stat.pct}% of total)`);
      }
    }
  }

  {
    const beginTag = `<!-- GH-STATS:BEGIN -->`;
    const endTag = `<!-- GH-STATS:END -->`;
    const beginIdx = svg.indexOf(beginTag);
    const endIdx = svg.indexOf(endTag);
    if (beginIdx === -1 || endIdx === -1) {
      console.warn("[skip] markers for GH-STATS not found in " + SVG_PATH);
    } else {
      const ledger = await buildStatsLedger(USERNAME, 430);
      if (!ledger) {
        console.warn("[skip] GH-STATS: build failed, keeping existing content");
      } else {
        const replacement = `${beginTag}\n${ledger}\n${endTag}`;
        svg = svg.slice(0, beginIdx) + replacement + svg.slice(endIdx + endTag.length);
        changed = true;
        console.log("[ok] GH-STATS refreshed (ledger, real data)");
      }
    }
  }

  {
    const beginTag = `<!-- GH-STREAK:BEGIN -->`;
    const endTag = `<!-- GH-STREAK:END -->`;
    const beginIdx = svg.indexOf(beginTag);
    const endIdx = svg.indexOf(endTag);
    if (beginIdx === -1 || endIdx === -1) {
      console.warn("[skip] markers for GH-STREAK not found in " + SVG_PATH);
    } else {
      const quote = await buildContributionsQuote(USERNAME);
      const candles = await buildCandlestickChart(USERNAME, 560, 139);
      if (!quote || !candles) {
        console.warn("[skip] GH-STREAK: build failed, keeping existing content");
      } else {
        const replacement = `${beginTag}
<g transform="translate(580, 28)">
<text text-anchor="end" y="0" style="font-size:11.5px;fill:#6c7689;letter-spacing:.05em">ALL-TIME</text>
<text text-anchor="end" y="30" style="font-size:30px;font-weight:800;fill:#e7ebf3;font-family:ui-monospace,monospace">${quote.total}</text>
<text text-anchor="end" y="51" style="font-size:12.5px;font-weight:700;fill:#4f8cff">${quote.longest}d best streak</text>
</g>
<g transform="translate(20, 80)">
${candles}
</g>
${endTag}`;
        svg = svg.slice(0, beginIdx) + replacement + svg.slice(endIdx + endTag.length);
        changed = true;
        console.log(`[ok] GH-STREAK refreshed (candlesticks, ${quote.total} total)`);
      }
    }
  }

  {
    const beginTag = `<!-- GH-PROJECTS:BEGIN -->`;
    const endTag = `<!-- GH-PROJECTS:END -->`;
    const beginIdx = svg.indexOf(beginTag);
    const endIdx = svg.indexOf(endTag);
    if (beginIdx === -1 || endIdx === -1) {
      console.warn("[skip] markers for GH-PROJECTS not found in " + SVG_PATH);
    } else {
      const spotlight = await buildHighlightedProjects(USERNAME, [
        {
          repo: "The_Forge",
          display: "The Forge",
          desc: "A gym management website built around three roles - members book classes, trainers manage schedules, admins run the show.",
        },
        {
          repo: "Bob_The_Destructor",
          display: "Bob the Destructor",
          desc: "Five caves, one miner, endless ore - how deep can you dig?",
        },
        {
          repo: "LCode",
          display: "LCode",
          desc: "Minix had no code editor, so we built one - and used it to test real hardware drivers.",
        },
      ]);
      if (!spotlight) {
        console.warn("[skip] GH-PROJECTS: build failed, keeping existing content");
      } else {
        const replacement = `${beginTag}\n${spotlight}\n${endTag}`;
        svg = svg.slice(0, beginIdx) + replacement + svg.slice(endIdx + endTag.length);
        changed = true;
        console.log("[ok] GH-PROJECTS refreshed (real repo data)");
      }
    }
  }

  if (changed) {
    await writeFile(SVG_PATH, svg, "utf8");
    console.log(`wrote ${SVG_PATH}`);
  } else {
    console.log("no changes");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
