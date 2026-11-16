// Draws the "Surveillance Report" stats card for the profile README.
// Runs in GitHub Actions (Node 20+, no dependencies). Always writes a valid SVG
// and exits 0, so a failed API call can never break the image on the profile.
//
// usage: node surveillance.mjs <out.svg> [--offline]
// env:   GITHUB_TOKEN, GH_LOGIN, MOCK_JSON (optional path to a saved API response)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const GLYPHS = JSON.parse(readFileSync(join(here, "glyphs.json"), "utf8"));
const OUT = process.argv[2] || "surveillance.svg";
const LOGIN = process.env.GH_LOGIN || "yugmakkar";

const AMBER = "#FFC300", TXT = "#E8E6E1", MUTED = "#8A919C", PANEL = "#0B0E14", LINE = "#232A35";
const BAT = "M0,-8 L3.2,-8 L6.2,-23 L9.6,-9.5 C26,-6.5 50,-10 74,-25 C66,-13 61,-5 57,2 L47.5,-3 C45,3 41,9 37,16 L26.5,7.5 C17,11 8,19 0,33 C-8,19 -17,11 -26.5,7.5 L-37,16 C-41,9 -45,3 -47.5,-3 L-57,2 C-61,-5 -66,-13 -74,-25 C-50,-10 -26,-6.5 -9.6,-9.5 L-6.2,-23 L-3.2,-8 Z";

// ---------- text as glyph paths (renders identically everywhere) ----------
class Doc {
  constructor() { this.defs = new Map(); }
  width(s, font, size, ls = 0) {
    const f = GLYPHS[font];
    let w = 0;
    for (const c of s) w += (f.g[c] || f.g["?"])[1];
    return (w * size) / f.upm + ls * Math.max(s.length - 1, 0);
  }
  text(s, font, size, x, y, { fill = TXT, anchor = "start", ls = 0, cls = "", style = "" } = {}) {
    const f = GLYPHS[font];
    const k = size / f.upm;
    const w = this.width(s, font, size, ls);
    if (anchor === "middle") x -= w / 2;
    if (anchor === "end") x -= w;
    let pen = 0;
    const uses = [];
    for (const c of s) {
      const ch = f.g[c] ? c : "?";
      const [d, adv] = f.g[ch];
      if (ch !== " " && d) {
        const id = font + ch.codePointAt(0).toString(16);
        this.defs.set(id, d);
        uses.push(`<use href="#${id}" x="${Math.round(pen)}"/>`);
      }
      pen += adv + ls / k;
    }
    const c = cls ? ` class="${cls}"` : "";
    const st = style ? ` style="${style}"` : "";
    return `<g${c}${st} fill="${fill}"><g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${k.toFixed(5)})">${uses.join("")}</g></g>`;
  }
  defsXml() { return [...this.defs].map(([id, d]) => `<path id="${id}" d="${d}"/>`).join(""); }
}

const W = 840;
const fmt = (n) => n.toLocaleString("en-US");
const days = (n) => `${n} ${n === 1 ? "DAY" : "DAYS"}`;

function frame(doc, H, label, body, style, extraDefs = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${label}">` +
    `<defs><clipPath id="cp"><rect width="${W}" height="${H}" rx="14"/></clipPath>` +
    `<pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28,0 L0,0 0,28" fill="none" stroke="#fff" stroke-opacity=".03"/></pattern>` +
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PANEL}"/><stop offset="1" stop-color="#121A28"/></linearGradient>` +
    extraDefs + doc.defsXml() + `<style>${style}</style></defs>` +
    `<g clip-path="url(#cp)"><rect width="${W}" height="${H}" fill="url(#sky)"/><rect width="${W}" height="${H}" fill="url(#grid)"/>${body}</g>` +
    `<rect x=".75" y=".75" width="${W - 1.5}" height="${H - 1.5}" rx="13.5" fill="none" stroke="${LINE}" stroke-width="1.5"/></svg>`;
}

function header(doc, right) {
  return `<path d="${BAT}" transform="translate(52,44) scale(.26)" fill="${AMBER}"/>` +
    doc.text("SURVEILLANCE REPORT", "bebas", 34, 84, 56, { fill: TXT, ls: 2.5 }) +
    doc.text(right, "mono", 13, W - 32, 52, { fill: MUTED, anchor: "end" }) +
    `<line x1="32" y1="76" x2="${W - 32}" y2="76" stroke="${LINE}"/>`;
}

