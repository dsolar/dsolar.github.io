// The teams you follow, shared by every hub. Saved as ds-fav:<sport> (a list of team ids), which assets/account.js
// syncs to your account when you're signed in, so your teams come back on every device and after the browser clears
// its storage. A star anywhere on the site is <button data-follow="<sport>:<id>" data-name="Boston College">; this
// file handles the click, saves, and tells the page (the "ds-follow" event) so it can redraw.
(function () {
  if (window.Follow) return;
  var KEY = function (sport) { return "ds-fav:" + sport; };
  // the college hubs kept their own lists before this
  var OLD = { ncaab: "ds-cbb:favorites", ncaaf: "ds-cfb:favorites" };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  function read(sport) {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(KEY(sport))); } catch (e) { v = null; }
    if (Array.isArray(v)) return v.map(String);
    var old = null;
    try { old = OLD[sport] && JSON.parse(localStorage.getItem(OLD[sport])); } catch (e) { old = null; }
    if (Array.isArray(old) && old.length) { write(sport, old.map(String)); return old.map(String); }
    return [];
  }
  function write(sport, ids) { try { localStorage.setItem(KEY(sport), JSON.stringify(ids)); } catch (e) { /* private mode */ } }
  function has(sport, id) { return read(sport).indexOf(String(id)) >= 0; }
  function fire(sport) { window.dispatchEvent(new CustomEvent("ds-follow", { detail: { sport: sport } })); }
  var nudged = false;
  function toggle(sport, id, name) {
    var ids = read(sport), k = ids.indexOf(String(id)), on = k < 0;
    if (on) ids.push(String(id)); else ids.splice(k, 1);
    write(sport, ids);
    fire(sport);
    var A = window.DSAccount;
    if (on && A && A.toast) {
      if (!A.me() && !nudged) { nudged = true; A.toast("Following " + (name || "this team") + ". Sign in to keep your teams on all your devices.", { label: "Sign in", run: function () { A.openSignIn(); } }); }
      else A.toast("Following " + (name || "this team") + ".");
    }
    return on;
  }
  // the star: pass the sport, the team id and its name
  function star(sport, id, name, cls) {
    var on = has(sport, id);
    return '<button type="button" class="ds-follow' + (on ? " on" : "") + (cls ? " " + cls : "") + '" data-follow="' + esc(sport + ":" + id) + '" data-name="' + esc(name || "") + '" aria-pressed="' + on + '" title="' + (on ? "Following. Tap to stop" : "Follow this team") + '">' +
      '<span aria-hidden="true">' + (on ? "★" : "☆") + "</span><span>" + (on ? "Following" : "Follow") + "</span></button>";
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-follow]");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var v = b.getAttribute("data-follow"), i = v.indexOf(":");
    var on = toggle(v.slice(0, i), v.slice(i + 1), b.getAttribute("data-name"));
    // redraw every star for this team right away, even if the page doesn't redraw
    document.querySelectorAll('[data-follow="' + v.replace(/"/g, '\\"') + '"]').forEach(function (x) {
      x.classList.toggle("on", on); x.setAttribute("aria-pressed", on); x.title = on ? "Following. Tap to stop" : "Follow this team";
      // the full button says Following; a bare star (a hub's own compact one) just fills in
      x.innerHTML = x.classList.contains("ds-follow") ? '<span aria-hidden="true">' + (on ? "★" : "☆") + "</span><span>" + (on ? "Following" : "Follow") + "</span>" : (on ? "★" : "☆");
    });
  }, true);
  // your teams arriving from another device
  window.addEventListener("dsolar:sync", function (e) {
    var keys = (e.detail && e.detail.keys) || [];
    keys.forEach(function (k) { if (k.indexOf("ds-fav:") === 0) fire(k.slice(7)); });
  });
  if (!document.getElementById("ds-follow-css")) {
    var st = document.createElement("style"); st.id = "ds-follow-css";
    st.textContent = ".ds-follow{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line,#d5d9e0);background:transparent;color:inherit;border-radius:999px;padding:4px 11px 4px 9px;font:600 13px/1.2 var(--f,inherit);cursor:pointer;white-space:nowrap}" +
      ".ds-follow span:first-child{font-size:15px;line-height:1;color:var(--muted,#6b7280)}.ds-follow.on{border-color:#d4a514;background:rgba(212,165,20,.1)}.ds-follow.on span:first-child{color:#d4a514}" +
      ".ds-follow:hover{border-color:#d4a514}.ds-follow:focus-visible{outline:2px solid #d4a514;outline-offset:2px}" +
      ".ds-yours{display:flex;gap:8px;overflow-x:auto;margin:0 0 14px;padding:2px 0;scrollbar-width:none}.ds-yours::-webkit-scrollbar{display:none}" +
      ".ds-yours a{display:flex;align-items:center;gap:8px;flex:0 0 auto;border:1px solid var(--line,#d5d9e0);border-radius:10px;padding:6px 12px 6px 7px;background:var(--card,#fff);color:inherit;text-decoration:none;font-size:13px;line-height:1.25}" +
      ".ds-yours a:hover{border-color:#d4a514}.ds-yours b{display:block;font-size:14px}.ds-yours small{color:var(--muted,#6b7280)}.ds-yours img{width:28px;height:28px;object-fit:contain}" +
      ".ds-yours a.ds-all{border-style:dashed}.ds-yours .lbl{align-self:center;flex:0 0 auto;font-size:13px;font-weight:700;color:var(--muted,#6b7280);padding-right:2px}";
    document.head.appendChild(st);
  }
  // a row of your teams for the top of a hub page: items [{id, href, logo (markup), name, sub}]
  function strip(sport, items) {
    var ids = read(sport); if (!ids.length) return "";
    var by = {}; items.forEach(function (x) { by[String(x.id)] = x; });
    var mine = ids.map(function (id) { return by[id]; }).filter(Boolean);
    if (!mine.length) return "";
    return '<nav class="ds-yours" aria-label="Your teams"><span class="lbl">Your teams</span>' + mine.map(function (x) {
      return '<a href="' + esc(x.href) + '">' + (x.logo || "") + "<span><b>" + esc(x.name) + "</b>" + (x.sub ? "<small>" + x.sub + "</small>" : "") + "</span></a>";
    }).join("") + '<a class="ds-all" href="/my-teams/"><span><b>All my teams</b><small>Every sport, one page</small></span></a></nav>';
  }
  window.Follow = { list: read, has: has, toggle: toggle, star: star, strip: strip };
})();
