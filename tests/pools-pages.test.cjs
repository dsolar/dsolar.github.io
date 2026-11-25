// Each pool game's own page (/pools/<slug>/, tools/pools_pages.py): written from the pools page and kept in step,
// each marked with its game, and the pools page knows every one of them.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { execFileSync } = require("node:child_process");
const ROOT = path.join(__dirname, "..");
test("the game pages match the pools page (run python3 tools/pools_pages.py after changing it)", () => {
  execFileSync("python3", [path.join(ROOT, "tools/pools_pages.py"), "--check"], { stdio: "pipe" });
});
test("every game in pools.js has a page marked with its kind", () => {
  const src = fs.readFileSync(path.join(ROOT, "fantasy-kit/pools.js"), "utf8");
  const slugs = JSON.parse(src.match(/const SLUG = (\{[^}]+\})/)[1].replace(/(\w+):/g, '"$1":'));
  for (const [kind, slug] of Object.entries(slugs)) {
    const html = fs.readFileSync(path.join(ROOT, "pools", slug, "index.html"), "utf8");
    assert.ok(html.includes(`data-game="${kind}"`), slug);
    assert.ok(html.includes(`https://davidsolar.dev/pools/${slug}/`), slug + " canonical");
  }
});
