/* Fantasy Kit: which league options go together. No DOM and no network, so the setup form, the league engine, tests
   and (later) league import all read the same list.

   Every option a league can turn on is listed once in OPTIONS:
     id      the setup form's field ("robinOn")
     key     the league setting it becomes (settings.robin), when it has one
     label   its name, for messages
     group   what kind of rule it is: "raid" (moves players between teams), "economy" (FAAB rewards), "schedule"
             (who plays whom), "penalty"
     slot    options sharing a slot can't be on together: a league gets one raid twist
   RULES are the checks that aren't about slots: { ids, when(form), level: "error" | "warn", msg }.

   check(form) -> { errors, warnings }, each [{ ids, msg }]
   blockedWhy(form, id) -> why an option can't be turned on right now, or null
   turnOn(form, id) -> turns it on and switches off whatever shares its slot; returns the ids it switched off
   cleanSettings(settings, { kind }) -> drops clashing twists from a league's settings (the first raid wins); returns
     the setting keys it dropped */
(function (root, factory) {
  const m = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = m;
  else (root.FK = root.FK || {}).rules = m;
})(this, function () {
  "use strict";

  const OPTIONS = [
    { id: "vampOn", key: "vampire", label: "Vampire", group: "raid", slot: "raid" },
    { id: "robinOn", key: "robin", label: "Robin Hood", group: "raid", slot: "raid" },
    { id: "conqOn", key: "conquest", label: "Conquest", group: "raid", slot: "raid" },
    { id: "crownOn", key: "crown", label: "Kingslayer", group: "economy" },
    { id: "tbOn", key: "topBonus", label: "Top-score bonus", group: "economy" },
    { id: "pyoOn", key: "pyo", label: "Pick your opponent", group: "schedule" },
    { id: "median", key: "median", label: "Median game", group: "schedule" },
    { id: "hangOn", key: "hangover", label: "The Hangover", group: "penalty" },
    { id: "dealOn", key: "deal", label: "Deal or No Deal", group: "economy" },
  ];
  const byId = Object.fromEntries(OPTIONS.map((o) => [o.id, o]));
  const on = (form, id) => !!(form && +form[id]);
  const SLOT_MSG = { raid: "One raid twist at a time: Vampire, Robin Hood and Conquest all move players after a week, and together they churn rosters faster than anyone can keep up." };

  const RULES = [
    { ids: ["robinOn", "conqOn", "vampOn"], level: "error", when: (f) => f.kind === "dynasty",
      msg: "Raids aren't for dynasty leagues: a raided player would be gone for good." },
    { ids: ["robinOn", "conqOn"], level: "warn", when: (f) => f.kind === "keeper",
      msg: "In a keeper league a raided player can be kept by the team that took him." },
    { ids: ["crownOn"], level: "error", when: (f) => f.waivers && f.waivers !== "faab",
      msg: "Kingslayer pays its bounty in FAAB, so it needs FAAB waivers." },
    { ids: ["pyoOn"], level: "error", when: (f) => f.teams != null && f.teams % 2 === 1,
      msg: "Pick your opponent needs an even number of teams." },
    { ids: ["vampOn"], level: "error", when: (f) => (f.sport && f.sport !== "nfl") || (f.season && f.season !== "h2h") || (f.type && !["snake", "linear", "3rr"].includes(f.type)),
      msg: "The vampire is football only, head to head, with a snake, linear or third-round reversal draft." },
    { ids: ["vampOn"], level: "error", when: (f) => f.kind && f.kind !== "redraft",
      msg: "A vampire's steals would pile up year after year, so it's redraft only." },
    { ids: ["crownOn", "hangOn"], level: "warn", when: (f) => on(f, "crownOn") && on(f, "hangOn"),
      msg: "Kingslayer and The Hangover both land on winners: the king will be hungover most weeks." },
    { ids: ["dealOn"], level: "error", when: (f) => f.season && ["h2hcats", "roto"].includes(f.season),
      msg: "Deal or No Deal guarantees a score, so it needs points scoring." },
    { ids: ["robinOn", "conqOn", "crownOn", "hangOn", "pyoOn"], level: "error", when: (f) => f.season && !["h2h", "h2hcats"].includes(f.season),
      msg: "Head to head twists need a head to head format." },
  ];

  function check(form) {
    const f = form || {}, errors = [], warnings = [];
    // slots: more than one option on in the same slot
    const slots = {};
    for (const o of OPTIONS) if (o.slot && on(f, o.id)) (slots[o.slot] = slots[o.slot] || []).push(o.id);
    for (const [slot, ids] of Object.entries(slots)) if (ids.length > 1) errors.push({ ids, msg: SLOT_MSG[slot] || "These can't be on together." });
    for (const r of RULES) {
      const live = r.ids.filter((id) => on(f, id));
      if (!live.length || !r.when(f)) continue;
      (r.level === "error" ? errors : warnings).push({ ids: live, msg: r.msg });
    }
    return { errors, warnings };
  }

  // why an option can't be turned on (an error rule that applies to it), or null. Slot clashes don't block: turning
  // an option on switches the others in its slot off.
  function blockedWhy(form, id) {
    const f = Object.assign({}, form || {}, { [id]: 1 });
    for (const r of RULES) if (r.level === "error" && r.ids.includes(id) && r.when(f)) return r.msg;
    return null;
  }

  function turnOn(form, id) {
    const o = byId[id], off = [];
    if (o && o.slot) for (const x of OPTIONS) if (x.slot === o.slot && x.id !== id && on(form, x.id)) { form[x.id] = 0; off.push(x.id); }
    form[id] = 1;
    return off;
  }

  // A league's settings, after the fact: keep the first raid twist (vampire, then Robin Hood, then Conquest), none in
  // a dynasty. Covers leagues made before the form knew these rules, and import.
  function cleanSettings(s, o = {}) {
    if (!s) return [];
    const kind = o.kind || (s.dynasty ? "dynasty" : s.keepers ? "keeper" : "redraft"), dropped = [];
    const raids = OPTIONS.filter((x) => x.slot === "raid").map((x) => x.key);
    let kept = kind === "dynasty" ? null : raids.find((k) => s[k]);
    for (const k of raids) if (s[k] && k !== kept) { delete s[k]; dropped.push(k); }
    return dropped;
  }

  const label = (id) => (byId[id] ? byId[id].label : id);
  return { OPTIONS, RULES, check, blockedWhy, turnOn, cleanSettings, label, byId };
});
