/**
 * Keeper sheet bridge for Don't Forget to Wipe Yoenis (davidsolar.dev/yoenis/).
 *
 * Lets the page read and write the "Fantasy Keepers" Google Sheet directly:
 *   - each team declares its keepers on the page, and they land in that year's tab ("2027"), in the same
 *     two-blocks-of-eight layout as every past year: "Player (round/keeper year)"
 *   - each team marks the draft dates it can make, and the marks land in "<year> Draft Vote" as 1s and 0s
 *     (the first vote creates that tab from the page's ballot if it isn't there yet)
 * The sheet stays the official record: anything you change by hand shows up on the page too.
 *
 *   GET  ?y=2027  -> {"keepers": {"<team>": [["Aaron Judge", 1, 3, false], ...]},
 *                     "vote": {"dates": [{"id": "2027-03-20", "label": "Saturday, March 20"}], "marks": {"<team>": {"2027-03-20": 1}}},
 *                     "lock": "<ISO time or empty>"}
 *   POST (text/plain JSON) {"action": "keepers", "y": 2027, "team": "Bulba", "pin": "4821",
 *                            "players": [["Aaron Judge", 1, 3]], "order": ["<16 team names in column order>"]}
 *   POST {"action": "vote", "y": 2027, "team": "Bulba", "pin": "4821", "date": "2027-03-20", "yes": true,
 *         "ballot": ["2027-03-14", ...]}   (the ballot only matters for the first vote, which creates the tab)
 * Every POST answers with the same shape as GET, or {"error": "..."}.
 *
 * A team's first save sets its PIN (4 to 8 digits); every change after that needs it. PINs are kept only as
 * salted hashes in Script Properties. To reset a forgotten one, delete that team's "pin:<team>" property.
 * To lock keepers, add a Script Property LOCK with an ISO time, e.g. 2027-03-14T23:59:00-04:00.
 *
 * Setup (once):
 *   1. Open the Fantasy Keepers sheet > Extensions > Apps Script.
 *   2. Replace the code with this file and save.
 *   3. Deploy > New deployment > type Web app. Execute as: Me. Who has access: Anyone. Deploy, and allow access.
 *   4. Copy the web app URL (it ends in /exec) into yoenis/data.json as offseason.sheet_url.
 * After editing this code later, use Deploy > Manage deployments > edit > New version, so the URL stays the same.
 */

var MAX_KEEPERS = 5;

function doGet(e) {
  var y = parseInt((e && e.parameter && e.parameter.y) || "2027", 10);
  return json(view(y));
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json({ error: "Send JSON" }); }
  var y = parseInt(body.y || 2027, 10), team = clean(body.team, 60), pin = String(body.pin == null ? "" : body.pin);
  if (!team) return json({ error: "Which team?" });
  if (!/^\d{4,8}$/.test(pin)) return json({ error: "The PIN is 4 to 8 digits." });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var props = PropertiesService.getScriptProperties(), key = "pin:" + team, hash = sha(team + "|" + pin);
    var have = props.getProperty(key);
    if (have && have !== hash) return json({ error: "That's not this team's PIN. Ask the commissioner to reset it." });

    if (body.action === "keepers") {
      var until = props.getProperty("LOCK");
      if (until && new Date() > new Date(until)) return json({ error: "Keepers are locked." });
      var players = (body.players || []).slice(0, 99).map(function (k) {
        return [clean(k[0], 60), Math.max(1, Math.min(25, parseInt(k[1], 10) || 15)), Math.max(1, Math.min(3, parseInt(k[2], 10) || 1))];
      }).filter(function (k) { return k[0]; });
      if (players.length > MAX_KEEPERS) return json({ error: "Five keepers at most." });
      writeKeepers(y, team, players, (body.order || []).map(function (t) { return clean(t, 60); }));
      if (!have) props.setProperty(key, hash);
      return json(view(y));
    }
    if (body.action === "vote") {
      var ok = writeVote(y, team, clean(body.date, 40), !!body.yes, body.ballot);
      if (!ok) return json({ error: "That date isn't on the ballot." });
      if (!have) props.setProperty(key, hash);
      return json(view(y));
    }
    return json({ error: "Unknown action" });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Keepers ---------- */
