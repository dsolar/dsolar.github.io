#!/usr/bin/env python3
"""Build the College Basketball Hub from attributed public Haslametrics and ESPN feeds.
Rosters are refreshed once a day; ratings and game snapshots on each run. A failed
source retains its last successful data with its original timestamp.
"""
import argparse, concurrent.futures, datetime as dt, gzip, json, math, pathlib, re, sys, time, unicodedata, urllib.request, zlib
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

ROOT=pathlib.Path(__file__).resolve().parents[1]
DATA=ROOT/"cbb/data/hub.json"
PREV=ROOT/"cbb/data/prev.json"
UA="Mozilla/5.0 (compatible; davidsolar-cbb/1.0; +https://davidsolar.dev/cbb/)"
Q="region=us&lang=en&contentorigin=espn"
WEB="https://site.web.api.espn.com"
NY=ZoneInfo("America/New_York")

def read(p,default=None):
 try:return json.loads(p.read_text())
 except (OSError,ValueError):return default

def number(x,sentinel=False):
 if x is None or str(x).strip() in ("","-","--"):return None
 try:
  n=float(str(x).replace(",","").replace("%",""))
  return None if not math.isfinite(n) or (sentinel and abs(n)>=900) else n
 except (TypeError,ValueError):return None

def norm(s):
 return re.sub(r"[^a-z0-9]","",unicodedata.normalize("NFKD",s or "").encode("ascii","ignore").decode().lower().replace("&","and"))

def pct(a,b):
 return round(a/b*100,2) if a is not None and b is not None and b>0 else None

def decode_body(raw,encoding="",charset=None):
 for enc in reversed([x.strip().lower() for x in encoding.split(",") if x.strip()]):
  if enc=="gzip":raw=gzip.decompress(raw)
  elif enc=="deflate":
   try:raw=zlib.decompress(raw)
   except zlib.error:raw=zlib.decompress(raw,-zlib.MAX_WBITS)
  elif enc=="br":
   import brotli
   raw=brotli.decompress(raw)
  elif enc!="identity":raise ValueError("Unsupported content encoding: "+enc)
 # Some caches omit the gzip header even though the payload is compressed.
 if raw.startswith(b"\x1f\x8b"):raw=gzip.decompress(raw)
 return raw.decode(charset or "utf-8-sig")

def get(url):
 req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept":"text/html,application/json","Accept-Encoding":"identity"})
 with urllib.request.urlopen(req,timeout=25) as r:
  raw=r.read();encoding=r.headers.get("Content-Encoding","");charset=r.headers.get_content_charset()
  try:return decode_body(raw,encoding,charset)
  except Exception as e:raise ValueError(f"Response decode failed ({encoding or 'identity'}, {charset or 'utf-8'}, prefix={raw[:6].hex()}): {e}") from e

def source_get(key,url,seed=False):
 p=ROOT/f"tools/cbb_sources/{key}.txt"
 if seed and p.exists():return p.read_text()
 return get(url)

def statmap(categories):
 return {s.get("name"):number(s.get("value")) for c in categories for s in c.get("stats",[]) if s.get("name")}

def first_num(d,*keys):
 return next((d[k] for k in keys if d.get(k) is not None),None)

def parse_roster(d,t):
 if d.get("season",{}).get("year") not in (None,t["season"]):raise ValueError("Roster season mismatch")
 found={}
 for group in d.get("positionGroups",[]):
  for a in group.get("athletes",[]):
   aid=str(a.get("id",""))
   if not aid or not a.get("displayName"):continue
   member=[str(x["id"]) for x in a.get("teams",[]) if x.get("id")]
   if member and t["id"] not in member:continue
   v=statmap(a.get("statistics",{}).get("splits",{}).get("categories",[]))
   stats={k:first_num(v,*ks) for k,ks in {
    "gp":["gamesPlayed","totalGamesPlayed"],"min":["avgMinutes"],"pts":["avgPoints"],"reb":["avgRebounds"],
    "ast":["avgAssists"],"stl":["avgSteals"],"blk":["avgBlocks"],"fgPct":["fieldGoalPct"],"threePct":["threePointFieldGoalPct"],
    "threeAtt":["avgThreePointFieldGoalsAttempted"],"ftPct":["freeThrowPct"],"tov":["avgTurnovers"],"ts":["trueShootingPct"],
   }.items()}
   found[aid]={"id":aid,"name":a["displayName"],"teamId":t["id"],"team":t["short"],"conference":t["conference"],
    "pos":a.get("position",{}).get("abbreviation",""),"year":a.get("experience",{}).get("displayValue",""),
    "height":a.get("displayHeight"),"weight":a.get("displayWeight"),"jersey":a.get("jersey"),
    "head":a.get("headshot",{}).get("href"),"stats":stats,"source":"ESPN team roster statistics",
    "url":next((x["href"] for x in a.get("links",[]) if "stats" in x.get("rel",[]) and x.get("href","").startswith("https:")),None)}
 coaches=d.get("coach",[])
 return list(found.values())," · ".join(" ".join(filter(None,[c.get("firstName"),c.get("lastName")])) for c in coaches[:1]),d.get("team",{})

