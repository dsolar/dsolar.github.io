#!/usr/bin/env python3
"""Check public college basketball feeds from the same runners used by the hub."""
import concurrent.futures, datetime, json, pathlib, re, urllib.request, urllib.parse
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/"tools/cbb_sources"
OUT.mkdir(parents=True, exist_ok=True)
now=datetime.datetime.now(datetime.timezone.utc)
year=now.year+(now.month>=7)
day=now.strftime("%Y%m%d")
urls={
 "torvik_teams":f"https://barttorvik.com/{year}_team_results.json",
 "torvik_players":f"https://barttorvik.com/getadvstats.php?year={year}&csv=1",
 "haslam":"https://haslametrics.com/ratings.php",
 "teams": "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?limit=1000",
 "standings":f"https://site.api.espn.com/apis/v2/sports/basketball/mens-college-basketball/standings?season={year}&group=50",
 "games":f"https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates={day}&groups=50&limit=1000",
 "duke_stats":f"https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams/150/statistics?season={year}",
 "duke_roster":f"https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams/150/roster?season={year}",
}
def one(item):
 key,url=item
 try:
  req=urllib.request.Request(url,headers={"User-Agent":"DavidSolarCollegeHub/1.0 (+https://davidsolar.dev/)", "Accept":"application/json,text/plain,text/html"})
  with urllib.request.urlopen(req,timeout=30) as r: body=r.read().decode("utf-8-sig"); status=r.status
  (OUT/(key+".txt")).write_text(body)
  try:
   d=json.loads(body); sample=d[:2] if isinstance(d,list) else {k:v if k in ["status","season"] else (v[:1] if isinstance(v,list) else v) for k,v in d.items()}
   kind="json"
  except Exception: sample=body[:1200];kind="text"
  extra={}
  if key=="haslam":
   extra["scripts"]=re.findall(r'<script[^>]+src=["\x27]([^"\x27]+)',body,re.I)
   extra["references"]=re.findall(r'.{0,90}(?:\.xml|XMLHttpRequest|\.json|loadXML|\.js).{0,140}',body)[:35]
  return key,{"url":url,"status":status,"kind":kind,"bytes":len(body),"sample":sample,**extra}
 except Exception as e: return key,{"url":url,"error":str(e)}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: results=dict(pool.map(one,urls.items()))
summary={"season":year,"updated":now.isoformat(),"sources":results}
(ROOT/"tools/cbb_source_probe.json").write_text(json.dumps(summary))
print(json.dumps({k:{x:v for x,v in d.items() if x not in ["sample"]} for k,d in results.items()},indent=2))
