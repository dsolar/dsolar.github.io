/* Player faces, shared by every page on the site.
 *
 *   <link rel="stylesheet" href="/assets/faces.css">
 *   <script src="/assets/faces.js"></script>
 *
 *   DSFaces.html({ sport: "mlb", id: 660271, name: "Shohei Ohtani", color: "#005A9C", size: 32 })
 *   DSFaces.url("nba", 1628369)          -> the photo address, or "" when there's no id
 *
 * sport + id, by league:
 *   mlb   MLBAM id (MLB Stats API, FanGraphs xMLBAMID)      photos from MLB (minor leaguers too, with milb: true)
 *   nba   NBA.com person id (nba_api, stats.nba.com)        photos from NBA.com
 *   nfl   ESPN athlete id (nflverse espn_id)                photos from ESPN
 *   ncaaf / ncaab   ESPN athlete id                         college photos from ESPN (the draft Big Board)
 *   espn  { league: "nba" | "nfl" | "mlb", id }             any ESPN athlete id, when that's the only id a page has
 *
 * Every face falls back to the player's initials on his team color when there's no id or the photo won't load,
 * so a missing photo never shows a broken image. Photos load lazily and are linked, not copied: they stay on the
 * leagues' own servers. Set hide: true to draw only the initials (guessing games, before the answer is shown).
 */
(function () {
  var ESPN = "https://a.espncdn.com/combiner/i?img=/i/headshots/";
  var ESPN_PATH = { nfl: "nfl", nba: "nba", mlb: "mlb", ncaaf: "college-football", ncaab: "mens-college-basketball" };

  function url(sport, id, opts) {
    opts = opts || {};
    if (id == null || id === "" || id === 0) return "";
    var px = Math.max(48, Math.round((opts.size || 40) * 2));
    switch (sport) {
      case "mlb":
        return "https://img.mlbstatic.com/mlb-photos/image/upload/w_" + px +
          ",q_auto:best/v1/people/" + id + "/headshot/" + (opts.milb ? "milb" : "67") + "/current";
      case "nba":
        return "https://cdn.nba.com/headshots/nba/latest/260x190/" + id + ".png";
      case "nfl": case "ncaaf": case "ncaab":
        return ESPN + ESPN_PATH[sport] + "/players/full/" + id + ".png&w=" + px + "&h=" + Math.round(px * 0.73) + "&scale=crop";
      case "espn":
        return ESPN + (ESPN_PATH[opts.league] || opts.league) + "/players/full/" + id + ".png&w=" + px + "&h=" + Math.round(px * 0.73) + "&scale=crop";
    }
    return "";
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

  // o: { sport, id, name, color, size, milb, league, hide, cls, title }
  function html(o) {
    o = o || {};
    var size = o.size || 32, color = o.color || "#33415c";
    var src = o.hide ? "" : url(o.sport, o.id, o);
    var style = "--face-size:" + size + "px;--face-bg:" + color + ";--face-ink:" + ink(color);
    var label = esc(o.title || o.name || "");
    var img = src ? '<img src="' + esc(src) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">' : "";
    return '<span class="ds-face' + (o.cls ? " " + esc(o.cls) : "") + '" style="' + style + '"' +
      (label ? ' title="' + label + '"' : "") + ' aria-hidden="true"><span class="ds-face-ini">' +
      esc(initials(o.name)) + "</span>" + img + "</span>";
  }

  // Same thing as a DOM node, for pages that build elements instead of strings
  function el(o) {
    var t = document.createElement("template");
    t.innerHTML = html(o);
    return t.content.firstChild;
  }

  window.DSFaces = { url: url, html: html, el: el, initials: initials };
})();
