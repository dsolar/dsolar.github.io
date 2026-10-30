/* Who's winning today: the leader of each daily game's group board, on the home page under the hero.
   Reads the same Supabase boards the games post to (tools/*_supabase.sql), Boston date:
     Make the Call    wp_speed_leaderboard(date)          speed round, out of 1000
     Guess the Pick   gtp_board5(sport, from, to)         NBA and NFL dailies, out of 50
     Journeyman       jm_board(sport, from, to)           NBA, NFL and MLB dailies, out of 50
     Scouting Report  sr_board(day)                       the daily five, out of 25
   A board nobody has posted to today shows yesterday's winner instead. Each card also crowns the week's champ:
   the most points across that game's boards since Monday (Boston), matched by name. If every call fails, the strip stays hidden. */
(function () {
  var box = document.getElementById("leaders");
  if (!box) return;
  var URL = "https://baxrczyufqbzrogftmyn.supabase.co/rest/v1/rpc/";
  var KEY = "sb_publishable_brDXGevzcoI7mBaPO7Plow_yaUy4gk4";
  var TZ = "America/New_York";

  function rpc(fn, body) {
    var headers = { apikey: KEY, "Content-Type": "application/json" };
    var call = function (h) { return fetch(URL + fn, { method: "POST", headers: h, body: JSON.stringify(body) }); };
    return call(headers).then(function (res) {
      return res.status === 401 ? call(Object.assign({ Authorization: "Bearer " + KEY }, headers)) : res;
    }).then(function (res) {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    });
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function bostonDate(offsetDays) {
    return new Date(Date.now() - (offsetDays || 0) * 864e5).toLocaleDateString("en-CA", { timeZone: TZ });
  }
  var today = bostonDate(0), yesterday = bostonDate(1);
  // Monday of this week, and every day from there (or from yesterday, if that's earlier) through today
  var monday = (function () { var d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); })();
  var from = monday < yesterday ? monday : yesterday;
  var days = (function () { var out = [], d = new Date(from + "T12:00:00Z"); while (d.toISOString().slice(0, 10) <= today) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); } return out; })();

  // Rows -> { day: { top: {name, score}, n } }, one post per player per day, best score first (earliest post breaks ties)
  function summarize(rows, pick) {
    var days = {};
    (rows || []).forEach(function (r) {
      var x = pick(r);
      if (!x || !x.name) return;
      var d = days[x.day] || (days[x.day] = { seen: {}, list: [] });
      var who = x.who || x.name;
      if (d.seen[who]) { d.list[d.seen[who] - 1] = x; return; }  // a later post from the same device replaces the earlier one
      d.list.push(x); d.seen[who] = d.list.length;
    });
    var out = {};
    Object.keys(days).forEach(function (day) {
      var list = days[day].list.slice().sort(function (a, b) { return (b.score - a.score) || (a.at < b.at ? -1 : 1); });
      out[day] = { top: list[0], n: list.length, list: list };
    });
    return out;
  }

  function sportBoard(fn, sport) {
    return rpc(fn, { p_sport: sport, p_from: from, p_to: today }).then(function (rows) {
      return summarize(rows, function (r) { return { day: r.day, name: r.player, who: r.device, score: +r.score || 0, at: r.created_at }; });
    });
  }
  function dayBoard(fn, args, pick) {
    return Promise.all(days.map(function (day) {
      return rpc(fn, args(day)).then(function (rows) {
        return summarize(rows, function (r) { var x = pick(r); x.day = day; return x; });
      });
    })).then(function (all) { return Object.assign.apply(null, [{}].concat(all)); });
  }

  var games = [
    { name: "Make the Call", url: "win-probability/", of: 1000, boards: [
      { label: "Speed", load: function () { return dayBoard("wp_speed_leaderboard", function (d) { return { p_challenge_date: d }; },
        function (r) { return { name: r.nickname, score: +r.score || 0, at: r.submitted_at }; }); } }
    ] },
    { name: "Guess the Pick", url: "guess-the-pick/", of: 50, boards: ["nba", "nfl"].map(function (sp) {
      return { label: sp.toUpperCase(), url: "guess-the-pick/?sport=" + sp, load: function () { return sportBoard("gtp_board5", sp); } };
    }) },
    { name: "Journeyman", url: "journeyman/", of: 50, boards: ["nba", "nfl", "mlb"].map(function (sp) {
      return { label: sp.toUpperCase(), url: "journeyman/?sport=" + sp, load: function () { return sportBoard("jm_board", sp); } };
    }) },
    { name: "Scouting Report", url: "scouting-report/", of: 25, boards: [
      { label: "Daily", load: function () { return dayBoard("sr_board", function (d) { return { p_day: d }; },
        function (r) { return { name: r.player, score: +r.score || 0, at: r.created_at }; }); } }
    ] }
  ];

  // The week's champ for one game: points summed over its boards and days since Monday, by name
  function champ(g) {
    var tot = {};
    g.boards.forEach(function (b) {
      if (b.failed) return;
      Object.keys(b.data).forEach(function (day) {
        if (day < monday) return;
        b.data[day].list.forEach(function (x) {
          var k = String(x.name).trim().toLowerCase();
          var t = tot[k] || (tot[k] = { name: x.name, pts: 0, days: {} });
          t.pts += x.score; t.days[day] = 1;
        });
      });
    });
    var best = Object.keys(tot).map(function (k) { return tot[k]; })
      .sort(function (a, b) { return (b.pts - a.pts) || (Object.keys(b.days).length - Object.keys(a.days).length); })[0];
    if (!best) return '<p class="ld-week is-empty">Week champ: nobody yet</p>';
    var nd = Object.keys(best.days).length;
    return '<p class="ld-week"><span aria-hidden="true">\uD83C\uDFC6</span> Week champ: <b>' + esc(best.name) + "</b> "
      + '<span class="ld-week-pts">' + esc(best.pts.toLocaleString("en-US")) + " pts" + (nd > 1 ? ", " + nd + " days" : "") + "</span></p>";
  }

  var jobs = [];
  games.forEach(function (g) { g.boards.forEach(function (b) { jobs.push(b.load().then(function (s) { b.data = s; }, function () { b.failed = true; })); }); });

  Promise.all(jobs).then(function () {
    var ok = 0, postedToday = 0;
    var cards = games.map(function (g) {
      var lines = g.boards.map(function (b) {
        if (b.failed) return "";
        ok++;
        var t = b.data[today], y = b.data[yesterday];
        var label = '<span class="ld-lab">' + esc(b.label) + "</span>";
        var href = esc(b.url || g.url);
        if (t) {
          postedToday += t.n;
          return '<li><a href="' + href + '">' + label + '<b class="ld-name">' + esc(t.top.name) + "</b>"
            + '<span class="ld-score">' + esc(t.top.score) + "<small>/" + g.of + "</small></span>"
            + (t.n > 1 ? '<span class="ld-more">' + t.n + " played</span>" : "") + "</a></li>";
        }
        if (y) {
          return '<li class="is-y"><a href="' + href + '">' + label + '<span class="ld-name ld-open">Yesterday: <b>' + esc(y.top.name) + "</b>, " + esc(y.top.score) + "</span></a></li>";
        }
        return '<li class="is-open"><a href="' + href + '">' + label + '<span class="ld-name ld-open">Up for grabs</span></a></li>';
      }).join("");
      if (!lines) return "";
      return '<div class="ld-card"><a class="ld-game" href="' + esc(g.url) + '">' + esc(g.name) + "</a><ul>" + lines + "</ul>" + champ(g) + "</div>";
    }).join("");
    if (!ok) return;  // Supabase unreachable: leave the strip out
    box.querySelector(".ld-grid").innerHTML = cards;
    box.querySelector(".ld-note").textContent = postedToday
      ? postedToday + (postedToday === 1 ? " score" : " scores") + " posted today. Post yours from the end of any daily."
      : "Nothing posted yet today. First one on the board sets the bar.";
    box.hidden = false;
  });
})();
