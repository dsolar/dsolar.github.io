/* The Number: NFL pick'em against the spread. Everything lives in Supabase (tools/pickem_supabase.sql): the week's
   games with their frozen lines (pk_board), picks (pk_pick), standings (pk_standings) and private groups. The site's
   account (assets/account.js, loaded by navigation.js) signs people in. Signed out, picks are kept in this browser and
   saved once you sign in. */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var body = $("#pk-body"), recEl = $("#pk-rec"), bar = $("#pk-bar"), barIn = $("#pk-bar-in");
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var params = new URLSearchParams(location.search);
  var A = null, C = null, board = null, groups = [], tab = params.get("tab") || "picks", scope = "all", busy = {}, joinCode = (params.get("join") || "").toUpperCase(), joinInfo = null;
  if (joinCode) tab = "groups";
  var TEAMS = { ARI: "Cardinals", ATL: "Falcons", BAL: "Ravens", BUF: "Bills", CAR: "Panthers", CHI: "Bears", CIN: "Bengals", CLE: "Browns", DAL: "Cowboys", DEN: "Broncos", DET: "Lions", GB: "Packers", HOU: "Texans", IND: "Colts", JAX: "Jaguars", KC: "Chiefs", LAC: "Chargers", LAR: "Rams", LV: "Raiders", MIA: "Dolphins", MIN: "Vikings", NE: "Patriots", NO: "Saints", NYG: "Giants", NYJ: "Jets", PHI: "Eagles", PIT: "Steelers", SEA: "Seahawks", SF: "49ers", TB: "Buccaneers", TEN: "Titans", WSH: "Commanders" };
  var CITY = { ARI: "Arizona", ATL: "Atlanta", BAL: "Baltimore", BUF: "Buffalo", CAR: "Carolina", CHI: "Chicago", CIN: "Cincinnati", CLE: "Cleveland", DAL: "Dallas", DEN: "Denver", DET: "Detroit", GB: "Green Bay", HOU: "Houston", IND: "Indianapolis", JAX: "Jacksonville", KC: "Kansas City", LAC: "Los Angeles", LAR: "Los Angeles", LV: "Las Vegas", MIA: "Miami", MIN: "Minnesota", NE: "New England", NO: "New Orleans", NYG: "New York", NYJ: "New York", PHI: "Philadelphia", PIT: "Pittsburgh", SEA: "Seattle", SF: "San Francisco", TB: "Tampa Bay", TEN: "Tennessee", WSH: "Washington" };
  var logo = function (t) { return "https://a.espncdn.com/i/teamlogos/nfl/500/" + String(t).toLowerCase() + ".png"; };

  // a line the way the cards print it: -2½, +7, PK
  function line(x, locked) {
    if (x == null) return locked ? "Off" : "TBD";
    if (Number(x) === 0) return "PK";
    var a = Math.abs(Number(x)), whole = Math.floor(a), half = a - whole >= 0.5;
    return (x < 0 ? "−" : "+") + (whole || (half ? "" : "0")) + (half ? "½" : "");
  }
  var spreadOf = function (g) { return g.spread != null ? g.spread : g.line; };
  var sideLine = function (g, side) { var s = spreadOf(g); return s == null ? null : side === "home" ? s : -s; };
  var kick = function (iso) { return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).replace(":00", ""); };
  var when = function (iso) { return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", hour: "numeric", minute: "2-digit" }).replace(":00", "") + " ET"; };
  var weekName = function (b) { return b.stype === 3 ? ({ 1: "Wild Card", 2: "Divisional round", 3: "Conference title games", 5: "Super Bowl" }[b.week] || "Playoffs") : "Week " + b.week; };

  function toast(text, bad) {
    var old = document.querySelector(".toast"); if (old) old.remove();
    var t = document.createElement("div"); t.className = "toast" + (bad ? " bad" : ""); t.setAttribute("role", "status"); t.textContent = text;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2800);
  }

  // picks made while signed out: kept here until you sign in, then saved
  var HELD = "pk-held";
  var held = function () { try { return JSON.parse(localStorage.getItem(HELD) || "{}") || {}; } catch (e) { return {}; } };
  var hold = function (h) { try { if (Object.keys(h).length) localStorage.setItem(HELD, JSON.stringify(h)); else localStorage.removeItem(HELD); } catch (e) { /* no storage */ } };
  var signedIn = function () { return !!(A && A.me()); };

  function rpc(fn, args) {
    return (C ? Promise.resolve(C) : A.cloud().then(function (c) { C = c; return c; })).then(function (c) { return c.rpc(fn, args || {}); });
  }

  /* ---------- picks ---------- */
  function loadBoard(at) {
    var a = at ? { p_season: at.season, p_stype: at.stype, p_week: at.week } : {};
    return rpc("pk_board", a).then(function (b) {
      if (!b || b.error) throw new Error((b && b.error) || "Couldn't load the board.");
      board = b;
      // a signed-out visitor's picks show as theirs
      if (!signedIn()) { var h = held(); (b.games || []).forEach(function (g) { if (h[g.id] && !g.locked && g.spread != null) g.pick = h[g.id]; }); }
      drawRec();
    });
  }
  function drawRec() {
    var m = board && board.me;
    if (!m || !(m.w + m.l + m.p)) { recEl.hidden = true; return; }
    recEl.hidden = false;
    recEl.innerHTML = "<b>" + m.w + "-" + m.l + (m.p ? "-" + m.p : "") + "</b><small>Your season</small>";
  }
  function drawPicks() {
    var b = board;
    if (!b || !b.games || !b.games.length) {
      body.innerHTML = '<div class="week"><h2>No games yet</h2></div><p class="note">The board fills in once this week\'s NFL schedule is posted. Check back soon.</p>' + how();
      bar.hidden = true; return;
    }
    var wk = b.weeks || [], i = wk.findIndex(function (x) { return x.stype === b.stype && x.week === b.week; });
    var frozen = b.games.some(function (g) { return g.spread != null; }), fz = b.freezeAt && new Date(b.freezeAt);
    var open = b.games.filter(function (g) { return !g.locked && g.spread != null; });
    var note = !frozen && fz && fz > new Date() ? "This week's lines lock in <b>" + esc(when(b.freezeAt)) + "</b>. Picks open then. The lines below can still move."
      : open.length ? "Lines are locked for the week. Each game's pick locks at its kickoff. <b>Tap a side to pick it.</b>"
      : "Every game this week has kicked off.";
    body.innerHTML = '<div class="week"><button type="button" data-wk="-1" aria-label="Previous week"' + (i > 0 ? "" : " disabled") + ">‹</button><h2>" + esc(weekName(b)) + "</h2>"
      + '<button type="button" data-wk="1" aria-label="Next week"' + (i >= 0 && i < wk.length - 1 ? "" : " disabled") + ">›</button></div>"
      + '<p class="note">' + note + "</p>"
      + '<div class="games">' + b.games.map(game).join("") + "</div>";
    drawBar();
  }
  function game(g) {
    var live = g.locked && !g.final, top = g.final ? "Final" : live ? '<span class="live">In progress</span>' : esc(kick(g.kickoff));
    var res = g.result == null ? "" : g.result === 1 ? '<span class="stamp w">Win</span>' : g.result === 0.5 ? '<span class="stamp p">Push</span>' : '<span class="stamp l">Loss</span>';
    var split = "";
    if (g.split && (g.split.home + g.split.away) > 0) {
      var n = g.split.home + g.split.away, ap = Math.round((100 * g.split.away) / n);
      split = '<span class="split" title="How everyone picked">' + ap + "% " + esc(g.away) + ' <i><b style="width:' + ap + '%"></b></i> ' + (100 - ap) + "% " + esc(g.home) + "</span>";
    }
    var foot = res || split || (g.locked && g.spread == null ? "<span>No line was set, so it isn't graded</span>" : g.locked && !g.pick ? "<span>No pick</span>" : "");
    return '<article class="game' + (g.locked ? " locked" : "") + '" data-g="' + esc(g.id) + '"><div class="g-top"><span>' + top + '</span><span class="grow"></span><span>' + esc(g.away) + " @ " + esc(g.home) + "</span></div>"
      + side(g, "away") + side(g, "home")
      + (foot ? '<div class="g-foot">' + res + '<span class="grow"></span>' + split + (res || split ? "" : foot) + "</div>" : "") + "</article>";
  }
  function side(g, s) {
    var t = s === "home" ? g.home : g.away, sc = s === "home" ? g.homeScore : g.awayScore, ln = sideLine(g, s);
    var can = !g.locked && g.spread != null, on = g.pick === s, cov = g.cover === s;
    var label = (CITY[t] || t) + " " + (TEAMS[t] || "") + " " + (ln == null && g.locked ? "no line" : line(ln)) + (on ? ", your pick" : "") + (g.locked ? ", locked" : "");
    return '<button type="button" class="side' + (on ? " on" : "") + (cov ? " cov" : "") + '" data-pick="' + s + '"' + (can ? "" : " disabled") + ' aria-pressed="' + on + '" aria-label="' + esc(label) + '">'
      + '<img src="' + logo(t) + '" alt="" loading="lazy" width="34" height="34" onerror="this.className=\'gone\'"><span class="tm"><b>' + esc(TEAMS[t] || t) + "</b><small>" + esc(CITY[t] || "") + (s === "home" ? ", home" : "") + "</small></span>"
      + '<span class="sc">' + (g.locked && sc != null ? sc : "") + '</span><span class="box">' + esc(line(ln, g.locked)) + "</span></button>";
  }
  function drawBar() {
    var b = board; if (!b || tab !== "picks") { bar.hidden = true; return; }
    var pickable = b.games.filter(function (g) { return g.spread != null; }), made = pickable.filter(function (g) { return g.pick; }).length;
    if (!pickable.length) { bar.hidden = true; return; }
    bar.hidden = false;
    if (!signedIn()) {
      var h = Object.keys(held()).length;
      barIn.innerHTML = "<span><b>" + made + "/" + pickable.length + "</b> <small>picked</small></span><span class=\"grow\"></span>"
        + (h ? '<small style="text-align:right">Sign in to save your ' + h + " pick" + (h === 1 ? "" : "s") + '</small><button class="btn go" type="button" data-a="in">Sign in</button>' : '<small>Picks save to your account</small><button class="btn" type="button" data-a="in">Sign in</button>');
      return;
    }
    barIn.innerHTML = "<span><b>" + made + "/" + pickable.length + "</b> <small>picked</small></span><span class=\"grow\"></span><small>" + (Object.keys(busy).length ? "Saving…" : made ? "Saved. Change any pick until kickoff." : "Picks save as you tap") + "</small>";
  }
  function pick(id, s) {
    var g = board.games.find(function (x) { return x.id === id; }); if (!g || g.locked || g.spread == null) return;
    var next = g.pick === s ? null : s, was = g.pick;
    g.pick = next;
    if (!signedIn()) {
      var h = held(); if (next) h[id] = next; else delete h[id]; hold(h);
      drawPicks(); return;
    }
    busy[id] = 1; drawPicks();
    rpc("pk_pick", { p_game: id, p_side: next }).then(function (r) {
      if (!r || r.error) throw new Error((r && r.error) || "Couldn't save that pick.");
    }).catch(function (e) { g.pick = was; toast(e.message, true); }).then(function () { delete busy[id]; if (tab === "picks") drawPicks(); });
  }
  // after signing in: save the picks made while signed out (games that haven't kicked off)
  function saveHeld() {
    var h = held(), ids = Object.keys(h); if (!ids.length || !signedIn()) return Promise.resolve();
    hold({});
    return Promise.all(ids.map(function (id) { return rpc("pk_pick", { p_game: id, p_side: h[id] }).catch(function () { return null; }); }))
      .then(function (rs) { var ok = rs.filter(function (r) { return r && r.ok; }).length; if (ok) toast("Saved your " + ok + " pick" + (ok === 1 ? "" : "s") + "."); });
  }

  /* ---------- standings ---------- */
  function drawBoard() {
    bar.hidden = true;
    var segs = '<div class="seg" role="group" aria-label="Standings for"><button type="button" data-scope="all" aria-pressed="' + (scope === "all") + '">Everyone</button>'
      + groups.map(function (g) { return '<button type="button" data-scope="' + esc(g.id) + '" aria-pressed="' + (scope === g.id) + '">' + esc(g.name) + "</button>"; }).join("") + "</div>";
    body.innerHTML = segs + '<p class="note">Loading…</p>';
    var at = board || {};
    var p1 = rpc("pk_standings", { p_group: scope === "all" ? null : scope, p_season: at.season || null, p_stype: at.stype || null, p_week: at.week || null });
    var p2 = scope !== "all" && at.week ? rpc("pk_group_week", { p_group: scope, p_season: at.season, p_stype: at.stype, p_week: at.week }) : Promise.resolve(null);
    Promise.all([p1, p2]).then(function (rs) {
      var r = rs[0], gw = rs[1];
      if (!r || r.error) throw new Error((r && r.error) || "Couldn't load the standings.");
      var rows = r.rows || [], wk = at.week ? weekName(at) : "";
      var table = rows.length ? '<table class="st"><thead><tr><th class="rk">#</th><th>Player</th><th class="n">W-L-P</th>' + (wk ? '<th class="n">' + esc(wk) + "</th>" : "") + '<th class="n">Pts</th></tr></thead><tbody>'
        + rows.map(function (x, i) {
          var rank = i && Number(rows[i - 1].pts) === Number(x.pts) ? "" : i + 1;
          return '<tr class="' + (x.me ? "me" : "") + '"><td class="rk">' + rank + '</td><td class="nm">' + esc(x.name) + (x.me ? " (you)" : "") + '</td><td class="n">' + x.w + "-" + x.l + "-" + x.p + "</td>"
            + (wk ? '<td class="n">' + (x.ww + x.wl + x.wp ? x.ww + "-" + x.wl + (x.wp ? "-" + x.wp : "") : "–") + "</td>" : "") + '<td class="n">' + Number(x.pts) + "</td></tr>";
        }).join("") + "</tbody></table>"
        : '<div class="empty">' + (scope === "all" ? "No graded picks yet. The board fills in as games finish." : "Nobody in this group has a graded pick yet.") + "</div>";
      // no name yet (signed up with an emailed link): you show as Player until you add one
      var noName = rows.some(function (x) { return x.me && x.name === "Player"; }) ? '<p class="note">You show as <b>Player</b>. <a href="/account/">Add your name</a> so your friends know it\'s you.</p>' : "";
      body.innerHTML = segs + '<p class="note">' + (scope === "all" ? "Everyone with a graded pick this season." : "Your group this season.") + " A win is 1 point, a push is half.</p>" + noName + table + (gw && gw.ok ? groupGrid(gw) : "");
    }).catch(function (e) { body.innerHTML = segs + '<div class="empty">' + esc(e.message) + "</div>"; });
  }
  // a group's picks this week: everyone's once a game kicks off
  function groupGrid(gw) {
    var games = (board && board.games) || []; if (!games.length || !gw.members) return "";
    var by = {}; (gw.picks || []).forEach(function (p) { by[p.user + "|" + p.game] = p; });
    var cell = function (m, g) {
      var p = by[m.id + "|" + g.id];
      if (!p) return '<td class="faint">–</td>';
      if (!p.side) return '<td title="Picked, hidden until kickoff">✓</td>';
      var t = p.side === "home" ? g.home : g.away, cls = p.result === 1 ? "w" : p.result === 0 ? "l" : p.result === 0.5 ? "p" : "";
      return '<td class="' + cls + '">' + esc(t) + "</td>";
    };
    return '<h3 style="font:800 1.25rem var(--cond);text-transform:uppercase;margin:0 0 4px">' + esc(weekName(board)) + " picks</h3><p class=\"note\">Everyone's picks show once a game kicks off. Before that, a check means they've picked.</p>"
      + '<div class="grid-wrap"><table class="gp"><thead><tr><th>Player</th>' + games.map(function (g) { return "<th>" + esc(g.away) + "<br>@" + esc(g.home) + "</th>"; }).join("") + "</tr></thead><tbody>"
      + gw.members.map(function (m) { return "<tr><td>" + esc(m.name) + (m.me ? " (you)" : "") + "</td>" + games.map(function (g) { return cell(m, g); }).join("") + "</tr>"; }).join("") + "</tbody></table></div>";
  }

  /* ---------- groups ---------- */
  function loadGroups() {
    if (!signedIn()) { groups = []; return Promise.resolve(); }
    return rpc("pk_groups_mine").then(function (r) { groups = Array.isArray(r) ? r : []; }).catch(function () { groups = []; });
  }
  var inviteUrl = function (g) { return location.origin + location.pathname + "?join=" + encodeURIComponent(g.id); };
  function drawGroups() {
    bar.hidden = true;
    var invite = "";
    if (joinCode) {
      var mine = groups.find(function (g) { return g.id === joinCode; });
      invite = mine ? '<div class="panel"><h3>You\'re in ' + esc(mine.name) + '</h3><p>Its standings are on the Standings tab.</p><button class="btn" type="button" data-a="scope" data-id="' + esc(mine.id) + '">See the standings</button></div>'
        : joinInfo && joinInfo.ok ? '<div class="panel" style="border:2px solid var(--ink)"><h3>Join ' + esc(joinInfo.name) + "</h3><p>" + joinInfo.members + " " + (joinInfo.members === 1 ? "player" : "players") + ". You'll show up on the group's standings, and see everyone's picks once each game kicks off.</p>"
          + (signedIn() ? '<button class="btn go" type="button" data-a="join-code">Join the group</button>' : '<button class="btn go" type="button" data-a="in">Sign in to join</button>') + "</div>"
        : joinInfo ? '<div class="panel"><h3>That invite didn\'t work</h3><p>' + esc(joinInfo.error || "No group has that code.") + "</p></div>" : "";
    }
    if (!signedIn()) {
      body.innerHTML = '<div style="margin-top:18px">' + invite + '<div class="panel"><h3>Play with your friends</h3><p>Make a group, send the link, and you get your own standings and see each other\'s picks once games kick off. You also stay on the everyone board.</p><button class="btn go" type="button" data-a="in">Sign in to start a group</button></div></div>' + how();
      return;
    }
    body.innerHTML = '<div style="margin-top:18px">' + invite
      + '<div class="panel"><h3>Your groups</h3>' + (groups.length ? groups.map(function (g) {
        return '<div class="grp"><span class="grow"><b>' + esc(g.name) + "</b><small>" + g.members + " " + (g.members === 1 ? "player" : "players") + ' · code <span class="code">' + esc(g.id) + '</span></small></span><button class="btn" type="button" data-a="share" data-id="' + esc(g.id) + '">Invite</button><button class="link" type="button" data-a="leave" data-id="' + esc(g.id) + '">Leave</button></div>';
      }).join("") : "<p>You're not in a group yet. Start one, or join with a friend's code.</p>") + "</div>"
      + '<form class="panel" id="pk-new"><h3>Start a group</h3><p>Give it a name. You get a code and a link to send.</p><div class="row"><label class="sr" for="pk-gname">Group name</label><input id="pk-gname" maxlength="40" placeholder="Group name" required autocomplete="off"><button class="btn go" type="submit">Start it</button></div></form>'
      + '<form class="panel" id="pk-join"><h3>Join a group</h3><p>Type the six-letter code from the invite.</p><div class="row"><label class="sr" for="pk-code">Group code</label><input id="pk-code" maxlength="6" placeholder="ABC234" required autocomplete="off" autocapitalize="characters" spellcheck="false" style="text-transform:uppercase;letter-spacing:.14em"><button class="btn" type="submit">Join</button></div></form></div>';
  }
  function share(g) {
    var url = inviteUrl(g), text = "Join my NFL pick'em group, " + g.name + ", on The Number: picks against the spread every week.";
    if (navigator.share) { navigator.share({ title: g.name, text: text, url: url }).catch(function () { /* closed */ }); return; }
    (navigator.clipboard ? navigator.clipboard.writeText(text + " " + url) : Promise.reject()).then(function () { toast("Group ready. Invite link copied."); }, function () { prompt("Copy the invite link:", url); });
  }

  function how() {
    return '<div class="how"><h3>How it works</h3><ul><li>Every NFL game is on the card, against the spread.</li><li>The week\'s lines lock at noon Eastern the day before the first game, so everyone plays the same numbers.</li><li>Change a pick as often as you like until that game kicks off.</li><li>A win is 1 point, a push is half. The season standings add them up.</li><li>Groups get their own standings and see each other\'s picks once games start.</li></ul></div>';
  }

  /* ---------- the page ---------- */
  function draw() {
    ["picks", "board", "groups"].forEach(function (t) { var b = $('[data-tab="' + t + '"]'); b.setAttribute("aria-selected", String(t === tab)); });
    if (tab === "picks") drawPicks(); else if (tab === "board") drawBoard(); else drawGroups();
  }
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-tab]");
    if (t) { tab = t.dataset.tab; draw(); return; }
    var s = e.target.closest("[data-pick]");
    if (s && !s.disabled) { pick(s.closest("[data-g]").dataset.g, s.dataset.pick); return; }
    var w = e.target.closest("[data-wk]");
    if (w && board) {
      var wk = board.weeks || [], i = wk.findIndex(function (x) { return x.stype === board.stype && x.week === board.week; }), n = wk[i + Number(w.dataset.wk)];
      if (n) loadBoard({ season: board.season, stype: n.stype, week: n.week }).then(draw, function (err) { toast(err.message, true); });
      return;
    }
    var sc = e.target.closest("[data-scope]");
    if (sc) { scope = sc.dataset.scope; drawBoard(); return; }
    var a = e.target.closest("[data-a]"); if (!a) return;
    var act = a.dataset.a;
    if (act === "in") A.openSignIn("signin");
    else if (act === "share") share(groups.find(function (g) { return g.id === a.dataset.id; }));
    else if (act === "scope") { scope = a.dataset.id; tab = "board"; draw(); }
    else if (act === "leave") {
      var g = groups.find(function (x) { return x.id === a.dataset.id; });
      if (!g || !confirm("Leave " + g.name + "? Your picks stay on the everyone board.")) return;
      rpc("pk_group_leave", { p_code: g.id }).then(loadGroups).then(function () { if (scope === g.id) scope = "all"; toast("You left " + g.name + "."); drawGroups(); }, function (err) { toast(err.message, true); });
    } else if (act === "join-code") joinWith(joinCode);
  });
  function joinWith(code) {
    return rpc("pk_group_join", { p_code: code }).then(function (r) {
      if (!r || r.error) throw new Error((r && r.error) || "Couldn't join that group.");
      toast("You're in " + r.name + ".");
      if (joinCode) { joinCode = ""; history.replaceState(null, "", location.pathname); }
      return loadGroups().then(function () { scope = r.id; tab = "board"; draw(); });
    }).catch(function (err) { toast(err.message, true); });
  }
  document.addEventListener("submit", function (e) {
    e.preventDefault();
    if (e.target.id === "pk-new") {
      var name = $("#pk-gname").value.trim(); if (!name) return;
      rpc("pk_group_create", { p_name: name }).then(function (r) {
        if (!r || r.error) throw new Error((r && r.error) || "Couldn't start that group.");
        return loadGroups().then(function () { drawGroups(); var g = groups.find(function (x) { return x.id === r.id; }); if (g) share(g); else toast("Started " + r.name + "."); });
      }).catch(function (err) { toast(err.message, true); });
    } else if (e.target.id === "pk-join") {
      var code = $("#pk-code").value.trim().toUpperCase(); if (code.length < 6) { toast("Codes are six letters and numbers.", true); return; }
      joinWith(code);
    }
  });

  function start() {
    var first = joinCode ? rpc("pk_group_peek", { p_code: joinCode }).then(function (r) { joinInfo = r; }).catch(function (e) { joinInfo = { error: e.message }; }) : Promise.resolve();
    return saveHeld().then(function () { return Promise.all([loadBoard(), loadGroups(), first]); }).then(draw).catch(function (e) {
      body.innerHTML = '<div class="empty" style="margin-top:18px">' + esc(e.message) + ' <button class="link" type="button" onclick="location.reload()">Try again</button></div>';
    });
  }
  // signed in from an emailed link on this page: save held picks and reload everything
  window.addEventListener("dsolar:auth", function () { C = null; start(); });
  // the site's account script comes with the navigation
  (function wait(n) {
    A = window.DSAccount;
    if (!A) { if (n < 200) setTimeout(function () { wait(n + 1); }, 50); else body.innerHTML = '<div class="empty" style="margin-top:18px">The page didn\'t finish loading. Reload it.</div>'; return; }
    start();
  })(0);
})();
