"""tools/cbb_net.py: reading the NCAA's NET table and matching its school names to the hub's teams."""
import datetime as dt
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "tools"))
import cbb_net as N  # noqa: E402

HTML = """<p>Through Games Dec. 1, 2026</p><table><thead><tr><th>Rank</th><th>School</th><th>Record</th><th>Conf</th><th>Road</th>
<th>Neutral</th><th>Home</th><th>Prev</th><th>Quad 1</th><th>Quad 2</th><th>Quad 3</th><th>Quad 4</th></tr></thead><tbody>
<tr><td>1</td><td>Houston</td><td>6-0</td><td>Big 12</td><td>1-0</td><td>2-0</td><td>3-0</td><td>3</td><td>2-0</td><td>1-0</td><td>1-0</td><td>2-0</td></tr>
<tr><td>2</td><td>Saint Mary&#39;s (CA)</td><td>6-1</td><td>WCC</td><td>0-1</td><td>2-0</td><td>4-0</td><td></td><td>0-1</td><td>2-0</td><td>1-0</td><td>3-0</td></tr>
</tbody></table>"""


class NetTest(unittest.TestCase):
    def test_html_table(self):
        rows, through = N.parse(HTML)
        self.assertEqual(through, dt.date(2026, 12, 1))
        self.assertEqual([r["rank"] for r in rows], [1, 2])
        self.assertEqual(rows[1]["school"], "Saint Mary's (CA)")
        self.assertEqual(rows[0]["q"], ["2-0", "1-0", "1-0", "2-0"])
        self.assertEqual(rows[0]["prev"], 3)
        self.assertIsNone(rows[1]["prev"])

    def test_mirror_json(self):
        rows, _ = N.parse('{"updated":"Through Games Dec. 1, 2026","data":[{"Rank":"1","School":"Houston","Record":"6-0","Quad 1":"2-0"}]}')
        self.assertEqual(rows[0]["school"], "Houston")
        self.assertEqual(rows[0]["q"][0], "2-0")

    def test_keys_spell_out_ncaa_abbreviations(self):
        self.assertIn("michiganstate", N.keys("Michigan St."))
        self.assertIn("floridaatlantic", N.keys("Fla. Atlantic"))
        self.assertIn("saintmarys", N.keys("Saint Mary's (CA)"))
        self.assertIn("boston", N.keys("Boston U."))
        self.assertIn("texasamcc", N.keys("Texas A&M-CC"))


if __name__ == "__main__":
    unittest.main()