def bpi_columns(d):
 return {c["name"]:c.get("names",[]) for c in d.get("categories",[])}

def parse_bpi(d,year):
 if d.get("requestedSeason",{}).get("year") not in (None,year):raise ValueError("BPI season mismatch")
 columns=bpi_columns(d);teams={}
 for row in d.get("teams",[]):
  t=row["team"];tid=str(t["id"]);g=t.get("group",{});v={}
  for cat in row.get("categories",[]):v.update(dict(zip(columns.get(cat["name"],[]),cat.get("values",[]))))
  poll=next((x for x in t.get("ranks",{}).get("items",[]) if x.get("type")=="ap"),{})
  ap=number(poll.get("rank",{}).get("current"))
  teams[tid]={"id":tid,"name":t.get("displayName",t.get("nickname","")),"short":t.get("nickname") or t.get("shortDisplayName") or t.get("displayName"),
   "abbr":t.get("abbreviation",""),"season":year,"conference":g.get("shortName") or g.get("name"),"conferenceId":str(g.get("id","")),
   "conferenceName":g.get("name"),"logo":next((x["href"] for x in t.get("logos",[]) if "default" in x.get("rel",[])),None),
   "color":"#"+t.get("color","153d32").lstrip("#"),"bpiRank":number(v.get("bpirank")) or number(t.get("rankValue")),
   "apRank":ap if ap and ap<=25 else None,"sorRank":number(v.get("sorrank")),
   "metrics":{"bpi":number(v.get("bpi")),"bpiOff":number(v.get("bpioffense")),"bpiDef":number(v.get("bpidefense")),
    "confTitle":number(v.get("chancewinconfortie")),"sosRank":number(v.get("sospastrank")),"remainingSosRank":number(v.get("sosremrank"))},
   "record":{"w":number(v.get("wins")),"l":number(v.get("losses")),"cw":number(v.get("confwins")),"cl":number(v.get("conflosses"))},
   "projection":{"wins":number(v.get("projtotalwins")),"losses":number(v.get("projtotallosses")),"confWins":number(v.get("projconfwins")),"confLosses":number(v.get("projconflosses"))},
   "links":{r:x["href"] for x in t.get("links",[]) if x.get("href","").startswith("https:") for r in ["clubhouse","roster","schedule","stats"] if r in x.get("rel",[])}
  }
 if len(teams)<300:raise ValueError(f"Incomplete BPI pool ({len(teams)})")
 return teams

