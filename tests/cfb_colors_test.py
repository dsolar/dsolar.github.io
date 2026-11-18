"""The catalog must supply school colors when FPI omits them, and preserve them during an outage."""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools"))
import cfb_build as C


class Colors(unittest.TestCase):
    def test_catalog_colors_override_the_fpi_fallback_and_match_by_id(self):
        teams = {"61": {"color": "#002244"}, "99": {"color": "#002244"}}
        catalog = {"sports": [{"leagues": [{"teams": [
            {"team": {"id": "61", "color": "BA0C2F"}},
            {"team": {"id": "99", "color": "not-a-color"}},
        ]}]}]}
        self.assertEqual(C.apply_team_colors(teams, catalog), 1)
        self.assertEqual(teams["61"]["color"], "#ba0c2f")
        self.assertEqual(teams["99"]["color"], "#002244")

    def test_prior_verified_colors_survive_a_missing_catalog(self):
        teams = {"61": {"color": "#002244"}}
        C.apply_team_colors(teams, {}, [{"id": "61", "color": "#ba0c2f"}])
        self.assertEqual(teams["61"]["color"], "#ba0c2f")


if __name__ == "__main__":
    unittest.main()