// ---------- data ----------
const QUERY = `query($login:String!){user(login:$login){
  followers{totalCount}
  repositories(first:100,ownerAffiliations:OWNER,isFork:false,privacy:PUBLIC){
    totalCount nodes{stargazerCount languages(first:8,orderBy:{field:SIZE,direction:DESC}){edges{size node{name}}}}}
  contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{contributionCount date}}}}}}`;

async function load() {
  if (process.env.MOCK_JSON) return JSON.parse(readFileSync(process.env.MOCK_JSON, "utf8"));
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "profile-surveillance-card" },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json;
}

function analyse(json) {
  const u = json.data.user;
  const cal = u.contributionsCollection.contributionCalendar;
  const days = cal.weeks.flatMap((w) => w.contributionDays);
  // current streak: today may still be empty, so it doesn't break the streak
  let cur = 0;
  let i = days.length - 1;
  if (i >= 0 && days[i].contributionCount === 0) i--;
  for (; i >= 0 && days[i].contributionCount > 0; i--) cur++;
  let best = 0, run = 0;
  for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; best = Math.max(best, run); }
  const repos = u.repositories.nodes;
  const stars = repos.reduce((s, r) => s + r.stargazerCount, 0);
  const langs = new Map();
  for (const r of repos) for (const e of r.languages.edges) langs.set(e.node.name, (langs.get(e.node.name) || 0) + e.size);
  const total = [...langs.values()].reduce((a, b) => a + b, 0) || 1;
  const top = [...langs].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, s]) => [n, s / total]);
  const weeks = cal.weeks.map((w) => w.contributionDays.reduce((s, d) => s + d.contributionCount, 0));
  return {
    contributions: cal.totalContributions, cur, best, repos: u.repositories.totalCount, stars,
    followers: u.followers.totalCount, top, weeks, activeDays: days.filter((d) => d.contributionCount > 0).length,
  };
}

