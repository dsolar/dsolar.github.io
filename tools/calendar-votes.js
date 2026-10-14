// Vote box for davidsolar.dev/calendar/ and /restaurants/ (a Cloudflare Worker with one KV namespace, free plan).
//
// Holds who marked what, so everyone with the link sees the same thing: Interested or Going on a
// night out (Night Out), Want to go or Loved it on a restaurant (Supper Club).
//   GET  /  -> {"votes": {"<id>": {"<name>": "going" | "interested" | "want" | "loved"}}}
//   POST /  {"id": "<id>", "name": "David", "status": "going" | "interested" | "want" | "loved" | ""}   ("" clears)
// Everything lives under one KV key. That's plenty for a group of friends: the free plan allows
// 100,000 reads and 1,000 writes a day.
//
// Setup (once), in the Cloudflare dashboard:
//   1. Storage & Databases > KV > Create a namespace > name it "nightout-votes".
//   2. Workers & Pages > Create > Create Worker > name it "calendar-votes" > Deploy.
//   3. Edit code > replace everything with this file > Deploy.
//   4. The worker's Settings > Bindings > Add > KV namespace > variable name VOTES,
//      namespace nightout-votes > Deploy.
// Opening https://calendar-votes.<your subdomain>.workers.dev/ should then show {"votes":{}}.

const KEY = "votes";
const MAX_BYTES = 250000;              // a guard against someone filling the box with junk
const STATUSES = new Set(["going", "interested", "want", "loved", ""]);

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: headers() });
    if (!env.VOTES) return reply({ error: "Bind a KV namespace to this worker as VOTES (Settings > Bindings)." }, 500);

    if (request.method === "GET") {
      return reply({ votes: (await env.VOTES.get(KEY, "json")) || {} });
    }
    if (request.method !== "POST") return reply({ error: "GET or POST only" }, 405);

    let body;
    try { body = await request.json(); } catch (e) { return reply({ error: "Send JSON" }, 400); }
    const id = clean(body.id, 100), name = clean(body.name, 24), status = body.status == null ? "" : String(body.status);
    if (!id || !name || !STATUSES.has(status)) return reply({ error: "Need id, name and status (going, interested, want, loved or empty)" }, 400);

    const votes = (await env.VOTES.get(KEY, "json")) || {};
    const ev = votes[id] || {};
    if (status) ev[name] = status; else delete ev[name];
    if (Object.keys(ev).length) votes[id] = ev; else delete votes[id];
    const text = JSON.stringify(votes);
    if (text.length > MAX_BYTES) return reply({ error: "The vote box is full" }, 413);
    await env.VOTES.put(KEY, text);
    return reply({ votes });
  },
};

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
