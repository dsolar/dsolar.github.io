#!/usr/bin/env python3
"""Baseball Savant (Statcast) for the MLB Hub: a few public leaderboard CSVs (add &csv=true to a leaderboard's
address), joined by MLB's own player ids (the hub's player ids too), written small to mlb/data/savant.json.

Batters: percentile ranks, expected stats (xBA, xSLG, xwOBA against the real thing), exit velocity and barrels, bat
tracking, sprint speed, outs above average and swing/take run values. Pitchers: percentile ranks, expected stats with
xERA, and each pitch in the arsenal (usage, run value, whiff rate, expected wOBA). A failed download keeps that part
of the last good file, so one bad endpoint doesn't blank the page."""
import csv, io, json, os, sys, time, datetime, urllib.request

B = "https://baseballsavant.mlb.com"
OUT = "mlb/data/savant.json"
now = datetime.date.today()
YEAR = int(os.environ.get("SAVANT_YEAR") or (now.year if now.month >= 3 else now.year - 1))
UA = {"User-Agent": "Mozilla/5.0 (davidsolar.dev MLB Hub; daily leaderboard pull)"}

URLS = {
    "xbat": f"{B}/leaderboard/expected_statistics?type=batter&year={YEAR}&position=&team=&min=q&csv=true",
    "xpit": f"{B}/leaderboard/expected_statistics?type=pitcher&year={YEAR}&position=&team=&min=q&csv=true",
    "pbat": f"{B}/leaderboard/percentile-rankings?type=batter&year={YEAR}&csv=true",
    "ppit": f"{B}/leaderboard/percentile-rankings?type=pitcher&year={YEAR}&csv=true",
    "bat": f"{B}/leaderboard/bat-tracking?year={YEAR}&csv=true",
    "ev": f"{B}/leaderboard/statcast?type=batter&year={YEAR}&position=&team=&min=q&csv=true",
    "ars": f"{B}/leaderboard/pitch-arsenal-stats?type=pitcher&pitchType=&year={YEAR}&team=&min=10&csv=true",
    "sw": f"{B}/leaderboard/swing-take?year={YEAR}&team=&leverage=Neutral&group=Batter&type=All&sub_type=null&min=q&csv=true",
    "spd": f"{B}/leaderboard/sprint_speed?year={YEAR}&position=&team=&min=10&csv=true",
    "oaa": f"{B}/leaderboard/outs_above_average?type=Fielder&year={YEAR}&team=&range=year&min=q&pos=&roles=&viz=show&csv=true",
}


def get(url):
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                text = r.read().decode("utf-8-sig")
            rows = list(csv.DictReader(io.StringIO(text)))
            if rows:
                return rows
        except Exception as e:  # noqa: BLE001
            print("  retry", i + 1, url, e, file=sys.stderr)
        time.sleep(3 * (i + 1))
    return None


def num(v, d=3):
    try:
        x = float(str(v).replace("%", ""))
    except (TypeError, ValueError):
        return None
    return round(x, d) if d else int(round(x))


def pid(r):
    return str(r.get("player_id") or r.get("id") or "").strip()


old = {}
if os.path.exists(OUT):
    try:
        old = json.load(open(OUT))
    except Exception:  # noqa: BLE001
        old = {}

got, failed = {}, []
for k, u in URLS.items():
    rows = get(u)
    print(f"{k}: {len(rows) if rows else 'FAILED'}")
    if rows is None:
        failed.append(k)
    got[k] = rows

if all(v is None for v in got.values()):
    print("Savant didn't answer; keeping the last file.")
    sys.exit(0)

bat, pit = {}, {}
B_ = lambda i: bat.setdefault(i, {})
P_ = lambda i: pit.setdefault(i, {})
PCT_B = ["xwoba", "xba", "xslg", "brl_percent", "exit_velocity", "max_ev", "hard_hit_percent", "k_percent", "bb_percent", "whiff_percent", "chase_percent", "bat_speed", "squared_up_rate", "sprint_speed", "oaa", "arm_strength"]
PCT_P = ["xwoba", "xba", "xslg", "xera", "brl_percent", "exit_velocity", "hard_hit_percent", "k_percent", "bb_percent", "whiff_percent", "chase_percent", "fb_velocity", "fb_spin", "curve_spin"]


def name(r):
    n = r.get("last_name, first_name") or r.get("player_name") or r.get("name") or ""
    if "," in n:
        last, first = [s.strip() for s in n.split(",", 1)]
        return f"{first} {last}"
    return n


