// Draft Lab's username sign-in: POST /functions/v1/fk-login
//   { action: "login", login, password }   login is a username or an email; returns Supabase's session tokens
//   { action: "reset", login, redirect }   emails a password reset link (always says it did, so nobody can probe for accounts)
// A username turns into the account's email here, with the service role (fk_login_email), so emails never reach the page.
const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, apikey, content-type, x-client-info", "access-control-allow-methods": "POST, OPTIONS" };
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
// only send people back to the site itself
const SITES = [/^https:\/\/(www\.)?davidsolar\.dev\//, /^https:\/\/dsolar\.github\.io\//, /^http:\/\/localhost(:\d+)?\//];

async function emailFor(login: string): Promise<string | null> {
  login = login.trim();
  if (login.includes("@")) return login;
  if (!/^[A-Za-z0-9_.-]{3,20}$/.test(login)) return null;
  const r = await fetch(`${URL_}/rest/v1/rpc/fk_login_email`, {
    method: "POST", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_username: login }),
  });
  if (!r.ok) return null;
  const e = await r.json();
  return typeof e === "string" && e ? e : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return out({ error: "Use POST." }, 405);
  let b: { action?: string; login?: string; password?: string; redirect?: string };
  try { b = await req.json(); } catch { return out({ error: "Bad request." }, 400); }
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const fwd = ip ? { "X-Forwarded-For": ip } : {};
  const login = String(b.login || "").slice(0, 120);

  if (b.action === "login") {
    const password = String(b.password || "");
    if (!login || !password) return out({ error: "Enter your username and password." }, 400);
    const email = await emailFor(login);
    if (!email) return out({ error: "Wrong username or password." }, 400);
    const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: ANON, "Content-Type": "application/json", ...fwd }, body: JSON.stringify({ email, password }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return out({ access_token: j.access_token, refresh_token: j.refresh_token, expires_in: j.expires_in });
    const msg = String(j.msg || j.error_description || j.message || "");
    if (r.status === 429) return out({ error: "Too many tries. Wait a minute and try again." }, 429);
    if (/not confirmed/i.test(msg)) return out({ error: "Confirm your email first: tap the link we sent when you made the account." }, 400);
    return out({ error: "Wrong username or password." }, 400);
  }

  if (b.action === "reset") {
    const back = String(b.redirect || "");
    const email = await emailFor(login);
    if (email && SITES.some((re) => re.test(back))) {
      await fetch(`${URL_}/auth/v1/recover?redirect_to=${encodeURIComponent(back)}`, {
        method: "POST", headers: { apikey: ANON, "Content-Type": "application/json", ...fwd }, body: JSON.stringify({ email }),
      }).catch(() => null);
    }
    return out({ ok: true });
  }
  return out({ error: "Unknown action." }, 400);
});
