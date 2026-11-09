/* Player faces, shared by every page on the site.
 *
 *   <link rel="stylesheet" href="/assets/faces.css">
 *   <script src="/assets/faces.js"></script>
 *
 * With an id (MLB hub, Fantasy Kit):
 *   DSFaces.html({ sport: "mlb", id: 660271, name: "Shohei Ohtani", color: "#005A9C", size: 32 })
 * With only a name (most pages): the face is looked up in the faces registry (assets/faces/<sport>.json, built
 * every morning by tools/faces_build.py). The initials show at once and the photo fills in when the registry loads:
 *   DSFaces.html({ sport: "nba", name: "Jayson Tatum", color: "#007A33", size: 40 })
 * Any element can ask for a face the same way, whatever draws it:
 *   <span data-face-sport="nfl" data-face-name="Drake Maye"></span>   (DSFaces fills in an <img> and adds .has-face)
 *
 * sport: mlb (MLBAM id), nba / nfl (ESPN id), ncaab / ncaaf (ESPN college id, the draft Big Board).
 * Photos are linked, not copied: MLB's own servers for baseball (cropped on the face), ESPN's for the rest.
 * hide: true draws only the initials (guessing games, before the answer is shown).
 */
(function () {
  var ESPN_PATH = { nfl: "nfl", nba: "nba", mlb: "mlb", ncaaf: "college-football", ncaab: "mens-college-basketball" };
  var ROOT = (function () { // where assets/ lives, from this script's own address
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/faces\.js.*$/, "") : "/assets/";
  })();

  // Photo sizes come in a few steps (sharper on phones, and the CDN caches each step once)
  function px(size) { var p = (size || 40) * 3; return p <= 72 ? 72 : p <= 120 ? 120 : p <= 180 ? 180 : 240; }

  // The photo address. id is a number (MLBAM for mlb, ESPN for everything else) or "league:id" for a player
  // registered under another league (a college player on an NBA page, say).
  function url(sport, id, opts) {
    opts = opts || {};
    if (id == null || id === "" || id === 0) return "";
    var s = String(id), m = /^([a-z]+):(\d+)$/.exec(s);
    if (m) { sport = m[1]; s = m[2]; }
    var p = px(opts.size);
    if (sport === "mlb") // MLB's photos sit on Cloudinary: crop square around the face
      return "https://img.mlbstatic.com/mlb-photos/image/upload/c_thumb,g_face,z_1.0,w_" + p + ",h_" + p + ",q_auto:best/v1/people/" + s + "/headshot/" + (opts.milb ? "milb" : "67") + "/current";
    var lg = sport === "espn" ? opts.league : sport;
    if (!ESPN_PATH[lg]) return "";
    return "https://a.espncdn.com/combiner/i?img=/i/headshots/" + ESPN_PATH[lg] + "/players/full/" + s + ".png&w=" + p + "&h=" + Math.round(p * 0.73);
  }
  function isEspn(sport, id) { return /^[a-z]+:/.test(String(id)) ? !/^mlb:/.test(String(id)) : sport !== "mlb"; }

  // Names to registry keys: no accents, punctuation or suffixes ("Ronald Acuña Jr." -> "ronald-acuna")
  function slug(name) {
    return String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[.'’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim()
      .replace(/\s+(jr|sr|ii|iii|iv|v)$/, "").replace(/\s+/g, "-");
  }

  function initials(name) {
    var parts = String(name || "").replace(/\b(Jr|Sr|II|III|IV)\.?$/i, "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }

  // White or near-black, whichever reads better on the team color
  function ink(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return "#fff";
    var n = parseInt(m[1], 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(function (x) {
      x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.4 ? "#111" : "#fff";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function imgTag(src) {
    return '<img src="' + esc(src) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode&&this.parentNode.classList.remove(\'has-face\',\'espn\');this.remove()">';
  }

  // o: { sport, id, name, color, size, milb, league, hide, cls, title }
  function html(o) {
    o = o || {};
    var size = o.size || 32, color = o.color || "#33415c";
    var src = o.hide ? "" : url(o.sport, o.id, o);
    var style = "--face-size:" + size + "px;--face-bg:" + color + ";--face-ink:" + ink(color);
    var label = esc(o.title || o.name || "");
    var cls = "ds-face" + (src ? " has-face" : "") + (src && isEspn(o.sport, o.id) ? " espn" : "") + (o.cls ? " " + esc(o.cls) : "");
    // no id: ask the registry by name (filled in by hydrate below)
    var ask = !src && !o.hide && o.name && o.sport ? ' data-face-sport="' + esc(o.sport) + '" data-face-name="' + esc(o.name) + '" data-face-size="' + size + '"' : "";
    return '<span class="' + cls + '" style="' + style + '"' + (label ? ' title="' + label + '"' : "") + ask + ' aria-hidden="true"><span class="ds-face-ini">' +
      esc(initials(o.name)) + "</span>" + (src ? imgTag(src) : "") + "</span>";
  }

  function el(o) {
    var t = document.createElement("template");
    t.innerHTML = html(o);
    return t.content.firstChild;
  }

  // ---------- the registry ----------
  var reg = {}, loading = {}, waiting = [];
  function load(sport) {
    if (reg[sport] || loading[sport]) return loading[sport] || Promise.resolve(reg[sport]);
    loading[sport] = fetch(ROOT + "faces/" + sport + ".json").then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; }).then(function (d) { reg[sport] = d.ids || d; return reg[sport]; });
    return loading[sport];
  }
  // The photo id for a name, once that sport's registry has loaded (undefined until then, null when unknown)
  function find(sport, name) {
    var r = reg[sport];
    if (!r) return undefined;
    var v = r[slug(name)];
    return v == null ? null : v;
  }

  function hydrate(root) {
    var els = (root || document).querySelectorAll ? (root || document).querySelectorAll("[data-face-name]:not([data-face-done])") : [];
    if (root && root.matches && root.matches("[data-face-name]:not([data-face-done])")) els = [root].concat([].slice.call(els));
    [].forEach.call(els, function (e) {
      var sport = e.getAttribute("data-face-sport");
      if (!sport) return;
      e.setAttribute("data-face-done", "1");
      load(sport).then(function () {
        var id = find(sport, e.getAttribute("data-face-name"));
        if (!id) return;
        var size = +e.getAttribute("data-face-size") || e.clientWidth || 40;
        var src = url(sport, id, { size: size });
        if (!src) return;
        e.classList.add("has-face");
        if (isEspn(sport, id)) e.classList.add("espn");
        var old = e.querySelector("img.ds-face-img");
        if (old) old.remove();
        e.insertAdjacentHTML("beforeend", imgTag(src).replace("<img ", '<img class="ds-face-img" '));
      });
    });
  }
  // Fill in faces whenever a page draws new markup
  function watch() {
    hydrate(document);
    if (!window.MutationObserver) return;
    var pending = false;
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      (window.requestAnimationFrame || setTimeout)(function () { pending = false; hydrate(document); });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();

  window.DSFaces = { url: url, html: html, el: el, initials: initials, slug: slug, load: load, find: find, hydrate: hydrate };
})();
