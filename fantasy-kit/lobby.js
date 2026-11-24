/* Fantasy Kit: the pre-draft lobby, the draft room's first tab until the draft starts (play.html, live.js).

   What it shows: when the draft starts (with a countdown, a calendar file and a Google Calendar link), the draft
   order with who has each team and who's ready, the league's rules in a few lines, and the buttons for what comes
   next: I'm ready, a practice mock with these exact settings, the invite link, and for the commissioner, drawing the
   order live, setting it by hand, setting the draft time and starting the draft.

   A live draw (FK.draft.drawOrder) stamps D.drawn.at. For the first seconds after that, revealed(D, now) says how many
   slots every page shows, last pick first, so everyone in the room watches the same reveal. Buttons carry
   data-live="<action>" and live.js handles them. No network here. */
(function (root, factory) {
  const m = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = m;
  else (root.FK = root.FK || {}).lobby = m;
})(this, function () {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const STEP = 900;      // ms between slots in a live draw

  // how many slots of a live draw are showing (all of them once it's done, or with no draw)
  function revealed(D, now) {
    const n = (D.round1 || []).length;
    if (!D.drawn || !D.drawn.at) return n;
    const k = Math.floor((now - D.drawn.at) / STEP);
    return k < 0 ? 0 : Math.min(n, k);
  }
  const drawing = (D, now) => !!(D.drawn && D.drawn.at && revealed(D, now) < (D.round1 || []).length);
  const readyOf = (D) => D.ready || {};
  // "Starts in 26 hours", "Starts in 1 hr 12 min", "Starts in 40 sec"
  function countdown(left) {
    if (left <= 0) return "Starting now";
    if (left < 60e3) return `Starts in ${Math.ceil(left / 1000)} sec`;
    if (left < 3 * 3600e3) { const h = Math.floor(left / 3600e3), m = Math.ceil((left % 3600e3) / 60e3); return `Starts in ${h ? h + " hr " : ""}${m} min`; }
    if (left < 48 * 3600e3) return `Starts in ${Math.round(left / 3600e3)} hours`;
    return `Starts in ${Math.round(left / 864e5)} days`;
  }
  // the room redraws the lobby every 20-30 seconds; the countdown keeps its own second hand
  if (typeof document !== "undefined" && typeof setInterval !== "undefined") setInterval(() => {
    document.querySelectorAll(".lb-cd[data-at]").forEach((el) => { const left = +el.dataset.at - Date.now(), t = countdown(left); if (el.textContent !== t) el.textContent = t; el.classList.toggle("soon", left < 3600e3); });
  }, 1000);
  const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");

  // who's in: claimed teams (a manager), how many of them are ready, open teams (bots until claimed)
  function counts(D, seats) {
    const claimed = D.teams.filter((t) => seats[t.id] != null).map((t) => t.id);
    const ready = claimed.filter((t) => readyOf(D)[t]);
    return { claimed: claimed.length, ready: ready.length, open: D.teams.length - claimed.length, all: claimed.length > 0 && ready.length === claimed.length };
  }

  /* ---------- calendar ---------- */
  const icsDate = (t) => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const icsText = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  // a draft lasts roughly its picks times the clock, at least an hour, at most four
  const lengthOf = (D) => Math.max(36e5, Math.min(4 * 36e5, (D.order || []).length * Math.min(90, D.clock || 60) * 1000 * 0.7));
  function ics(D, name, url) {
    const end = D.startAt + lengthOf(D);
    return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//davidsolar.dev//Draft Lab//EN", "BEGIN:VEVENT",
      `UID:draft-${D.seed}-${D.startAt}@davidsolar.dev`, `DTSTAMP:${icsDate(Date.now())}`, `DTSTART:${icsDate(D.startAt)}`, `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsText(`${name} draft`)}`, `DESCRIPTION:${icsText(`The draft room: ${url}`)}`, `URL:${icsText(url)}`,
      "BEGIN:VALARM", "TRIGGER:-PT15M", "ACTION:DISPLAY", `DESCRIPTION:${icsText(`${name} draft in 15 minutes`)}`, "END:VALARM",
      "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  }
  const gcal = (D, name, url) => `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`${name} draft`)}&dates=${icsDate(D.startAt)}/${icsDate(D.startAt + lengthOf(D))}&details=${encodeURIComponent(`The draft room: ${url}`)}`;

  /* ---------- the tab ---------- */
  // o: { D, now, me, commish, seats: { team: manager name }, invite, rules: [lines], teamAv(t), canDraw, name }
  function html(o) {
    const { D, now, me } = o, seats = o.seats || {}, ready = readyOf(D), c = counts(D, seats);
    const n = D.round1.length, shown = revealed(D, now), live = drawing(D, now);
    // the countdown: days and hours while it's far off, minutes inside the last hours, seconds in the last minute
    const left = D.startAt ? D.startAt - now : null, cd = left == null ? "" : countdown(left);
    const when = D.startAt
      ? `<b>${esc(new Date(D.startAt).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</b><span class="lb-cd${left != null && left < 3600e3 ? " soon" : ""}" role="timer" data-at="${D.startAt - (now - Date.now())}">${esc(cd)}</span><span class="ps">It starts on its own. Anyone who isn't here drafts from his queue.</span>`
      : `<b>When the commissioner starts it</b><span class="ps">No time is set yet${o.commish ? ": set one so everyone gets a reminder an hour before" : ""}.</span>`;
    const cal = D.startAt ? `<div class="lb-cal"><button type="button" class="btn sm" data-live="ics">Add to calendar</button><a class="btn sm ghost" href="${esc(gcal(D, o.name, o.url))}" target="_blank" rel="noopener">Google Calendar</a></div>` : "";
    const mine = me != null && seats[me] != null;
    const imReady = mine && !!ready[me];
    const rows = D.round1.map((t, i) => {
      // a live draw fills in from the last pick up
      const hidden = live && i < n - shown;
      const team = D.teams[t], who = seats[t] != null ? esc(seats[t]) : `<span class="ps">Open, a bot until claimed</span>`;
      const tag = seats[t] == null ? "" : ready[t] ? `<span class="tag win">Ready</span>` : `<span class="tag">Not yet</span>`;
      return `<li class="lb-row${t === me && !hidden ? " me" : ""}${hidden ? " hid" : ""}${live && i === n - shown ? " now" : ""}"><span class="lb-n">${D.type === "auction" ? "" : i + 1}</span>${hidden ? `<span class="lb-q">?</span><b class="grow ps">${i === n - shown - 1 ? "Drawing…" : ""}</b>` : `${o.teamAv(team)}<span class="grow lb-t"><b>${esc(team.name)}</b><small>${who}</small></span>${tag}`}</li>`;
    }).join("");
    const head = D.auction && D.auction.dutch ? "Teams" : D.type === "auction" ? "Nomination order" : D.type === "mystery" ? "Teams" : "Draft order";
    const mineBtns = mine ? `<button type="button" class="btn${imReady ? "" : " go"}" data-live="ready">${imReady ? "I'm not ready" : "I'm ready"}</button>` : "";
    const commish = o.commish ? `<div class="lb-cm"><b class="ps">${o.part === "commish" ? "Draft order and invites" : "Commissioner"}</b><div class="lb-acts">
        ${o.canDraw ? `<button type="button" class="btn sm" data-live="draw"${live ? " disabled" : ""}>Draw the order live</button><button type="button" class="btn sm ghost" data-live="draft-order">Set it by hand</button>` : ""}
        <button type="button" class="btn sm ghost" data-live="league">${D.startAt ? "Change the draft time" : "Set a draft time"}</button>
        ${o.invite && c.open ? `<button type="button" class="btn sm ghost" data-live="invite">Invite (${c.open} open)</button>` : ""}
      </div><p class="ps" style="margin:6px 0 0">${c.all ? `Everyone with a team is ready. Start the draft from ${o.home ? "the draft room" : "the top bar"}.` : c.claimed <= 1 ? (c.ready ? "You're ready. No one else has joined yet." : "No one else has joined yet.") : `${c.ready} of ${c.claimed} managers ready.`}${c.open ? ` ${c.open} team${c.open > 1 ? "s are" : " is"} open and will be bots.` : ""}</p></div>` : "";
    if (o.part === "commish") return commish;
    return `<div class="lobby">
      <section class="lb-card lb-when"><span class="ps lb-k">The draft</span>${when}${cal}</section>
      <section class="lb-card lb-go">
        <div class="lb-acts">${mineBtns}<button type="button" class="btn${mine && imReady ? " go" : ""}" data-live="practice">${o.resume ? "Resume practice mock" : "Practice mock"}</button>${o.invite && c.open && !o.commish ? `<button type="button" class="btn ghost" data-live="invite">Invite</button>` : ""}</div>
        ${mine && D.type !== "auction" && !(D.auction && D.auction.dutch) && D.type !== "mystery" && D.round1.indexOf(me) >= 0 && !live ? `<p class="lb-slot">You pick <b>${ordinal(D.round1.indexOf(me) + 1)}</b> of ${n}${D.type === "snake" || D.type === "3rr" ? `, and No. ${2 * n - D.round1.indexOf(me)} overall in round 2` : ""}.</p>` : ""}
        <p class="ps" style="margin:6px 0 0">The practice mock is this draft, these rules and your slot, against bots. Only you see it, and nothing counts.${o.resume ? " Yours is saved where you left off." : ""}</p>
      </section>
      ${commish}
      <section class="lb-card"><div class="lb-h"><b>${head}</b><span class="ps">${live ? "Drawing now…" : c.claimed <= 1 ? "Just you so far" : `${c.ready} of ${c.claimed} ready`}</span></div><ol class="lb-l">${rows}</ol></section>
      ${o.rules && o.rules.length ? `<section class="lb-card"><div class="lb-h"><b>The rules</b></div><ul class="lb-rules">${o.rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></section>` : ""}
    </div>`;
  }

  return { STEP, revealed, drawing, counts, ics, gcal, html, lengthOf };
});
