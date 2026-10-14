// Vote box for Night Out, davidsolar.dev/calendar/ (a Cloudflare Worker with one KV namespace, free plan).
//
// Holds who marked what, and the plans friends add, so everyone with the link sees the same calendar:
// Interested or Going on a show, game, movie or plan; Want to go or Loved it on a restaurant.
//   GET  /  -> {"votes": {"<id>": {"<name>": "going" | "interested" | "want" | "loved"}}, "plans": {"<plan id>": {...}}}
//   POST /  {"id": "<id>", "name": "David", "status": "going" | "interested" | "want" | "loved" | ""}   ("" clears)
//   POST /  {"plan": {"date": "2026-10-23", "time": "19:00", "title": "Dinner at Kaia", "place": "Kaia",
//                     "kind": "food" | "other", "by": "David", "food": "<restaurant id, optional>"}}
//   POST /  {"unplan": "<plan id>", "name": "David"}       (only the person who added it can take it down)
// Every POST answers with the whole {votes, plans}. Two KV keys hold it all; the free plan allows
// 100,000 reads and 1,000 writes a day.
//
// Setup (once), in the Cloudflare dashboard:
//   1. Storage & Databases > KV > Create a namespace > name it "nightout-votes".
//   2. Workers & Pages > Create > Create Worker > name it "calendar-votes" > Deploy.
//   3. Edit code > replace everything with this file > Deploy.
//   4. The worker's Settings > Bindings > Add > KV namespace > variable name VOTES,
//      namespace nightout-votes > Deploy.
// Opening https://calendar-votes.<your subdomain>.workers.dev/ should then show {"votes":{},"plans":{}}.

const MAX_BYTES = 250000;              // a guard against someone filling the box with junk
const MAX_PLANS = 300;
const STATUSES = new Set(["going", "interested", "want", "loved", ""]);

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: headers() });
    if (!env.VOTES) return reply({ error: "Bind a KV namespace to this worker as VOTES (Settings > Bindings)." }, 500);
    const load = async () => {
      const raw = { votes: (await env.VOTES.get("votes")) || "{}", plans: (await env.VOTES.get("plans")) || "{}" };
      return { votes: JSON.parse(raw.votes), plans: JSON.parse(raw.plans), raw };
    };

    if (request.method === "GET") { const box = await load(); return reply({ votes: box.votes, plans: box.plans }); }
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
      if (!plan) return reply({ votes: box.votes, plans: box.plans });
      if (plan.by.toLowerCase() !== name.toLowerCase()) return reply({ error: "Only " + plan.by + " can take this plan down" }, 403);
      delete box.plans[id]; delete box.votes[id];
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

// Writes only the key that changed, so a vote costs one of the day's 1,000 free writes, not two.
async function save(env, box, extra) {
  const votes = JSON.stringify(box.votes), plans = JSON.stringify(box.plans);
  if (votes.length + plans.length > MAX_BYTES) return reply({ error: "The vote box is full" }, 413);
  if (votes !== box.raw.votes) await env.VOTES.put("votes", votes);
  if (plans !== box.raw.plans) await env.VOTES.put("plans", plans);
  return reply(Object.assign({ votes: box.votes, plans: box.plans }, extra || {}));
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
