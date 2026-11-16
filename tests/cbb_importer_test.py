import importlib.util,pathlib,unittest
P=pathlib.Path(__file__).resolve().parents[1]/"tools/cbb_build.py"
spec=importlib.util.spec_from_file_location("cbb_build",P);B=importlib.util.module_from_spec(spec);spec.loader.exec_module(B)
class ImporterTests(unittest.TestCase):
 def test_sentinel_values_are_not_real_team_performance(self):
  self.assertIsNone(B.number("-999",True));self.assertIsNone(B.number("999.0000",True));self.assertEqual(B.number("0",True),0);self.assertIsNone(B.number("NaN"))
 def test_roster_statistics_keep_zero_and_leave_absent_metrics_missing(self):
  team={"id":"150","short":"Duke","conference":"ACC","season":2027}
  d={"season":{"year":2027},"positionGroups":[{"athletes":[{"id":"1","displayName":"A Player","position":{"abbreviation":"G"},"statistics":{"splits":{"categories":[{"stats":[{"name":"avgPoints","value":0},{"name":"avgAssists","value":4}]}]}}}]}]}
  ps,_,_=B.parse_roster(d,team);self.assertEqual(ps[0]["stats"]["pts"],0);self.assertEqual(ps[0]["stats"]["ast"],4);self.assertIsNone(ps[0]["stats"]["min"])
 def test_the_roster_cannot_silently_cross_seasons(self):
  with self.assertRaises(ValueError):B.parse_roster({"season":{"year":2026}},{"season":2027})
 def test_bracket_rejects_an_incomplete_or_unmatched_field(self):
  import xml.etree.ElementTree as E
  with self.assertRaises(ValueError):B.parse_march(E.fromstring('<mydata><bk s1_1="Unknown"/></mydata>'),{},"2026-11-15")
if __name__=="__main__":unittest.main()