// ---------- render ----------
function render(s) {
  const doc = new Doc();
  const H = 560;
  const today = new Date().toISOString().slice(0, 10);
  let body = header(doc, `@${LOGIN} · updated ${today}`);

  // stat tiles, 3 x 2
  const tiles = [
    [fmt(s.contributions), "CONTRIBUTIONS · 1Y"],
    [days(s.cur), "CURRENT STREAK"],
    [days(s.best), "LONGEST STREAK"],
    [fmt(s.activeDays), "ACTIVE DAYS · 1Y"],
    [fmt(s.repos), "PUBLIC REPOS"],
    [fmt(s.stars), "STARS EARNED"],
  ];
  const tw = (W - 64 - 2 * 16) / 3, th = 86;
  tiles.forEach(([v, l], n) => {
    const x = 32 + (n % 3) * (tw + 16), y = 96 + Math.floor(n / 3) * (th + 14);
    body += `<g class="tile" style="animation-delay:${(0.15 + n * 0.1).toFixed(2)}s">` +
      `<rect x="${x}" y="${y}" width="${tw}" height="${th}" rx="10" fill="#0E131C" stroke="${LINE}"/>` +
      `<rect x="${x}" y="${y + 16}" width="3" height="${th - 32}" fill="${AMBER}"/>` +
      doc.text(v, "bebas", 46, x + 22, y + 52, { fill: n === 1 ? AMBER : TXT, ls: 1 }) +
      doc.text(l, "mono", 13, x + 23, y + 74, { fill: MUTED, ls: 0.5 }) + `</g>`;
  });

  // languages: one stacked bar + legend
  const ly = 312;
  body += doc.text("TOP LANGUAGES · PUBLIC REPOS", "monob", 13, 32, ly, { fill: AMBER, ls: 1.5 });
  const ramp = ["#FFC300", "#D9A400", "#A9831A", "#7A6328", "#4F4630"];
  let bx = 32;
  const bw = W - 64;
  const top = s.top.length ? s.top : [["no public code yet", 1]];
  top.forEach(([, p], n) => {
    const w = Math.max(bw * p, 2);
    body += `<rect class="lang" style="animation-delay:${(0.6 + n * 0.12).toFixed(2)}s" x="${bx.toFixed(1)}" y="${ly + 14}" width="${w.toFixed(1)}" height="10" fill="${ramp[n]}"/>`;
    bx += w;
  });
  let lx = 32;
  top.forEach(([name, p], n) => {
    const label = `${name} ${(p * 100).toFixed(1)}%`;
    if (lx + 16 + doc.width(label, "mono", 14) > W - 32) return; // legend full
    body += `<rect x="${lx}" y="${ly + 40}" width="10" height="10" rx="2" fill="${ramp[n]}"/>` +
      doc.text(label, "mono", 14, lx + 16, ly + 50, { fill: TXT });
    lx += 16 + doc.width(label, "mono", 14) + 24;
  });

  // contribution skyline: one building per week
  const sy = 398, base = H - 26, maxH = base - sy - 36;
  body += doc.text("THE CITY OF COMMITS · ONE BUILDING PER WEEK", "monob", 13, 32, sy, { fill: AMBER, ls: 1.5 });
  const weeks = s.weeks.slice(-53);
  const max = Math.max(...weeks, 1);
  const step = (W - 64) / weeks.length, bwid = Math.max(step - 3, 3);
  let city = "", lit = "";
  weeks.forEach((c, n) => {
    const h = c === 0 ? 5 : 12 + Math.sqrt(c / max) * (maxH - 12);
    const x = 32 + n * step, y = base - h;
    city += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bwid.toFixed(1)}" height="${h.toFixed(1)}" fill="${c ? "#1B2333" : "#121823"}"/>`;
    // light up windows in proportion to that week's commits
    const rows = Math.floor((h - 8) / 9);
    const on = Math.min(rows, Math.ceil(Math.sqrt(c) * 1.6));
    for (let r = 0; r < on; r++) {
      const wy = base - 8 - r * 9;
      lit += `<rect x="${(x + bwid / 2 - 2).toFixed(1)}" y="${wy.toFixed(1)}" width="4" height="5" opacity="${(0.45 + 0.5 * ((r * 7 + n) % 5) / 4).toFixed(2)}"/>`;
    }
    if (n === weeks.length - 1) {
      body += `<circle class="beacon" cx="${(x + bwid / 2).toFixed(1)}" cy="${(y - 7).toFixed(1)}" r="3.2" fill="${AMBER}"/>`;
    }
  });
  body += `<g class="city"><g>${city}</g><g fill="${AMBER}">${lit}</g></g>`;
  body += `<line x1="32" y1="${base + 0.5}" x2="${W - 32}" y2="${base + 0.5}" stroke="${LINE}"/>`;
  body += doc.text("12 months ago", "mono", 12, 32, base + 17, { fill: MUTED }) + doc.text("this week", "mono", 12, W - 32, base + 17, { fill: MUTED, anchor: "end" });

  const style =
    ".tile{animation:up .7s cubic-bezier(.2,.8,.2,1) both}@keyframes up{from{opacity:0;transform:translateY(10px)}}" +
    ".lang{transform-box:fill-box;transform-origin:left;animation:gx .9s cubic-bezier(.2,.8,.2,1) both}@keyframes gx{from{transform:scaleX(0)}}" +
    `.city{transform-box:fill-box;transform-origin:bottom;animation:rise 1.6s cubic-bezier(.2,.8,.2,1) .4s both}@keyframes rise{from{transform:scaleY(0)}}` +
    ".beacon{animation:bk 1.2s steps(1) infinite}@keyframes bk{50%{opacity:.15}}";
  const label = `Surveillance report for ${LOGIN}: ${s.contributions} contributions in the last year, current streak ${s.cur} days, longest streak ${s.best} days, ${s.repos} public repos, ${s.stars} stars.`;
  return frame(doc, H, label, body, style);
}

function offline(reason) {
  const doc = new Doc();
  const H = 220;
  const body = header(doc, `@${LOGIN}`) +
    doc.text("SIGNAL LOST", "bebas", 52, W / 2, 140, { fill: AMBER, anchor: "middle", ls: 4, cls: "flick" }) +
    doc.text("the report redraws itself on the next patrol.", "mono", 15, W / 2, 176, { fill: MUTED, anchor: "middle" });
  const style = ".flick{animation:f 3s linear infinite}@keyframes f{0%,100%{opacity:1}48%{opacity:1}50%{opacity:.3}52%{opacity:1}}";
  if (reason) console.error("surveillance card offline:", reason);
  return frame(doc, H, "Surveillance report temporarily offline.", body, style);
}

let svg;
if (process.argv.includes("--offline")) {
  svg = offline();
} else {
  try {
    svg = render(analyse(await load()));
  } catch (e) {
    svg = offline(e && e.message ? e.message : String(e));
  }
}
writeFileSync(OUT, svg);
console.log(`wrote ${OUT} (${svg.length} bytes)`);
