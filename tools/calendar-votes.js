// Vote box for Night Out, davidsolar.dev/calendar/ (a Cloudflare Worker with one KV namespace, free plan).
//
// Holds who marked what, the plans friends add, and their restaurant ratings, so everyone with the
// link sees the same calendar: Interested or Going on a show, game, movie or plan; Want to go and
// 1 to 5 stars on a restaurant.
//   GET  /  -> {"votes": {"<id>": {"<name>": "going" | "interested" | "want"}}, "plans": {"<plan id>": {...}},
//               "ratings": {"<restaurant id>": {"<name>": 1-5}}}
//   POST /  {"id": "<id>", "name": "David", "status": "going" | "interested" | "want" | "loved" | ""}   ("" clears)
//   POST /  {"plan": {"date": "2026-10-23", "time": "19:00", "title": "Dinner at Kaia", "place": "Kaia",
//                     "kind": "food" | "other", "by": "David", "food": "<restaurant id, optional>"}}
//   POST /  {"unplan": "<plan id>", "name": "David"}       (only the person who added it can take it down)
//   POST /  {"rate": "<restaurant id>", "name": "David", "stars": 4}   (0 clears)
// Every POST answers with the whole {votes, plans, ratings}. Three KV keys hold it all; the free plan allows
// 100,000 reads and 1,000 writes a day.
//
// Setup (once), in the Cloudflare dashboard:
//   1. Storage & Databases > KV > Create a namespace > name it "nightout-votes".
//   2. Workers & Pages > Create > Create Worker > name it "calendar-votes" > Deploy.
//   3. Edit code > replace everything with this file > Deploy.
//   4. The worker's Settings > Bindings > Add > KV namespace > variable name VOTES,
//      namespace nightout-votes > Deploy.
// Opening https://calendar-votes.<your subdomain>.workers.dev/ should then show {"votes":{},"plans":{},"ratings":{}}.

const KEYS = ["votes", "plans", "ratings"];
const MAX_BYTES = 250000;              // a guard against someone filling the box with junk
const MAX_PLANS = 300;
const STATUSES = new Set(["going", "interested", "want", "loved", ""]);

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: headers() });
    if (!env.VOTES) return reply({ error: "Bind a KV namespace to this worker as VOTES (Settings > Bindings)." }, 500);
    const load = async () => {
      const raw = {};
      for (const k of KEYS) raw[k] = (await env.VOTES.get(k)) || "{}";
      const box = { raw };
      for (const k of KEYS) box[k] = JSON.parse(raw[k]);
      return box;
    };

    if (request.method === "GET") return reply(view(await load()));
    if (request.method !== "POST") return reply({ error: "GET or POST only" }, 405);

    let body;
    try { body = await request.json(); } catch (e) { return reply({ error: "Send JSON" }, 400); }
    const box = await load();

    if (body.plan) {
      const p = body.plan;
      const plan = {
        date: String(p.date || ""), time: String(p.time || ""),
        title: clean(p.title, 80), place: clean(p.place, 80),
        kind: p.kind === "food" ? "food" : "other", by: clean(p.by, 24), food: clean(p.food, 100),
      };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.date) || (plan.time && !/^\d{2}:\d{2}$/.test(plan.time)) || !plan.title || !plan.by) {
        return reply({ error: "A plan needs a date (YYYY-MM-DD), a title and who's adding it; time is HH:MM or empty" }, 400);
      }
      if (!plan.food) delete plan.food;
      // Drop plans more than a month past, then the oldest if there are still too many.
      const cutoff = new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 10);
      for (const [id, q] of Object.entries(box.plans)) if (q.date < cutoff) { delete box.plans[id]; delete box.votes[id]; }
      const ids = Object.keys(box.plans).sort((a, b) => box.plans[a].date.localeCompare(box.plans[b].date));
      while (ids.length >= MAX_PLANS) { const id = ids.shift(); delete box.plans[id]; delete box.votes[id]; }
      const id = "plan-" + crypto.randomUUID().slice(0, 8);
      box.plans[id] = plan;
      box.votes[id] = { [plan.by]: "going" };   // whoever adds a plan is going
      return save(env, box, { id });
    }

    if (body.unplan) {
      const id = clean(body.unplan, 40), name = clean(body.name, 24);
      const plan = box.plans[id];
      if (!plan) return reply(view(box));
      if (plan.by.toLowerCase() !== name.toLowerCase()) return reply({ error: "Only " + plan.by + " can take this plan down" }, 403);
      delete box.plans[id]; delete box.votes[id];
      return save(env, box);
    }

    if (body.rate) {
      const id = clean(body.rate, 100), name = clean(body.name, 24), stars = Number(body.stars);
      if (!id || !name || !Number.isInteger(stars) || stars < 0 || stars > 5) return reply({ error: "Need rate (the place id), name and stars (0 to 5)" }, 400);
      const r = box.ratings[id] || {};
      if (stars) r[name] = stars; else delete r[name];
      if (Object.keys(r).length) box.ratings[id] = r; else delete box.ratings[id];
      return save(env, box);
    }

    const id = clean(body.id, 100), name = clean(body.name, 24), status = body.status == null ? "" : String(body.status);
    if (!id || !name || !STATUSES.has(status)) return reply({ error: "Need id, name and status (going, interested, want, loved or empty)" }, 400);
    const ev = box.votes[id] || {};
    if (status) ev[name] = status; else delete ev[name];
    if (Object.keys(ev).length) box.votes[id] = ev; else delete box.votes[id];
    return save(env, box);
  },
};

const view = (box) => ({ votes: box.votes, plans: box.plans, ratings: box.ratings });

// Writes only the key that changed, so a vote costs one of the day's 1,000 free writes, not three.
async function save(env, box, extra) {
  const text = {};
  for (const k of KEYS) text[k] = JSON.stringify(box[k]);
  if (KEYS.reduce((n, k) => n + text[k].length, 0) > MAX_BYTES) return reply({ error: "The vote box is full" }, 413);
  for (const k of KEYS) if (text[k] !== box.raw[k]) await env.VOTES.put(k, text[k]);
  return reply(Object.assign(view(box), extra || {}));
}

// Plain printable text only, trimmed and length-capped.
function clean(s, max) {
  return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

function headers() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headers() });
}
