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
// token and stays cheap enough to run daily), across every owned repo -
// forks included, since a fork with real commits from this user (not just
// a click-to-fork-and-never-touch) is still this user's own work - filtered
// down to commits actually authored by this user.
// also reports ownRepos - how many of the user's own repos they have commits
// in - since that's a free byproduct of the same per-repo contributor-stats
// fetch, and github-readme-stats' "contribs" figure (used for the
// "Contributed to" row) only counts repos the user does NOT own, same as
// GitHub's own profile page. Adding ownRepos to it is what makes that row
// count every repo, not just external ones.
async function buildLinesOfCode(username) {
  const reposRes = await fetch(`https://api.github.com/users/${username}/repos?per_page=100&type=owner`, {
    headers: ghHeaders(),
  });
  if (!reposRes.ok) return { loc: null, ownRepos: 0 };
  const repos = await reposRes.json();

  const perRepo = await Promise.all(
    repos.map(async (r) => {
      const stats = await fetchContributorStats(username, r.name);
      if (Array.isArray(stats)) {
        const mine = stats.find((c) => c.author && c.author.login?.toLowerCase() === username.toLowerCase());
        if (!mine) return null;
        let additions = 0, deletions = 0;
        for (const w of mine.weeks) {
          additions += w.a;
          deletions += w.d;
        }
        return { additions, deletions };
      }
      // stats/contributors never generated a cache for this repo (some
      // low-activity repos just sit at 204 forever, no amount of retrying
      // fixes it) - fall back to the plain commits list, which works even
      // when the stats cache doesn't, so a real contribution isn't silently
      // dropped just because GitHub never computed the aggregate. Additions
      // and deletions are unknown in this case, so this repo counts toward
      // ownRepos but contributes 0 to the lines-of-code tally.
      const commitsRes = await fetch(`https://api.github.com/repos/${username}/${r.name}/commits?author=${username}&per_page=1`, {
        headers: ghHeaders(),
      });
      if (!commitsRes.ok) return null;
      const commits = await commitsRes.json();
      return Array.isArray(commits) && commits.length > 0 ? { additions: 0, deletions: 0 } : null;
    })
  );

  let additions = 0, deletions = 0, ownRepos = 0;
  for (const r of perRepo) {
    if (!r) continue;
    ownRepos++;
    additions += r.additions;
    deletions += r.deletions;
  }
  if (ownRepos === 0) return { loc: null, ownRepos: 0 };

  const net = additions - deletions;
  // ++ / -- colored like a diff (green additions, red deletions) instead of
  // plain text, so the row reads at a glance same as the candlestick chart
  const net_ = net.toLocaleString("en-US");
  const add_ = additions.toLocaleString("en-US");
  const del_ = deletions.toLocaleString("en-US");
  const loc = `${net_} <tspan dx="-3" style="font-size:16px">(<tspan fill="#3ddc84">${add_}++</tspan>, <tspan fill="#ff5c5c">${del_}--</tspan>)</tspan>`;
  return { loc, ownRepos };
}

