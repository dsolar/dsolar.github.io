"""CFBD parsing and closing-line grading for the College Football Hub (tools/cfbd_pull.py, tools/cfb_extras.py)."""
import pathlib, sys, unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools"))
import cfbd_pull as C  # noqa: E402
import cfb_extras as E  # noqa: E402


class Lines(unittest.TestCase):
    def test_home_favorite_becomes_a_positive_home_margin(self):
        rows = [{"id": 401, "lines": [{"provider": "Bovada", "spread": -3, "spreadOpen": -2.5},
                                      {"provider": "DraftKings", "spread": -7.5, "spreadOpen": -6, "overUnder": 51.5, "overUnderOpen": 50}]}]
        got = C.parse_lines(rows)["401"]
        self.assertEqual(got["book"], "DraftKings")
        self.assertEqual(got["close"], 7.5)
        self.assertEqual(got["open"], 6)
        self.assertEqual(got["total"], 51.5)

    def test_games_without_numbers_are_skipped(self):
        self.assertEqual(C.parse_lines([{"id": 1, "lines": [{"provider": "X", "spread": None, "spreadOpen": None}]}]), {})


class Grading(unittest.TestCase):
    def test_against_the_close_and_closing_line_value(self):
        # Hub had the home team by 10; opened 6, closed 8 (moved toward the hub); home won by 9
        ent = {"spread": 10, "open": 6, "close": 8, "final": [30, 21]}
        E.grade_close(ent)
        self.assertEqual(ent["atsClose"], "win")
        self.assertEqual(ent["clv"], 2.0)

    def test_market_moving_away_is_negative_and_a_push_is_a_push(self):
        ent = {"spread": -3, "open": 1, "close": 3, "final": [24, 21]}  # hub liked the road team; market moved to the home team
        E.grade_close(ent)
        self.assertEqual(ent["clv"], -2.0)
        self.assertEqual(ent["atsClose"], "push")


class Teams(unittest.TestCase):
    def test_advanced_and_sp_join_by_espn_id(self):
        ids = {"Georgia": "61"}
        adv = C.parse_advanced([{"team": "Georgia", "offense": {"ppa": 0.31, "successRate": 0.49, "passingPlays": {"ppa": 0.4}}, "defense": {"ppa": 0.05, "havoc": {"total": 0.2}}},
                                {"team": "Unknown", "offense": {}, "defense": {}}], ids)
        self.assertEqual(list(adv), ["61"])
        self.assertEqual(adv["61"]["off"]["epa"], 0.31)
        self.assertEqual(adv["61"]["def"]["havoc"], 0.2)
        sp = C.parse_sp([{"team": "Georgia", "rating": 27.44, "ranking": 1, "offense": {"rating": 40.1, "ranking": 3}, "defense": {"rating": 12.7, "ranking": 2}}], ids)
        self.assertEqual(sp["61"]["rating"], 27.4)
        self.assertEqual(sp["61"]["defRank"], 2)


if __name__ == "__main__":
    unittest.main()