def parse_haslam(body,teams,year):
 root=ET.fromstring(body);stamp=root.find("dt")
 through=dt.datetime.strptime(stamp.get("md"),"%B %d, %Y").date() if stamp is not None else None
 if not through or not dt.date(year-1,7,1)<=through<dt.date(year,7,1):raise ValueError("Haslametrics season mismatch or missing date")
 byname={}
 for e in root.findall("mr"):
  a=e.attrib;tid=str(a.get("id",""));n=a.get("t","")
  t=teams.get(tid)
  if t is None:
   t=next((x for x in teams.values() if norm(x["short"])==norm(n) or x["abbr"]==a.get("abbr")),None)
  if t is None:continue
  byname[n]=t["id"];t["haslamName"]=n;t["haslamId"]=tid;t["haslamRank"]=number(a.get("rk"));t["change7"]=number(a.get("vs7"),True)
  t["metrics"].update({"adjO":number(a.get("oe")),"adjD":number(a.get("de")),"tempo":round((float(a["ou"])+float(a["du"]))/2,2),
   "momentum":number(a.get("mom"),True),"consistency":number(a.get("inc"),True),"away":number(a.get("afh"),True),"haslamSos":number(a.get("sos")),
   "threeShare":pct(number(a.get("otpar")),number(a.get("ofgar"))),"rimShare":pct(number(a.get("onpar")),number(a.get("ofgar"))),
   "threePct":pct(number(a.get("otpmr")),number(a.get("otpar"))),"oppThreePct":pct(number(a.get("dtpmr")),number(a.get("dtpar"))),
   "rimPct":pct(number(a.get("onpmr")),number(a.get("onpar"))),"allPlay":number(a.get("ap"))})
  t["haslamQuads"]={str(i):a.get(f"r_q{i}") for i in range(1,5)}
  t["haslamRecord"]={"w":number(a.get("w")),"l":number(a.get("l"))}
 for tr in root.findall("tr"):
  tid=byname.get(tr.get("t"));t=teams.get(tid)
  if t:t["history"]=[number(x) for x in tr.get("data","").split(",") if number(x) is not None]
 for tag,kind in [("sg","best"),("sb","worst"),("sr","latest")]:
  for e in root.findall(tag):
   a=e.attrib;t=teams.get(byname.get(a.get("t")))
   if t and a.get("r")=="1":t.setdefault("highlights",{})[kind]={"opponent":a.get("o"),"date":a.get("d"),"us":number(a.get("ts")),"them":number(a.get("os")),"venue":a.get("s"),"performance":number(a.get("e"))}
 return root,byname,through.isoformat()

def parse_march(root,byname,through):
 bk=root.find("bk")
 if bk is None:return None
 a=bk.attrib;slots=[];unmatched=[];al=[]
 for i in range(1,7):
  names=[a.get(f"sPI_{2*i-1}"),a.get(f"sPI_{2*i}")]
  seed=number(a.get(f"lblAP_{i}"))
  if seed is not None and all(n in byname for n in names):al.append({"seed":int(seed),"teamIds":[byname[n] for n in names],"opening":"At-large"})
  elif any(names):unmatched+=names
 for seed in range(1,17):
  vals=sorted([(int(k.rsplit("_",1)[1]),v) for k,v in a.items() if re.fullmatch(f"s{seed}_[0-9]+",k)],key=lambda x:x[0])
  names=[v for _,v in vals]
  if len(names)>4:
   direct=8-len(names)
   if direct<0:return None
   groups=[[n] for n in names[:direct]]+[names[i:i+2] for i in range(direct,len(names),2)]
   for ns in groups:
    if all(n in byname for n in ns):slots.append({"seed":seed,"teamIds":[byname[n] for n in ns],"opening":"Automatic qualifier" if len(ns)==2 else None})
    else:unmatched+=ns
  else:
   pairs=[x for x in al if x["seed"]==seed]
   for n in names:
    if n=="PLAY-IN WINNER":
     if pairs:slots.append(pairs.pop(0))
     else:unmatched.append(n)
    elif n in byname:slots.append({"seed":seed,"teamIds":[byname[n]],"opening":None})
    elif n:unmatched.append(n)
 ids=[x for s in slots for x in s["teamIds"]]
 if len(slots)!=64 or len(ids)!=76 or len(set(ids))!=76 or unmatched:raise ValueError(f"Bracket incomplete: {len(slots)} slots, {len(ids)} teams, missing {unmatched[:6]}")
 return {"source":"Haslametrics","kind":"deserves","updated":through,"fieldSize":76,"slots":slots,
  "firstOut":[byname[n] for i in range(1,9) if (n:=a.get(f"sOut{i}")) in byname],
  "note":"Haslametrics' algorithmic 'deserves' forecast emphasizes results and résumé. It is a projection, not the NCAA committee's bracket. Region groupings here are illustrative."}

