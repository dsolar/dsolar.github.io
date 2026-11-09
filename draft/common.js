/* Shared by the Big Board and the mock draft: loading a league, logos, stat lines, little formatters. */
(function () {
  "use strict";
  const cache = {};
  const BB = {
    $: (s) => document.querySelector(s),
    esc: (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    fmtDay: (d) => d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "",
    async data(lg) {
      if (!cache[lg]) {
        const r = await fetch(`${lg}.json`, { cache: "no-cache" });
        if (!r.ok) throw new Error(r.status);
        cache[lg] = await r.json();
        (cache[lg].players || []).forEach((p) => { p.lg = lg; }); // for faces: college basketball or football
      }
      return cache[lg];
    },
    team(D, abbr) { return (D.teams || {})[abbr] || { city: abbr, name: "", c: ["#33415A", "#ECEFE9"] }; },
    // Team logos from ESPN's CDN, with the abbreviation in team colors if one fails.
    // Light-background logos by default; pass dark for a logo sitting on the team's own color.
    logo(D, abbr, size = 40, cls = "tl", dark = false) {
      const t = BB.team(D, abbr);
      if (!t.espn) return BB.badge(D, abbr, cls);
      const src = `https://a.espncdn.com/combiner/i?img=/i/teamlogos/${D.league}/${dark ? "500-dark" : "500"}/${t.espn}.png&w=${size * 2}&h=${size * 2}`;
      return `<img class="${cls}" src="${src}" alt="" width="${size}" height="${size}" loading="lazy" data-badge="${BB.esc(abbr)}" data-lg="${D.league}">`;
    },
    badge(D, abbr, cls = "tl") {
      const t = BB.team(D, abbr);
      return `<span class="${cls} badge" style="background:${t.c[0]};color:${BB.light(t.c[1]) ? t.c[1] : "#fff"}">${BB.esc(abbr)}</span>`;
    },
    light(hex) {
      const n = parseInt(String(hex || "#000").slice(1), 16);
      return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 90;
    },
    // School logos sit on a light chip, since plenty of them are navy or black.
    school(p, size = 26) {
      if (p.sid) return `<span class="chip"><img src="https://a.espncdn.com/combiner/i?img=/i/teamlogos/ncaa/500/${p.sid}.png&w=${size * 2}&h=${size * 2}" alt="" width="${size}" height="${size}" loading="lazy" data-chip="${BB.esc(BB.initials(p.school))}"></span>`;
      return `<span class="chip txt" title="${BB.esc(p.flag || p.school || "")}">${BB.esc(BB.initials(p.flag || p.school))}</span>`;
    },
    // A prospect's face (his college photo from ESPN, via assets/faces.js) with his school's logo as a badge.
    // Without faces.js, just the school chip.
    who(p, size = 34) {
      if (!window.DSFaces || !p) return BB.school(p, size - 4);
      const face = window.DSFaces.html({ sport: p.lg === "nfl" ? "ncaaf" : "ncaab", name: p.n, size, color: "#33415A" });
      return `<span class="who-av" style="--sz:${size}px">${face}${BB.school(p, 16)}</span>`;
    },
    initials(s) {
      const w = String(s || "").replace(/[()]/g, "").split(/\s+/).filter(Boolean);
      return (w.length > 1 ? w.slice(0, 2).map((x) => x[0]).join("") : (w[0] || "?").slice(0, 3)).toUpperCase();
    },
    // A short stat line: the first three stats as they come (Tankathon orders them by what matters for the spot).
    statLine(p, n = 3) {
      if (!p.stats || !p.stats.length) return "";
      return p.stats.slice(0, n).map(([lab, v]) => `${BB.num(v)} ${BB.label(lab)}`).join(" &middot; ");
    },
    label(l) {
      return String(l).replace(/^REC YDS$/i, "YDS").replace(/^RUSH YDS$/i, "RU YDS").replace(/^PASS YDS$/i, "YDS").replace(/^TACKLES$/i, "TKL").replace(/^PASS DEF$/i, "PD").toUpperCase();
    },
    num(v) { const x = Number(v); return Number.isFinite(x) && Math.abs(x) >= 1000 ? x.toLocaleString("en-US") : BB.esc(v); },
    // Every filter a listed position belongs to. Hybrids count for each half: an SG/SF shows under SG and SF,
    // a G under PG and SG, an OT/IOL under OT and IOL.
    groups(lg, pos) {
      const parts = String(pos || "").toUpperCase().split(/[\/-]/).filter(Boolean);
      const map = lg === "nba"
        ? { G: ["PG", "SG"], F: ["SF", "PF"], W: ["SG", "SF"] }
        : { OL: ["OT", "IOL"], OG: ["IOL"], G: ["IOL"], C: ["IOL"], IDL: ["DL"], DT: ["DL"], DE: ["EDGE"], NB: ["CB"], DB: ["CB", "S"], FS: ["S"], SS: ["S"], ILB: ["LB"], OLB: ["LB"] };
      return new Set(parts.flatMap((x) => map[x] || [x]));
    },
    inGroup(lg, pos, key) { return key === "all" || BB.groups(lg, pos).has(key); },
    POS: {
      nba: [["all", "All"], ["PG", "PG"], ["SG", "SG"], ["SF", "SF"], ["PF", "PF"], ["C", "C"]],
      nfl: [["all", "All"], ["QB", "QB"], ["RB", "RB"], ["WR", "WR"], ["TE", "TE"], ["OT", "OT"], ["IOL", "IOL"], ["DL", "DL"], ["EDGE", "EDGE"], ["LB", "LB"], ["CB", "CB"], ["S", "S"]]
    },
    store: {
      get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
      set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private window */ } }
    }
  };
  // A logo that won't load gives way to a lettered badge.
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (img.tagName !== "IMG") return;
    if (img.dataset.badge) {
      const D = cache[img.dataset.lg];
      img.outerHTML = D ? BB.badge(D, img.dataset.badge, img.className) : `<span class="${img.className} badge">${BB.esc(img.dataset.badge)}</span>`;
    } else if (img.dataset.chip) {
      img.parentNode.classList.add("txt");
      img.outerHTML = BB.esc(img.dataset.chip);
    }
  }, true);
  window.BB = BB;
})();
