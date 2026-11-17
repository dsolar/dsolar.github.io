"""IDP files for Draft Lab (tools/fantasykit_data.py nfl_idp): Sleeper's defenders, folded into DL/LB/DB, with their
IDP points in the pts_* columns, and each week's lines in the short IDP_WEEK_COLS list."""
import json, os, pathlib, sys, tempfile, unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools"))
import fantasykit_data as K  # noqa: E402


def row(pid, pos, stats, team="BUF"):
    return {"player_id": pid, "team": team, "player": {"first_name": "Def", "last_name": pid, "position": pos}, "stats": stats}


BIG = {"idp_tkl_solo": 60, "idp_tkl_ast": 20, "idp_sack": 4, "idp_int": 1, "gp": 10}


class Idp(unittest.TestCase):
    def test_points_and_positions(self):
        self.assertEqual(K.idp_pts({"idp_tkl_solo": 2, "idp_tkl_ast": 2, "idp_sack": 1, "idp_int": 1}), 2 + 1 + 2 + 3)
        self.assertEqual(K.idp_pos({"position": "OLB"}), "LB")
        self.assertEqual(K.idp_pos({"position": "SS"}), "DB")
        self.assertEqual(K.idp_pos({"position": "EDGE"}), "DL")
        self.assertEqual(K.idp_pos({"position": "X", "fantasy_positions": ["DB"]}), "DB")
        self.assertIsNone(K.idp_pos({"position": "WR"}))
        line = K.idp_line({"idp_tkl_solo": 5, "idp_sack": 1, "gp": 1})
        self.assertEqual(len(line), len(K.NFL_COLS))
        for c in ("pts_std", "pts_half_ppr", "pts_ppr"):
            self.assertEqual(line[K.NFL_COLS.index(c)], 7)
        self.assertEqual(line[K.NFL_COLS.index("idp_tkl_solo")], 5)
        self.assertLess(K.NFL_COLS.index("yds_allow"), K.NFL_COLS.index("idp_tkl_solo"), "the live feed's columns stay in front")

    def test_files(self):
        d = tempfile.mkdtemp()
        data = os.path.join(d, "fantasy-kit", "data")
        os.makedirs(data)
        with open(os.path.join(data, "weeks-nfl.json"), "w") as f:
            json.dump({"season": "2026", "weeks": {"1": {"start": "2026-09-08", "end": "2026-09-14", "final": True, "lines": {}},
                                                   "2": {"start": "2026-09-15", "end": "2026-09-21", "final": False, "lines": {}}}}, f)
        season_rows = [row(f"d{i}", ["DE", "LB", "CB"][i % 3], BIG) for i in range(120)] + [row("bench", "S", {"idp_tkl_ast": 2}), row("wr", "WR", BIG)]

        def fake(url):
            if "/stats/nfl/2026/" in url:
                return [row("d0", "DE", {"idp_tkl_solo": 3, "idp_sack": 1, "gp": 1}), row("bench", "S", {"idp_tkl_ast": 2, "gp": 1})]
            if "/stats/nfl/2026?" in url:
                return season_rows
            return []
        old = (K.ROOT, K.OUT, K.get)
        K.ROOT, K.OUT, K.get = d, data, fake
        try:
            K.nfl_idp(2026, {"week": 0, "season_type": "regular"})
        finally:
            K.ROOT, K.OUT, K.get = old
        with open(os.path.join(data, "nfl-idp.json")) as f:
            pool = json.load(f)
        ids = {p["id"] for p in pool["players"]}
        self.assertIn("d0", ids)
        self.assertNotIn("bench", ids, "a defender without real IDP points stays out")
        self.assertNotIn("wr", ids, "an offensive player isn't a defender")
        d0 = next(p for p in pool["players"] if p["id"] == "d0")
        self.assertEqual(d0["pos"], ["DL"])
        self.assertEqual(d0["l"]["tot"][K.NFL_COLS.index("pts_half_ppr")], 60 + 10 + 8 + 3)
        self.assertEqual(pool["lines"]["tot"]["cols"], K.NFL_COLS)
        with open(os.path.join(data, "weeks-nfl-idp.json")) as f:
            wk = json.load(f)
        self.assertEqual(wk["cols"], K.IDP_WEEK_COLS)
        self.assertEqual(wk["weeks"]["1"]["final"], True)
        self.assertEqual(wk["weeks"]["1"]["lines"]["d0"][:3], [1, 5, 5])
        self.assertNotIn("bench", wk["weeks"]["1"]["lines"], "weeks carry the pool's defenders only")


if __name__ == "__main__":
    unittest.main()