def haslam_games(root,byname):
 games={}
 for e in root.findall("tg"):
  a=e.attrib;tid=byname.get(a.get("t"));oid=byname.get(a.get("o"))
  if not tid or not oid:continue
  day=dt.datetime.strptime(a["d"],"%m/%d/%Y").date().isoformat()
  m=re.search(r"(\d{1,2}:\d{2})\s*(am|pm)",a.get("tt",""),re.I);at=None
  if m:
   tm=dt.datetime.strptime(m.group(1)+m.group(2).upper(),"%I:%M%p").time()
   at=dt.datetime.combine(dt.date.fromisoformat(day),tm,NY).astimezone(dt.timezone.utc).isoformat()
  home,away=(tid,oid) if a.get("s")=="H" else (oid,tid)
  ident=f"{day}-{away}-{home}"
  games[ident]={"id":ident,"day":day,"at":at,"home":home,"away":away,"neutral":a.get("s")=="N","state":"pre","detail":"Schedule snapshot","homeScore":None,"awayScore":None,"tv":a.get("nw",""),"source":"Haslametrics schedule","url":"https://haslametrics.com/ratings.php"}
 return games

def parse_games(data,teams):
 out={}
 for e in data.get("events",[]):
  if e.get("season",{}).get("year") not in (None,next(iter(teams.values()))["season"]):continue
  c=(e.get("competitions") or [{}])[0];cs=c.get("competitors",[])
  h=next((x for x in cs if x.get("homeAway")=="home"),None);a=next((x for x in cs if x.get("homeAway")=="away"),None)
  if not h or not a or str(h["id"]) not in teams or str(a["id"]) not in teams:continue
  status=(c.get("status") or e.get("status",{})).get("type",{});at=e.get("date")
  day=dt.datetime.fromisoformat(at.replace("Z","+00:00")).astimezone(NY).date().isoformat()
  ident=f'{day}-{a["id"]}-{h["id"]}'
  state=status.get("state","pre")
  if re.search("postpon|cancel",status.get("description",""),re.I):state="off"
  out[ident]={"id":str(e["id"]),"day":day,"at":at,"home":str(h["id"]),"away":str(a["id"]),"neutral":bool(c.get("neutralSite")),"state":state,
   "detail":status.get("shortDetail") or status.get("detail") or "",
   "homeScore":number(h.get("score")) if state in ("post","in") else None,"awayScore":number(a.get("score")) if state in ("post","in") else None,
   "tv":", ".join(dict.fromkeys(n for b in c.get("broadcasts",[]) for n in b.get("names",[]))),
   "source":"ESPN scoreboard","url":next((l["href"] for l in e.get("links",[]) if "summary" in l.get("rel",[])),"https://www.espn.com/mens-college-basketball/scoreboard")}
 return out

SCHEDULE=ROOT/"cbb/data/schedule.json"

def parse_schedule(d,teams,year):
 """One team's ESPN season schedule: every game, with scores once final. Opponents outside Division I keep their name."""
 if d.get("season",{}).get("year") not in (None,year):raise ValueError("Schedule season mismatch")
 out,other={},{}
 for e in d.get("events",[]):
  c=(e.get("competitions") or [{}])[0];cs=c.get("competitors",[])
  h=next((x for x in cs if x.get("homeAway")=="home"),None);a=next((x for x in cs if x.get("homeAway")=="away"),None)
  if not h or not a or not e.get("date"):continue
  for x in (h,a):
   if str(x["id"]) not in teams:other[str(x["id"])]=(x.get("team") or {}).get("shortDisplayName") or (x.get("team") or {}).get("displayName") or "Non-D1"
  st=(c.get("status") or {}).get("type",{});state=st.get("state","pre")
  if re.search("postpon|cancel",st.get("description",""),re.I):state="off"
  score=lambda x:number((x.get("score") or {}).get("value") if isinstance(x.get("score"),dict) else x.get("score"))
  at=e["date"];day=dt.datetime.fromisoformat(at.replace("Z","+00:00")).astimezone(NY).date().isoformat()
  hid,aid=str(h["id"]),str(a["id"])
  conf=hid in teams and aid in teams and teams[hid].get("conference")==teams[aid].get("conference") and (e.get("seasonType") or {}).get("type",2)==2
  out[str(e["id"])]={"id":str(e["id"]),"day":day,"at":at if e.get("timeValid",True) else None,"home":hid,"away":aid,"neutral":bool(c.get("neutralSite")),"conf":bool(conf),
   "post":(e.get("seasonType") or {}).get("type")==3,"state":state,"hs":score(h) if state in ("in","post") else None,"as":score(a) if state in ("in","post") else None}
 return out,other