function keeperTab(y, order) {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(String(y));
  if (sh || !order || order.length < 16) return sh;
  sh = ss.insertSheet(String(y), 0);
  sh.getRange(1, 1, 1, 8).setValues([order.slice(0, 8)]).setFontWeight("bold");
  sh.getRange(8, 1, 1, 8).setValues([order.slice(8, 16)]).setFontWeight("bold");
  sh.setColumnWidths(1, 8, 200);
  return sh;
}
// Header rows: six or more names and no "(round)" cells, with keepers under them
function headerCells(sh) {
  var vals = sh.getRange(1, 1, Math.max(1, Math.min(sh.getLastRow(), 40)), 8).getDisplayValues(), out = {};
  for (var i = 0; i < vals.length; i++) {
    var row = vals[i], named = row.filter(function (c) { return c.trim(); });
    if (named.length < 6 || row.some(function (c) { return c.indexOf("(") > -1; })) continue;
    for (var c = 0; c < 8; c++) if (row[c].trim()) out[row[c].trim()] = { row: i + 1, col: c + 1 };
    i += 5;
  }
  return out;
}
function writeKeepers(y, team, players, order) {
  var sh = keeperTab(y, order);
  if (!sh) throw new Error("No " + y + " tab yet");
  var heads = headerCells(sh), at = heads[team];
  if (!at) {
    // a team the tab doesn't list yet: the first open header slot
    var rows = Object.keys(heads).map(function (k) { return heads[k].row; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
    for (var r = 0; r < rows.length && !at; r++) for (var c = 1; c <= 8 && !at; c++) if (!sh.getRange(rows[r], c).getDisplayValue().trim()) at = { row: rows[r], col: c };
    if (!at) throw new Error("No room for " + team + " in the " + y + " tab");
    sh.getRange(at.row, at.col).setValue(team).setFontWeight("bold");
  }
  var cells = [];
  for (var k = 0; k < MAX_KEEPERS; k++) cells.push([players[k] ? players[k][0] + " (" + players[k][1] + "/" + players[k][2] + ")" : ""]);
  sh.getRange(at.row + 1, at.col, MAX_KEEPERS, 1).setValues(cells);
}
function readKeepers(y) {
  var sh = SpreadsheetApp.getActive().getSheetByName(String(y)), out = {};
  if (!sh) return out;
  var heads = headerCells(sh);
  Object.keys(heads).forEach(function (team) {
    var at = heads[team], vals = sh.getRange(at.row + 1, at.col, MAX_KEEPERS, 1).getDisplayValues();
    out[team] = vals.map(function (v) { return parseCell(v[0]); }).filter(function (k) { return k; });
  });
  return out;
}
function parseCell(s) {
  s = String(s || "").trim();
  if (!s || s === ",") return null;
  var m = s.match(/^(.*?)\s*\((\d+)(?:\/(\d))?\)\s*(\*)?\s*$/);
  return m ? [m[1].trim(), +m[2], m[3] ? +m[3] : null, !!m[4]] : [s.replace(/\*$/, "").trim(), null, null, /\*$/.test(s)];
}

/* ---------- Draft-date vote ---------- */
function voteTab(y) { return SpreadsheetApp.getActive().getSheetByName(y + " Draft Vote"); }
// The first vote creates the tab from the page's ballot (ISO dates): dates across the top, a Totals row under
// them that adds up every team row below it. Dates can be added, removed or relabeled by hand afterward.
function makeVoteTab(y, ballot) {
  var dates = (ballot || []).map(function (d) { return String(d); }).filter(function (d) { return /^\d{4}-\d\d-\d\d$/.test(d); }).slice(0, 21);
  if (!dates.length) return null;
  var sh = SpreadsheetApp.getActive().insertSheet(y + " Draft Vote");
  var n = dates.length, col = function (c) { return String.fromCharCode(65 + c); };
  sh.getRange(1, 1).setValue("Team");
  sh.getRange(1, 2, 1, n).setValues([dates]).setNumberFormat("ddd, mmm d");        // typed like a person would, so they become dates
  sh.getRange(2, 1).setValue("Totals");
  sh.getRange(2, 2, 1, n).setFormulas([dates.map(function (d, k) { return "=SUM(" + col(k + 1) + "3:" + col(k + 1) + ")"; })]);
  sh.getRange(1, 1, 2, n + 1).setFontWeight("bold");
  sh.setFrozenRows(2);
  sh.setColumnWidth(1, 240);
  return sh;
}
function dateId(v, tz) { return Object.prototype.toString.call(v) === "[object Date]" ? Utilities.formatDate(v, tz, "yyyy-MM-dd") : String(v).trim(); }
function dateLabel(v, tz) { return Object.prototype.toString.call(v) === "[object Date]" ? Utilities.formatDate(v, tz, "EEEE, MMMM d") : String(v).replace(/,\s*$/, "").trim(); }
function readVote(y) {
  var sh = voteTab(y);
  if (!sh) return { dates: [], marks: {} };
  var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone(), vals = sh.getDataRange().getValues();
  var head = vals[0], dates = [], marks = {};
  for (var c = 1; c < head.length; c++) if (head[c] !== "" && head[c] != null) dates.push({ col: c, id: dateId(head[c], tz), label: dateLabel(head[c], tz) });
  for (var r = 1; r < vals.length; r++) {
    var team = String(vals[r][0]).replace(/[-]/g, "").trim();
    if (!team || /^(totals?|\d=)/i.test(team)) continue;
    var m = {};
    dates.forEach(function (d) { var v = vals[r][d.col]; if (v !== "" && v != null) m[d.id] = Number(v) ? 1 : 0; });
    marks[team] = m;
  }
  return { dates: dates.map(function (d) { return { id: d.id, label: d.label }; }), marks: marks };
}
function writeVote(y, team, id, yes, ballot) {
  var sh = voteTab(y) || makeVoteTab(y, ballot);
  if (!sh) return false;
  var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone(), vals = sh.getDataRange().getValues(), col = -1, row = -1;
  for (var c = 1; c < vals[0].length; c++) if (vals[0][c] !== "" && dateId(vals[0][c], tz) === id) col = c;
  if (col < 0) return false;
  var totals = vals.length;
  for (var r = 1; r < vals.length; r++) {
    var name = String(vals[r][0]).replace(/[-]/g, "").trim();
    if (name === team) row = r;
    if (/^totals?$/i.test(name) && totals === vals.length) totals = r;
  }
  if (row < 0) {
    // a Totals row under the team rows (the old tabs): the new team goes just above it; otherwise at the bottom
    if (totals < vals.length && totals > 1) { sh.insertRowBefore(totals + 1); row = totals; }
    else { row = sh.getLastRow(); }
    sh.getRange(row + 1, 1).setValue(team);
  }
  sh.getRange(row + 1, col + 1).setValue(yes ? 1 : 0);
  return true;
}

/* ---------- Helpers ---------- */
function view(y) {
  return { keepers: readKeepers(y), vote: readVote(y), lock: PropertiesService.getScriptProperties().getProperty("LOCK") || "" };
}
function sha(s) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, "yoenis-sheet|" + s, Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ("0" + (b & 255).toString(16)).slice(-2); }).join("");
}
function clean(s, max) {
  return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>=+@]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}
function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
