// Supabase edge function "yoenis-sheet": the keeper sheet's live copy of the keepers and draft-date votes that
// teams save on davidsolar.dev/yoenis/, as CSV. The data lives in Supabase (tools/yoenis-supabase.sql).
//
// In the Fantasy Keepers sheet, cell A1 of a tab:
//   "2027" tab:             =IMPORTDATA("https://<project>.supabase.co/functions/v1/yoenis-sheet?y=2027&tab=keepers")
//   "2027 Draft Vote" tab:  =IMPORTDATA("https://<project>.supabase.co/functions/v1/yoenis-sheet?y=2027&tab=vote")
// Google refreshes IMPORTDATA about once an hour. Deployed with JWT verification off so the sheet can read it.

Deno.serve(async (req: Request) => {
  const u = new URL(req.url);
  const y = parseInt(u.searchParams.get("y") || "2027", 10);
  const tab = u.searchParams.get("tab") === "vote" ? "vote" : "keepers";
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  const r = await fetch(`${base}/rest/v1/rpc/yoenis_sheet_rows`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_y: y, p_tab: tab }),
  });
  if (!r.ok) return new Response("The keeper database didn't answer.\n", { status: 502, headers: { "Content-Type": "text/plain" } });
  const rows: unknown[][] = await r.json();
  const cell = (c: unknown) => (typeof c === "number" ? String(c) : '"' + String(c ?? "").replace(/"/g, '""') + '"');
  const csv = rows.map((row) => row.map(cell).join(",")).join("\n") + "\n";
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" } });
});
