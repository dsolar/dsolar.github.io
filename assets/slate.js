/* Today's slate: the hand-turned scoreboard in the home page hero.
   One row per daily game, one plate per daily challenge, read from what each game saves on this device:
     Make the Call    mtc.v2.daily.YYYY-MM-DD and mtc.v2.speed.YYYY-MM-DD (this device's date, like the game)
     Guess the Pick   gtp-daily5-SPORT-YYYY-MM-DD (Boston date)
     Journeyman       jm-daily3-SPORT-YYYY-MM-DD (Boston date)
     Scouting Report  sr-daily-YYYY-MM-DD (Boston date)
   Nothing leaves the device. If a game changes its save format, update the matching row below. */
(function () {
  var board = document.getElementById("slate");
  if (!board) return;
  var TZ = "America/New_York";

  function read(key) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function bostonDate() { return new Date().toLocaleDateString("en-CA", { timeZone: TZ }); }
  function localDate() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  // A daily of ten questions (Guess the Pick, Journeyman) or five (Scouting Report): done, in progress, or not started
  function tenDaily(key, n) {
    n = n || 10;
    var d = read(key), res = d && Array.isArray(d.results) ? d.results : [];
    if (!res.length) return { state: "open" };
    var total = res.reduce(function (a, r) { return a + (+r.s || 0); }, 0);
    if (res.length >= n) return { state: "done", text: String(total), say: total + " of " + n * 5, share: total + "/" + n * 5 };
    return { state: "partial", text: res.length + "/" + n, say: res.length + " of " + n + " played" };
  }

  function rows() {
    var et = bostonDate(), local = localDate();
    var daily = read("mtc.v2.daily." + local), speed = read("mtc.v2.speed." + local);
    return [
      { name: "Make the Call", line: "4th downs, graded", url: "win-probability/", cells: [
        { label: "Daily", url: "win-probability/", s: daily && daily.grade ? { state: "done", text: daily.grade, say: "grade " + daily.grade } : { state: "open" } },
        { label: "Speed", url: "win-probability/", s: speed && speed.speed ? { state: "done", text: String(speed.speed.score), say: speed.speed.score + " of 1000" } : { state: "open" } },
        null
      ] },
      { name: "Guess the Pick", line: "Name the draft pick", url: "guess-the-pick/", cells: ["nba", "nfl"].map(function (sp) {
        return { label: sp.toUpperCase(), url: "guess-the-pick/?sport=" + sp, s: tenDaily("gtp-daily5-" + sp + "-" + et) };
      }).concat([null]) },
      { name: "Journeyman", line: "Name him by his teams", url: "journeyman/", cells: ["nba", "nfl", "mlb"].map(function (sp) {
        return { label: sp.toUpperCase(), url: "journeyman/?sport=" + sp, s: tenDaily("jm-daily3-" + sp + "-" + et) };
      }) },
      { name: "Scouting Report", line: "Takes that aged badly", url: "scouting-report/", cells: [
        { label: "Daily", url: "scouting-report/", s: tenDaily("sr-daily-" + et, 5) }, null, null
      ] }
    ];
  }

  function untilMidnight() {
    var now = new Date();
    var et = new Date(now.toLocaleString("en-US", { timeZone: TZ }));
    var next = new Date(et); next.setHours(24, 0, 0, 0);
    var mins = Math.max(1, Math.ceil((next - et) / 60000));
    var h = Math.floor(mins / 60), m = mins % 60;
    return h ? h + "h " + String(m).padStart(2, "0") + "m" : m + "m";
  }

  function render() {
    var list = rows(), done = 0, total = 0, shareLines = [];
    var dateLabel = new Date().toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "numeric", day: "numeric" })
      .replace(",", "").replace("/", "·").toUpperCase();
    var html = list.map(function (r) {
      var played = r.cells.filter(function (c) { return c && c.s.state === "done"; })
        .map(function (c) { return c.label + " " + (c.s.share || c.s.text); });
      if (played.length) shareLines.push(r.name + ": " + played.join(" · "));
      var cells = r.cells.map(function (c) {
        if (!c) return '<span class="slate-cell slate-blank" aria-hidden="true"><span class="slate-plate"></span><span class="slate-lab">&nbsp;</span></span>';
        total++;
        if (c.s.state === "done") done++;
        var text = c.s.state === "open" ? "Play" : c.s.text;
        var say = r.name + ", " + c.label + ": " + (c.s.state === "open" ? "not played yet" : c.s.say);
        return '<a class="slate-cell is-' + c.s.state + '" href="' + esc(c.url) + '" aria-label="' + esc(say) + '">'
          + '<span class="slate-plate">' + esc(text) + '</span><span class="slate-lab">' + esc(c.label) + "</span></a>";
      }).join("");
      return '<li class="slate-row"><a class="slate-name" href="' + esc(r.url) + '">' + esc(r.name) + (r.line ? "<small>" + esc(r.line) + "</small>" : "") + "</a>" + cells + "</li>";
    }).join("");

    var lights = "";
    for (var i = 0; i < total; i++) lights += '<i class="' + (i < done ? "on" : "") + '"></i>';
    var note = done === 0 ? "Nothing played yet today."
      : done === total ? "Full slate. Go outside."
      : done + " of " + total + " done today.";

    board.querySelector(".slate-date").textContent = dateLabel;
    board.querySelector(".slate-rows").innerHTML = html;
    board.querySelector(".slate-lights").innerHTML = lights;
    board.querySelector(".slate-lights").setAttribute("aria-label", done + " of " + total + " daily challenges done");
    board.querySelector(".slate-note").textContent = note;
    board.querySelector(".slate-reset").textContent = "New slate in " + untilMidnight();
    // Share: a plain-text recap of what's done today, for the group chat
    shareText = shareLines.length ? ["Today's slate, " + new Date().toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "numeric", day: "numeric" })]
      .concat(shareLines, [done + " of " + total + " done. Beat me: https://davidsolar.dev"]).join("\n") : "";
    if (shareBtn) shareBtn.hidden = !shareText;
  }

  var shareText = "", shareBtn = board.querySelector(".slate-share");
  if (shareBtn) shareBtn.addEventListener("click", function () {
    if (!shareText) return;
    var noteEl = board.querySelector(".slate-note");
    var said = function (msg) { noteEl.textContent = msg; };
    if (navigator.share) {
      navigator.share({ text: shareText }).catch(function (e) { if (e && e.name !== "AbortError") copy(); });
    } else copy();
    function copy() {
      var fallback = function () {
        var t = document.createElement("textarea"); t.value = shareText; t.setAttribute("readonly", "");
        t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select();
        var ok = false; try { ok = document.execCommand("copy"); } catch (e) {}
        document.body.removeChild(t);
        said(ok ? "Copied. Paste it in the group chat." : "Couldn't copy on this browser.");
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareText).then(function () { said("Copied. Paste it in the group chat."); }, fallback);
      } else fallback();
    }
  });

  render();
  setInterval(render, 30000);
  // Coming back from a game in another tab: show the new score right away
  document.addEventListener("visibilitychange", function () { if (!document.hidden) render(); });
  window.addEventListener("storage", render);
})();