BYATH=["general","offensive","defensive"]
def parse_byathlete(d):
 """ESPN's season stat leaders feed, every Division I player who has appeared: per-game averages and totals."""
 names={c["name"]:c.get("names",[]) for c in d.get("categories",[])}
 out={}
 for row in d.get("athletes",[]):
  a=row.get("athlete",{});aid=str(a.get("id",""))
  if not aid:continue
  v={}
  for c in row.get("categories",[]):v.update(dict(zip(names.get(c.get("name"),[]),c.get("values",[]))))
  g=lambda k:number(v.get(k))
  pts,fga,fta=g("points"),g("fieldGoalsAttempted"),g("freeThrowsAttempted")
  ts=round(pts/(2*(fga+0.44*fta))*100,1) if pts is not None and fga is not None and fta is not None and fga+0.44*fta>0 else None
  efg=round((g("fieldGoalsMade")+0.5*g("threePointFieldGoalsMade"))/fga*100,1) if fga and g("fieldGoalsMade") is not None and g("threePointFieldGoalsMade") is not None else None
  out[aid]={"gp":g("gamesPlayed"),"min":g("avgMinutes"),"pts":g("avgPoints"),"reb":g("avgRebounds"),"ast":g("avgAssists"),"stl":g("avgSteals"),"blk":g("avgBlocks"),
   "tov":g("avgTurnovers"),"pf":g("avgFouls"),"fgm":g("avgFieldGoalsMade"),"fga":g("avgFieldGoalsAttempted"),"fgPct":g("fieldGoalPct"),
   "tpm":g("avgThreePointFieldGoalsMade"),"threeAtt":g("avgThreePointFieldGoalsAttempted"),"threePct":g("threePointFieldGoalPct"),
   "ftm":g("avgFreeThrowsMade"),"fta":g("avgFreeThrowsAttempted"),"ftPct":g("freeThrowPct"),"per":g("PER"),"dd":g("doubleDouble"),"ts":ts,"efg":efg,"teamId":str(a.get("teamId",""))}
 return out,d.get("pagination") or {}

