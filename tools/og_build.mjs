// Builds the link-preview images (assets/og/<name>.jpg, 1200x630) that iMessage, Slack and the rest show when a
// page is shared: the project's title and line on the site's paper, with its cover as a card beside them, so the
// cover is never cropped the way a 4:3 cover is in a 1.9:1 preview. Hubs show a fan of their projects' covers.
//   node tools/og_build.mjs [fonts-dir]
// fonts-dir holds @fontsource/besley and @fontsource/libre-franklin (npm pack them and unpack there); without it
// the system's fonts stand in. Needs Playwright. Rerun after a cover, title or line changes in assets/projects.js.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const { chromium } = await import("playwright").catch(() => import("/opt/npm-tools/node_modules/playwright/index.mjs"));
const window = {};
new Function("window", readFileSync(ROOT + "assets/projects.js", "utf8"))(window);
const P = Object.values(window).find(Array.isArray);
const fonts = process.argv[2];
const face = (fam, pkg, w) => {
  const f = fonts && `${fonts}/${pkg}/package/files/${pkg.replace(/^fontsource-|-\d.*$/g, "")}-latin-${w}-normal.woff2`;
  return f && existsSync(f) ? `@font-face{font-family:"${fam}";font-weight:${w};src:url(file://${f})}` : "";
};
const pkgOf = (name) => (fonts ? (readdirSafe(fonts).find((d) => d.startsWith(`fontsource-${name}-`) && !d.endsWith(".tgz")) || "") : "");
import { readdirSync } from "node:fs";
function readdirSafe(d) { try { return readdirSync(d); } catch (e) { return []; } }
const FACES = [face("Besley", pkgOf("besley"), 800), face("Besley", pkgOf("besley"), 700), face("Libre Franklin", pkgOf("libre-franklin"), 500), face("Libre Franklin", pkgOf("libre-franklin"), 600)].join("");

const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const src = (img) => "file://" + ROOT + String(img).replace(/\?.*$/, "");
const card = (p, style = "") => {
  const c = p.cover || {};
  return `<div class="card" style="--bg:${c.bg || "#e9e4da"};--band:${c.band || "#c60c30"};${style}">${c.image ? `<img src="${src(c.image)}">` : `<b>${esc(p.title)}</b>`}</div>`;
};
function page({ title, line, path, cards }) {
  const big = title.length > 22 ? 52 : title.length > 14 ? 62 : 72;
  return `<!doctype html><html><head><style>${FACES}
  *{box-sizing:border-box;margin:0}html,body{width:1200px;height:630px;overflow:hidden}
  body{position:relative;background:#F5F3EF;color:#002244;font-family:"Libre Franklin",Inter,sans-serif}
  body:after{content:"";position:absolute;left:0;right:0;bottom:0;height:12px;background:#C60C30}
  .brand{position:absolute;left:64px;top:56px;display:flex;align-items:center;gap:14px;font:700 30px "Besley",Georgia,serif}
  .brand img{width:48px;height:48px}
  h1{position:absolute;left:64px;top:150px;width:450px;overflow-wrap:normal;font:800 ${big}px/1.02 "Besley",Georgia,serif;letter-spacing:-.01em}
  p{position:absolute;left:64px;width:450px;font:500 28px/1.32 "Libre Franklin",Inter,sans-serif;color:#3d4a5c}
  .url{position:absolute;left:64px;bottom:44px;font:600 22px "Libre Franklin",Inter,sans-serif;color:#6b7686}
  .card{position:absolute;width:600px;height:450px;border-radius:12px;overflow:hidden;background:var(--bg);border-top:10px solid var(--band);box-shadow:0 22px 50px rgba(0,34,68,.22),0 2px 6px rgba(0,34,68,.12)}
  .card img{display:block;width:100%;height:100%;object-fit:cover;object-position:center top}
  .card b{display:flex;align-items:flex-end;height:100%;padding:28px;color:#fff;font:800 54px/1 "Besley",serif}
  </style></head><body>
  <div class="brand"><img src="file://${ROOT}assets/nav-mark.svg">David Solar</div>
  <h1 id="t">${esc(title)}</h1><p id="l">${esc(line)}</p>
  <div class="url">davidsolar.dev${esc(path === "/" ? "" : path)}</div>
  ${cards}
  <script>
  // once the fonts are in: shrink the title until it fits its column in at most three lines, then hang the line below it
  document.fonts.ready.then(() => {
    const t = document.getElementById("t"), l = document.getElementById("l");
    let s = ${big};
    while ((t.scrollWidth > 450 || t.offsetHeight > 3.2 * s) && s > 34) { s -= 2; t.style.fontSize = s + "px"; }
    l.style.top = (t.offsetTop + t.offsetHeight + 22) + "px";
    window.done = true;
  });
  </script>
  </body></html>`;
}
const one = (p) => card(p, "left:540px;top:86px");
const fan = (ps) => ps.slice(0, 3).map((p, i) => card(p, `left:${520 + i * 60}px;top:${70 + i * 46}px;width:540px;height:405px;transform:rotate(${(i - 1) * 3}deg);z-index:${i}`)).join("");
const byUrl = (u) => P.find((p) => p.url === u);
const name = (u) => u.replace(/\/$/, "").replace(/\//g, "-") || "home";

const jobs = P.filter((p) => !p.external).map((p) => ({ file: name(p.url), title: p.title, line: p.line, path: "/" + p.url, cards: one(p) }));
// hubs and pages the catalog doesn't list
const of = (...us) => us.map(byUrl).filter(Boolean);
jobs.push(
  { file: "games", title: "Games", line: "Daily challenges for the group chat, and a few that take longer.", path: "/games/", cards: fan(of("journeyman/", "guess-the-pick/", "win-probability/")) },
  { file: "simulations", title: "Simulations & Tools", line: "Seasons played out thousands of times, front offices to run, drafts to mock.", path: "/simulations/", cards: fan(of("nfl/", "draft/", "31st-franchise/")) },
  { file: "kids", title: "Kids", line: "Games my daughters designed and we built together.", path: "/kids/", cards: fan(of("jellycat-battle/", "wild-bloom-isles/")) },
  { file: "fantasy-kit", title: "Draft Lab", line: "Mock drafts against bots, and private leagues with formats you won't find anywhere else.", path: "/fantasy-kit/", cards: fan(of("yoenis/", "guillotine/", "fantasy/")) },
);
mkdirSync(ROOT + "assets/og", { recursive: true });
const TMP = tmpdir() + "/og-build.html";
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1200, height: 630 } });
for (const j of jobs) {
  // a file page, so it may load the covers from disk
  writeFileSync(TMP, page(j));
  await pg.goto("file://" + TMP, { waitUntil: "load" });
  await pg.waitForFunction(() => window.done);
  await pg.waitForTimeout(150);
  await pg.screenshot({ path: `${ROOT}assets/og/${j.file}.jpg`, type: "jpeg", quality: 84 });
}
await b.close();
console.log(`${jobs.length} preview images in assets/og/`);