def section(key, fn):
    """Fill from this download, or keep last time's piece of it if the download failed."""
    if got.get(key) is not None:
        for r in got[key]:
            i = pid(r)
            if i:
                fn(i, r)
    else:
        for side, store in (("bat", bat), ("pit", pit)):
            for i, d in (old.get(side) or {}).items():
                for f in KEEP.get(key, []):
                    if f in d:
                        store.setdefault(i, {})[f] = d[f]


KEEP = {"xbat": ["n", "x"], "xpit": ["n", "x"], "pbat": ["pct"], "ppit": ["pct"], "bat": ["bt"], "ev": ["ev"], "ars": ["ars", "t"], "sw": ["sw"], "spd": ["spd"], "oaa": ["oaa"]}

# expected stats: [PA, BA, xBA, SLG, xSLG, wOBA, xwOBA] (+ ERA, xERA for pitchers)
section("xbat", lambda i, r: B_(i).update(n=name(r), x=[num(r["pa"], 0), num(r["ba"]), num(r["est_ba"]), num(r["slg"]), num(r["est_slg"]), num(r["woba"]), num(r["est_woba"])]))
section("xpit", lambda i, r: P_(i).update(n=name(r), x=[num(r["pa"], 0), num(r["ba"]), num(r["est_ba"]), num(r["slg"]), num(r["est_slg"]), num(r["woba"]), num(r["est_woba"]), num(r.get("era"), 2), num(r.get("xera"), 2)]))


def pcts(store, fields):
    def f(i, r):
        d = {k: num(r.get(k), 0) for k in fields if num(r.get(k), 0) is not None}
        if d:
            store(i).update(pct=d)
            store(i).setdefault("n", name(r))
    return f


section("pbat", pcts(B_, PCT_B))
section("ppit", pcts(P_, PCT_P))
# bat tracking: [bat speed, swing length, squared up per swing, blast per swing, hard swing rate, whiff per swing]
section("bat", lambda i, r: B_(i).update(bt=[num(r["avg_bat_speed"], 1), num(r["swing_length"], 2), num(r["squared_up_per_swing"]), num(r["blast_per_swing"]), num(r["hard_swing_rate"]), num(r["whiff_per_swing"])]))
# batted balls: [avg EV, max EV, sweet spot %, barrel %, barrels per PA, 95+ mph %, avg launch angle]
section("ev", lambda i, r: B_(i).update(ev=[num(r["avg_hit_speed"], 1), num(r["max_hit_speed"], 1), num(r["anglesweetspotpercent"], 1), num(r["brl_percent"], 1), num(r["brl_pa"], 1), num(r["ev95percent"], 1), num(r["avg_hit_angle"], 1)]))
# swing/take run values: [all, heart, shadow, chase, waste]
section("sw", lambda i, r: B_(i).update(sw=[num(r["runs_all"], 1), num(r["runs_heart"], 1), num(r["runs_shadow"], 1), num(r["runs_chase"], 1), num(r["runs_waste"], 1)]))
section("spd", lambda i, r: B_(i).update(spd=[num(r["sprint_speed"], 1), num(r["hp_to_1b"], 2)]))
section("oaa", lambda i, r: B_(i).update(oaa=[r.get("primary_pos_formatted") or "", num(r["outs_above_average"], 0), num(r["fielding_runs_prevented"], 0)]))


# arsenal: each pitch [type, name, usage %, run value per 100, run value, whiff %, put away %, xwOBA, hard hit %, pitches]
def ars(i, r):
    d = P_(i)
    d.setdefault("n", name(r))
    d["t"] = r.get("team_name_alt") or d.get("t")
    d.setdefault("ars", []).append([r["pitch_type"], r["pitch_name"], num(r["pitch_usage"], 1), num(r["run_value_per_100"], 1), num(r["run_value"], 0), num(r["whiff_percent"], 1), num(r["put_away"], 1), num(r["est_woba"]), num(r["hard_hit_percent"], 1), num(r["pitches"], 0)])


section("ars", ars)
for d in pit.values():
    if "ars" in d:
        d["ars"].sort(key=lambda a: -(a[2] or 0))

out = {"season": YEAR, "pulled": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%MZ"), "failed": failed, "bat": bat, "pit": pit}
json.dump(out, open(OUT, "w"), separators=(",", ":"))
print(f"wrote {OUT}: {len(bat)} batters, {len(pit)} pitchers, {os.path.getsize(OUT) // 1024} KB" + (f"; kept last time's {', '.join(failed)}" if failed else ""))