def main():
 ap=argparse.ArgumentParser();ap.add_argument("--seed-cache",action="store_true");ap.add_argument("--rosters",action="store_true");args=ap.parse_args()
 now=dt.datetime.now(dt.timezone.utc);today=now.astimezone(NY).date();year=today.year+(today.month>=7);stamp=now.isoformat()
 old=read(DATA,{})
 if old.get("season")!=year:old={}
 sources=dict(old.get("sources",{}));errors=[];teams={}
 bpi_url=f"{WEB}/apis/fitt/v3/sports/basketball/mens-college-basketball/powerindex?{Q}&limit=1000&season={year}"
 try:
  bpi=json.loads(source_get("bpi",bpi_url,args.seed_cache));teams=parse_bpi(bpi,year)
  sources["bpi"]={"name":"ESPN BPI","status":"connected","url":"https://www.espn.com/mens-college-basketball/bpi","updated":bpi.get("lastUpdated") or stamp,"checked":stamp,"coverage":len(teams)}
 except Exception as e:
  errors.append("BPI: "+str(e));teams={t["id"]:dict(t) for t in old.get("teams",[])}
  if not teams:raise
  sources.setdefault("bpi",{})["error"]=str(e)
 # Preserve the prior analytical snapshot if this source fails on a later run.
 prior={t["id"]:t for t in old.get("teams",[])}
 root=None;byname={};through=None
 try:
  body=source_get("haslam_xml","https://haslametrics.com/ratings.xml",args.seed_cache)
  root,byname,through=parse_haslam(body,teams,year)
  count=sum(t.get("haslamRank") is not None for t in teams.values())
  if count<300:raise ValueError(f"Only {count} matched Haslametrics teams")
  sources["haslam"]={"name":"Haslametrics","status":"connected","url":"https://haslametrics.com/ratings.php","updated":through,"checked":stamp,"coverage":count}
 except Exception as e:
  errors.append("Haslametrics: "+str(e))
  for tid,t in teams.items():
   p=prior.get(tid,{})
   for k in ["haslamRank","haslamName","haslamId","change7","haslamQuads","haslamRecord","history","highlights"]:
    if k in p:t[k]=p[k]
   for k,v in p.get("metrics",{}).items():
    if k not in t["metrics"]:t["metrics"][k]=v
  sources.setdefault("haslam",{})["error"]=str(e)
 march=old.get("march")
 if root is not None:
  try:
   candidate=parse_march(root,byname,through)
   if not candidate:raise ValueError("Bracket not published")
   march=candidate
  except Exception as e:errors.append("Bracket: "+str(e))
 games=haslam_games(root,byname) if root is not None else {}
 for g in old.get("games",[]):
  if g["day"]>= (today-dt.timedelta(days=3)).isoformat():
   ident=f'{g["day"]}-{g["away"]}-{g["home"]}'
   if g.get("source")=="ESPN scoreboard" or ident not in games:games[ident]=g
 board_errors=[]
 days=[today-dt.timedelta(days=1),today,today+dt.timedelta(days=1)]
 def board(day):
  url=f"{WEB}/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?{Q}&dates={day:%Y%m%d}&groups=50&limit=1000"
  try:return parse_games(json.loads(get(url)),teams)
  except Exception as e:board_errors.append(str(e));return {}
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
  for rows in pool.map(board,days):games.update(rows)
 sources["games"]={"name":"ESPN game snapshots","status":"connected" if len(board_errors)<3 else "unavailable","url":"https://www.espn.com/mens-college-basketball/scoreboard","updated":stamp if len(board_errors)<3 else old.get("sources",{}).get("games",{}).get("updated"),"checked":stamp,"coverage":sum(g.get("source")=="ESPN scoreboard" for g in games.values())}
 players=old.get("players",[]);psource=old.get("sources",{}).get("players",{});pstamp=psource.get("updated")
 try:age=(now-dt.datetime.fromisoformat(pstamp.replace("Z","+00:00"))).total_seconds()/3600 if pstamp else 1e6
 except (ValueError,TypeError):age=1e6
 if not players or args.rosters or age>=20:
  all_players=[];failures=[];coaches={};colors={}
  def roster(t):
   try:
    url=f'{WEB}/apis/common/v3/sports/basketball/mens-college-basketball/teams/{t["id"]}/roster?{Q}&season={year}'
    d=json.loads(source_get("duke_roster_web",url,True) if args.seed_cache and t["id"]=="150" else get(url))
    ps,coach,meta=parse_roster(d,t);coaches[t["id"]]=coach;colors[t["id"]]=meta.get("color")
    for p in ps:p["updated"]=stamp
    if not ps:raise ValueError("Empty roster")
    return ps
   except Exception as e:failures.append({"team":t["short"],"error":str(e)});return [p for p in old.get("players",[]) if p["teamId"]==t["id"]]
  with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
   for i,ps in enumerate(pool.map(roster,teams.values())):
    all_players.extend(ps)
    if (i+1)%50==0:print(f"College rosters: {i+1}/{len(teams)}",flush=True)
  unique={}
  for p in all_players:
   if p["id"] not in unique:unique[p["id"]]=p
  if len(unique)<2500 and len(players)>len(unique):errors.append("Incomplete rosters; retained previous player pool")
  else:
   players=list(unique.values())
   sources["players"]={"name":"ESPN roster statistics","status":"connected" if not failures else "partial","url":"https://www.espn.com/mens-college-basketball/players","updated":stamp,"checked":stamp,"coverage":len(players),"teams":len(teams)-len(failures),"missingTeams":[x["team"] for x in failures]}
  for tid,t in teams.items():
   if coaches.get(tid):t["coach"]=coaches[tid]
   elif prior.get(tid,{}).get("coach"):t["coach"]=prior[tid]["coach"]
   if colors.get(tid):t["color"]="#"+colors[tid].lstrip("#")
 elif players:
  for tid,t in teams.items():
   if prior.get(tid,{}).get("coach"):t["coach"]=prior[tid]["coach"]
   if prior.get(tid,{}).get("color"):t["color"]=prior[tid]["color"]
 # Full player season lines (minutes, shooting, steals, blocks, turnovers) from ESPN's stat leaders feed, every run.
 stat_rows={};stat_err=None
 try:
  page,pages=1,1
  while page<=pages and page<=15:
   rows,pg=parse_byathlete(json.loads(get(f"{WEB}/apis/common/v3/sports/basketball/mens-college-basketball/statistics/byathlete?{Q}&isqualified=false&limit=1000&page={page}&sort=offensive.avgPoints:desc&season={year}&seasontype=2")))
   stat_rows.update(rows);pages=int(pg.get("pages") or 1);page+=1
  matched=0
  for p in players:
   r=stat_rows.get(p["id"])
   if r and (not r["teamId"] or r["teamId"]==p["teamId"]):
    p["stats"]={k:v for k,v in r.items() if k!="teamId"};p["statsSource"]="ESPN season stats";matched+=1
  if matched<500:raise ValueError(f"Only {matched} roster players matched season stats")
  sources["playerStats"]={"name":"ESPN player season stats","status":"connected","url":"https://www.espn.com/mens-college-basketball/stats/player","updated":stamp,"checked":stamp,"coverage":matched}
 except Exception as e:
  stat_err=str(e);errors.append("Player stats: "+stat_err)
  oldstats={p["id"]:p for p in old.get("players",[]) if p.get("statsSource")}
  for p in players:
   if p["id"] in oldstats:p["stats"]=oldstats[p["id"]]["stats"];p["statsSource"]=oldstats[p["id"]]["statsSource"]
 # Last season's per-game lines, for the player card: final, so fetched once a season (cbb/data/prev.json, by athlete
 # id, which follows a player who transferred)
 prevf=read(PREV,{}) or {}
 if prevf.get("season")!=year-1 or len(prevf.get("players") or {})<1000:
  try:
   rows={};page,pages=1,1
   while page<=pages and page<=15:
    r,pg=parse_byathlete(json.loads(get(f"{WEB}/apis/common/v3/sports/basketball/mens-college-basketball/statistics/byathlete?{Q}&isqualified=false&limit=1000&page={page}&sort=offensive.avgPoints:desc&season={year-1}&seasontype=2")))
    rows.update(r);pages=int(pg.get("pages") or 1);page+=1
   if len(rows)<1000:raise ValueError(f"only {len(rows)} players")
   PREV.write_text(json.dumps({"season":year-1,"label":f"{year-2}-{str(year-1)[2:]}","updated":stamp,"source":"ESPN player season stats",
    "players":{k:{c:x for c,x in v.items() if x is not None} for k,v in rows.items()}},ensure_ascii=False,separators=(",",":"))+"\n")
   print(f"Last season: {len(rows)} players",flush=True)
  except Exception as e:errors.append("Last season's stats: "+str(e))
 # Every team's full season schedule, refreshed every run after six hours (365 small requests).
 sched=read(SCHEDULE,{}) or {}
 if sched.get("season")!=year:sched={}
 try:sage=(now-dt.datetime.fromisoformat(sched.get("updated","").replace("Z","+00:00"))).total_seconds()/3600
 except (ValueError,TypeError):sage=1e6
 if args.rosters or sage>=6 or not sched.get("games"):
  sg,sother,sfail={},{},[]
  def schedule(t):
   try:return parse_schedule(json.loads(get(f'{WEB}/apis/site/v2/sports/basketball/mens-college-basketball/teams/{t["id"]}/schedule?{Q}&season={year}')),teams,year)
   except Exception as e:sfail.append(t["short"]+": "+str(e)[:80]);return {},{}
  with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
   for g_,o_ in pool.map(schedule,teams.values()):sg.update(g_);sother.update(o_)
  if len(sfail)<40 and len(sg)>3000:
   sched={"season":year,"updated":stamp,"games":sorted(sg.values(),key=lambda g:(g["day"],g.get("at") or "")),"other":sother,"failed":sfail}
   sources["schedule"]={"name":"ESPN team schedules","status":"connected" if not sfail else "partial","url":"https://www.espn.com/mens-college-basketball/schedule","updated":stamp,"checked":stamp,"coverage":len(sg)}
   SCHEDULE.write_text(json.dumps(sched,ensure_ascii=False,separators=(",",":"))+"\n")
  else:errors.append(f"Schedules: {len(sfail)} teams failed, {len(sg)} games; kept the last good schedule")
 # Today's scoreboard is fresher than the schedule snapshot
 if sched.get("games"):
  live={g["id"]:g for g in games.values() if g.get("source")=="ESPN scoreboard"}
  for g in sched["games"]:
   x=live.get(g["id"])
   if x:g.update({"state":x["state"],"hs":x["homeScore"],"as":x["awayScore"]})
  SCHEDULE.write_text(json.dumps(sched,ensure_ascii=False,separators=(",",":"))+"\n")
 # Connect matching college players to the existing NBA Big Board without inventing an impact rating.
 draft=read(ROOT/"draft/nba.json",{});draft_byname={norm(p["n"]):p for p in draft.get("players",[])}
 for p in players:
  prospect=draft_byname.get(norm(p["name"]))
  if prospect and (str(prospect.get("sid"))==p["teamId"] or norm(prospect.get("school"))==norm(teams.get(p["teamId"],{}).get("short"))):
   p["draftRank"]=prospect["rank"];p["draftUpdated"]=draft.get("asof");p["draftSources"]=prospect.get("on")
 # External providers are linked, not presented as connected feeds.
 for ident,name,url,note in [
  ("torvik","Bart Torvik","https://barttorvik.com/","Bulk feed is not currently reachable from the updater."),
  ("kenpom","KenPom","https://kenpom.com/","Provider access and public-display permission are needed for a full feed."),
  ("evanmiya","EvanMiya","https://evanmiya.com/","Player BPR and lineup ratings: explore the original source."),
  ("shotquality","ShotQuality","https://shotqualitybets.com/","Expected shot outcomes: explore the original source."),
  ("cbbanalytics","CBB Analytics","https://cbbanalytics.com/","Shot charts, lineup and on/off scouting: explore the original source."),
  ("hoopexplorer","Hoop Explorer","https://hoop-explorer.com/","RAPM, shot charts and lineup combinations: explore the original source.")]:
  sources[ident]={"name":name,"status":"linked","url":url,"note":note}
 ts=list(teams.values());ts.sort(key=lambda t:t.get("haslamRank") or 9999)
 payload={"schema":1,"sport":"ncaam","season":year,"seasonLabel":f"{year-1}-{str(year)[2:]}","updated":stamp,"today":today.isoformat(),"sources":sources,
  "teams":ts,"players":players,"games":sorted(games.values(),key=lambda g:(g["day"],g.get("at") or "")),"march":march,"errors":errors,
  "notes":{"players":"Season lines from ESPN's player stats feed (minutes, shooting, rebounds, assists, steals, blocks, turnovers, PER). True shooting and effective field-goal percentage are computed from those totals.",
   "games":"Scores are timestamped ESPN snapshots, refreshed periodically. Haslametrics supplies additional future fixtures.",
   "rankings":"Haslametrics and BPI measure team strength differently. Strength of Record measures résumé. Haslametrics quadrant records are based on its own hNET, not official NCAA NET."}}
 if len(ts)<300 or sum(t.get("haslamRank") is not None for t in ts)<300 or len(players)<2500:raise ValueError("Core college data incomplete; not replacing the last complete hub")
 DATA.parent.mkdir(parents=True,exist_ok=True);DATA.write_text(json.dumps(payload,ensure_ascii=False,separators=(",",":"))+"\n")
 summary={"season":year,"updated":stamp,"teams":len(ts),"rated":sum(t.get("haslamRank") is not None for t in ts),"players":len(players),"games":len(games),"bracketTeams":sum(len(s["teamIds"]) for s in (march or {}).get("slots",[])),"errors":errors,"sources":sources}
 (DATA.parent/"summary.json").write_text(json.dumps(summary,ensure_ascii=False,separators=(",",":"))+"\n")
 print(json.dumps(summary))
 if errors:print("Retained source snapshots where needed.",file=sys.stderr)

if __name__=="__main__":main()
