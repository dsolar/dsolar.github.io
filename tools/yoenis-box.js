// Keeper box for Don't Forget to Wipe Yoenis, davidsolar.dev/yoenis/ (a Cloudflare Worker with one KV
// namespace, free plan). Same setup as the Night Out vote box.
//
// Holds each team's declared keepers and the draft-date vote, so everyone with the link sees the same thing.
//   GET  /  -> {"keepers": {"<team>": {"players": ["Aaron Judge", ...], "by": "Jon", "at": "<ISO time>"}},
//               "votes": {"<option id>": ["Jon", "Craig"]}, "lock": "<ISO time or empty>"}
//   POST /  {"team": "Bulba", "pin": "4821", "players": ["Aaron Judge", "Trea Turner"], "by": "Jon"}
//           Declares (or changes) a team's keepers, up to five. The first save for a team sets its PIN; every
//           change after that needs the same PIN. Nothing changes after the lock time.
//   POST /  {"vote": "<option id, e.g. 2027-03-21>", "name": "Jon", "on": true}   (on: false takes it back)
//   POST /  {"admin": "<ADMIN secret>", "resetPin": "Bulba"}   (the commissioner clears a forgotten PIN)
//   POST /  {"admin": "<ADMIN secret>", "lock": "2027-03-14T23:59:00-04:00"}   ("" unlocks)
// Every POST answers with the whole {keepers, votes, lock}. PINs are stored only as salted SHA-256 hashes.
//
// Setup (once), in the Cloudflare dashboard:
//   1. Storage & Databases > KV > Create a namespace > name it "yoenis-box".
//   2. Workers & Pages > Create > Create Worker > name it "yoenis-box" > Deploy.
//   3. Edit code > replace everything with this file > Deploy.
//   4. The worker's Settings > Bindings > Add > KV namespace > variable name BOX, namespace yoenis-box.
//   5. Settings > Variables and Secrets > Add > type Secret, name ADMIN, any long passphrase only you know.
//   6. Deploy, then put the worker's URL in yoenis/data.json as offseason.box_url.
// Opening https://yoenis-box.<your subdomain>.workers.dev/ should then show {"keepers":{},"votes":{},"lock":""}.

const KEYS = ["keepers", "pins", "votes", "meta"];
const MAX_BYTES = 200000;
const MAX_KEEPERS = 5;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: headers() });
    if (!env.BOX) return reply({ error: "Bind a KV namespace to this worker as BOX (Settings > Bindings)." }, 500);
    const box = { raw: {} };
    for (const k of KEYS) { box.raw[k] = (await env.BOX.get(k)) || "{}"; box[k] = JSON.parse(box.raw[k]); }
    if (request.method === "GET") return reply(view(box));
    if (request.method !== "POST") return reply({ error: "GET or POST only" }, 405);

    let body;
    try { body = await request.json(); } catch (e) { return reply({ error: "Send JSON" }, 400); }
    const locked = () => box.meta.lock && Date.now() > Date.parse(box.meta.lock);

    // Commissioner tools
    if (body.admin != null) {
      if (!env.ADMIN || String(body.admin) !== env.ADMIN) return reply({ error: "Wrong admin passphrase" }, 403);
      if (body.resetPin) { delete box.pins[clean(body.resetPin, 60)]; return save(env, box); }
      if (body.lock != null) {
        const t = String(body.lock);
        if (t && isNaN(Date.parse(t))) return reply({ error: "lock is an ISO date and time, or empty" }, 400);
        box.meta.lock = t;
        return save(env, box);
      }
      return reply({ error: "Nothing to do" }, 400);
    }

    // Keeper declarations
    if (body.team != null) {
      const team = clean(body.team, 60), pin = String(body.pin == null ? "" : body.pin), by = clean(body.by, 24);
      if (!team) return reply({ error: "Which team?" }, 400);
      if (!/^\d{4,8}$/.test(pin)) return reply({ error: "The PIN is 4 to 8 digits" }, 400);
      if (locked()) return reply({ error: "Keepers are locked" }, 403);
      const players = Array.isArray(body.players) ? [...new Set(body.players.map(p => clean(p, 60)).filter(Boolean))] : null;
      if (!players || players.length > MAX_KEEPERS) return reply({ error: "players is a list of up to five names" }, 400);
      const hash = await sha(team + "|" + pin);
      if (box.pins[team] && box.pins[team] !== hash) return reply({ error: "That's not this team's PIN" }, 403);
      box.pins[team] = hash;
      box.keepers[team] = { players, by, at: new Date().toISOString() };
      return save(env, box);
    }

    // Draft-date votes
    if (body.vote != null) {
      const id = clean(body.vote, 40), name = clean(body.name, 24);
      if (!id || !name) return reply({ error: "Need vote (the option id) and name" }, 400);
      const list = (box.votes[id] || []).filter(n => n.toLowerCase() !== name.toLowerCase());
      if (body.on !== false) list.push(name);
      if (list.length) box.votes[id] = list; else delete box.votes[id];
      return save(env, box);
    }
    return reply({ error: "Send team and players, a vote, or an admin request" }, 400);
  },
};

const view = (box) => ({ keepers: box.keepers, votes: box.votes, lock: box.meta.lock || "" });

async function sha(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("yoenis-box:" + s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Writes only the keys that changed.
async function save(env, box) {
  const text = {};
  for (const k of KEYS) text[k] = JSON.stringify(box[k]);
  if (KEYS.reduce((n, k) => n + text[k].length, 0) > MAX_BYTES) return reply({ error: "The box is full" }, 413);
  for (const k of KEYS) if (text[k] !== box.raw[k]) await env.BOX.put(k, text[k]);
  return reply(view(box));
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