// all-time count of repos NOT owned by this user where they've authored a
// PR or a commit, via the Search API (no time bound) - unlike GitHub's own
// "contributed to" stat (and github-readme-stats' "contribs" figure, which
// is scraped from it), which is scoped to roughly the trailing year and so
// misses older school/group-project repos.
async function fetchExternalContribRepos(username) {
  const repos = new Set();
  const headers = ghHeaders();

  const prRes = await fetch(`https://api.github.com/search/issues?q=author:${username}+type:pr&per_page=100`, { headers });
  if (prRes.ok) {
    const data = await prRes.json();
    for (const item of data.items || []) {
      repos.add(item.repository_url.replace("https://api.github.com/repos/", "").toLowerCase());
    }
  }

  const commitRes = await fetch(`https://api.github.com/search/commits?q=author:${username}&per_page=100`, { headers });
  if (commitRes.ok) {
    const data = await commitRes.json();
    for (const item of data.items || []) {
      repos.add(item.repository.full_name.toLowerCase());
    }
  }

  const ownPrefix = `${username.toLowerCase()}/`;
  return [...repos].filter((r) => !r.startsWith(ownPrefix)).length;
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
  const { loc, ownRepos } = await buildLinesOfCode(username);

  const externalContribs = await fetchExternalContribRepos(username);
  const contribs = (externalContribs + ownRepos).toLocaleString("en-US");

  const rows = [
    ["Total Stars", grab("stars")],
    ["Pull Requests", grab("prs")],
    ["Issues", grab("issues")],
    ["Repos Touched", contribs],
    ["Lines", loc || "—"],
    ["Rank", rank],
  ];

  // 6 rows now (was 7 with Commits) - row height recomputed so they still
  // divide the card's available vertical space evenly instead of leaving a
  // leftover gap at the bottom where the removed row used to be
  const rowH = 30;
  const lines = rows
    .map(([k, v], i) => {
      const y = i * rowH;
      const bg = i % 2 === 0 ? `<rect x="-6" y="${y - 4}" width="${width + 12}" height="${rowH}" rx="6" fill="#ffffff08"/>` : "";
      const valueColor = k === "Rank" ? ";fill:#3ddc84" : "";
      return `${bg}<text x="0" y="${y + 20}" style="font-size:16px;fill:#8b93a3">${k}</text><text x="${width}" y="${y + 20}" text-anchor="end" style="font-size:18px;font-weight:700${valueColor}">${v}</text>`;
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

// helpers shared by the standalone project cards (see cards/*.svg, built by
// buildProjectCard below) - real repo data (language, commits, last push)
// fetched live from the GitHub API, not hand-typed, so it stays accurate as
// the repos change.
// per-mille advance widths (standard Helvetica AFM metrics) used to wrap
// description text by actual measured pixel width instead of a rough
// character count - keeps the right margin as tight as the left one instead
// of leaving a guessed amount of slack on every line.
const GLYPH_WIDTH = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  0: 556, 1: 556, 2: 556, 3: 556, 4: 556, 5: 556, 6: 556, 7: 556, 8: 556, 9: 556,
  ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
};

function textWidthPx(str, fontSize) {
  let units = 0;
  for (const ch of str) units += GLYPH_WIDTH[ch] ?? 556;
  return (units * fontSize) / 1000;
}

function wrapText(text, maxWidthPx, fontSize, maxLines) {
  const words = (text || "").split(/\s+/).filter(Boolean);
  const spaceW = textWidthPx(" ", fontSize);
  const lines = [];
  let cur = "";
  let curW = 0;
  for (const w of words) {
    const wW = textWidthPx(w, fontSize);
    const nextW = cur ? curW + spaceW + wW : wW;
    if (nextW > maxWidthPx) {
      if (cur) lines.push(cur);
      cur = w;
      curW = wW;
      if (lines.length === maxLines) break;
    } else {
      cur = cur ? `${cur} ${w}` : w;
      curW = nextW;
    }
  }
  const consumedAll = lines.length < maxLines;
  if (consumedAll && cur) lines.push(cur);
  const truncated = !consumedAll;
  if (truncated && lines.length === maxLines) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && textWidthPx(last + "…", fontSize) > maxWidthPx) {
      last = last.slice(0, -1).trimEnd();
    }
    lines[maxLines - 1] = last + "…";
  }
  return lines;
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

async function fetchTotalCommits(username, repo) {
  const res = await fetch(`https://api.github.com/repos/${username}/${repo}/commits?per_page=1`, { headers: ghHeaders() });
  if (!res.ok) return null;
  const link = res.headers.get("link");
  const m = link && link.match(/page=(\d+)>; rel="last"/);
  if (m) return Number(m[1]);
  const data = await res.json();
  return Array.isArray(data) ? data.length : null;
}

// Highlighted-project cards are now standalone SVG files (see cards/*.svg),
// each wrapped in a real <a href> in README.md, instead of one section baked
// into profile.svg - GitHub strips all interactivity from SVGs loaded via
// <img>, so a link only works this way: a real HTML <a> around a separate
// <img>, not an <a> living inside the image itself. The card still carries
// its own font/filter <defs> since it's no longer sharing profile.svg's.
async function buildProjectCard(username, spec) {
  const repoData = await fetchRepo(username, spec.repo);
  if (!repoData) return null;

  const langs = await fetchTopLanguages(username, spec.repo);
  const tags = langs.length ? langs : [repoData.language || "—"];
  const totalCommits = await fetchTotalCommits(username, spec.repo);

  let additions = 0;
  const stats = await fetchContributorStats(username, spec.repo);
  if (Array.isArray(stats)) {
    const mine = stats.find((c) => c.author && c.author.login?.toLowerCase() === username.toLowerCase());
    if (mine) for (const w of mine.weeks) additions += w.a;
  }

  const CW = 340, PAD = 18, IMG_H = 140;
  const descLines = wrapText(spec.desc, CW - 2 * PAD, 11.5, 3);
  const descBlockH = 3 * 17; // reserve fixed space for 3 lines regardless of actual wrap
  let y = IMG_H + 26;
  let body = `<g clip-path="url(#imgClip)">${spec.banner}</g>`;
  body += `<text x="${PAD}" y="${y}" style="font-family:ui-sans-serif,-apple-system,'Segoe UI',system-ui,sans-serif;font-size:16px;font-weight:800;fill:#e7ebf3">${escXml(spec.display)}</text>`;
  y += 24;
  const descTop = y;
  for (const l of descLines) {
    body += `<text x="${PAD}" y="${y}" style="font-family:ui-sans-serif,-apple-system,'Segoe UI',system-ui,sans-serif;font-size:11.5px;fill:#c9d1d9">${escXml(l)}</text>`;
    y += 17;
  }
  y = descTop + descBlockH + 10;
  let tx = PAD;
  for (const tag of tags) {
    const w = tag.length * 7 + 20;
    body += `<rect x="${tx}" y="${y - 13}" width="${w}" height="22" rx="11" fill="#141a26" stroke="#ffffff14"/><text x="${tx + w / 2}" y="${y + 2}" text-anchor="middle" style="font-size:10px;font-weight:700;fill:#4f8cff">${escXml(tag)}</text>`;
    tx += w + 7;
  }
  y += 30;
  body += `<line x1="${PAD}" y1="${y}" x2="${CW - PAD}" y2="${y}" stroke="#ffffff14"/>`;
  y += 24;
  body += `<text x="${PAD}" y="${y}" style="font-family:ui-sans-serif,-apple-system,'Segoe UI',system-ui,sans-serif;font-size:11.5px;font-weight:700;fill:#4f8cff">View project →</text>`;
  y += 18;
  const commitsStr = totalCommits != null ? `${totalCommits} commits` : "— commits";
  const locStr = additions >= 1000 ? `${(additions / 1000).toFixed(1)}K` : String(additions);
  body += `<text x="${PAD}" y="${y}" style="font-size:9.5px;fill:#6c7689">${commitsStr} · ${locStr} loc · updated ${relativeTime(repoData.pushed_at)}</text>`;
  const h = y + 20;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${h}" viewBox="0 0 ${CW} ${h}" role="img" aria-label="${escXml(spec.display)}">
<defs>
  <style>
    text { font-family: ui-monospace, 'Cascadia Code', 'JetBrains Mono', Consolas, monospace; fill: #e7ebf3; }
  </style>
  <clipPath id="imgClip"><path d="M0 14 a14 14 0 0 1 14 -14 h${CW - 28} a14 14 0 0 1 14 14 v${IMG_H - 14} h-${CW} z"/></clipPath>
</defs>
<rect width="${CW}" height="${h}" rx="14" fill="#10151d"/>
${body}
</svg>`;
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
    const forgeBanner = (await readFile("cards/assets/the-forge-banner.png")).toString("base64");
    const bobBanner = (await readFile("cards/assets/bob-the-destructor-banner.png")).toString("base64");

    const cardSpecs = [
      {
        repo: "The_Forge",
        display: "The Forge",
        desc: "A gym management website built around three roles - members book classes, trainers manage schedules, admins run the show.",
        banner: `<image href="data:image/png;base64,${forgeBanner}" x="0" y="0" width="340" height="140" preserveAspectRatio="xMidYMid slice"/>`,
        file: "cards/the-forge.svg",
      },
      {
        repo: "Bob_The_Destructor",
        display: "Bob the Destructor",
        desc: "Five caves, one miner, endless ore - how deep can you dig? Mine smarter and outlast every collapse.",
        banner: `<image href="data:image/png;base64,${bobBanner}" x="0" y="0" width="340" height="140" preserveAspectRatio="xMidYMid slice"/>`,
        file: "cards/bob-the-destructor.svg",
      },
    ];

    for (const spec of cardSpecs) {
      const card = await buildProjectCard(USERNAME, spec);
      if (!card) {
        console.warn(`[skip] ${spec.file}: build failed, keeping existing content`);
        continue;
      }
      const existing = await readFile(spec.file, "utf8").catch(() => null);
      if (existing !== card) {
        await writeFile(spec.file, card, "utf8");
        console.log(`[ok] ${spec.file} refreshed (real repo data)`);
      } else {
        console.log(`[ok] ${spec.file} unchanged`);
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
