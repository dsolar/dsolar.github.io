#!/usr/bin/env python3
"""Inspect the public feeds used by the college hub; do not request subscriber data."""
import concurrent.futures,datetime,json,pathlib,re,urllib.request,urllib.error,xml.etree.ElementTree as ET
ROOT=pathlib.Path(__file__).resolve().parents[1]; OUT=ROOT/"tools/cbb_sources";OUT.mkdir(parents=True,exist_ok=True)
now=datetime.datetime.now(datetime.timezone.utc);year=now.year+(now.month>=7);day=now.strftime("%Y%m%d")
Q="region=us&lang=en&contentorigin=espn"
urls={
 "haslam_xml":"https://haslametrics.com/ratings.xml",
 "games_web":f"https://site.web.api.espn.com/apis/fitt/v3/sports/basketball/mens-college-basketball/scoreboard?{Q}&dates={day}&groups=50&limit=1000",
 "players_web":f"https://site.web.api.espn.com/apis/fitt/v3/sports/basketball/mens-college-basketball/athletes?{Q}&isqualified=false&limit=1000&sort=offensive.avgPoints:desc&season={year}&seasontype=2",
 "bpi":f"https://site.web.api.espn.com/apis/fitt/v3/sports/basketball/mens-college-basketball/powerindex?{Q}&limit=1000&season={year}",
}
def small(v,depth=0):
 if depth>7: return list(v)[:40] if isinstance(v,dict) else str(v)[:80]
 if isinstance(v,dict): return {k:small(x,depth+1) for k,x in list(v.items())[:45]}
 if isinstance(v,list): return [small(x,depth+1) for x in v[:2]]+([f"... {len(v)} total"] if len(v)>2 else [])
 return v
def one(item):
 key,url=item
 try:
  req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0 (compatible; davidsolar-draft/1.0; +https://davidsolar.dev/cbb/)","Accept":"text/html,application/json"})
  with urllib.request.urlopen(req,timeout=40) as r: body=r.read().decode("utf-8-sig");status=r.status
  (OUT/(key+".txt")).write_text(body)
  extra={}
  try: d=json.loads(body);sample=small(d);kind="json"
  except Exception:
   sample=body[:800];kind="text"
   if key=="haslam_xml":
    root=ET.fromstring(body);tags={}
    for e in root.iter():
     if e.tag not in tags: tags[e.tag]={"count":0,"sample":[]}
     tags[e.tag]["count"]+=1
     if len(tags[e.tag]["sample"])<2: tags[e.tag]["sample"].append({"attributes":e.attrib,"text":(e.text or "").strip()[:300]})
    extra["xml"]=tags
  return key,{"url":url,"status":status,"bytes":len(body),"kind":kind,"sample":sample,**extra}
 except urllib.error.HTTPError as e: return key,{"url":url,"error":str(e),"body":e.read(400).decode("utf-8","replace")}
 except Exception as e: return key,{"url":url,"error":str(e)}
previous=ROOT/"tools/cbb_source_probe.json"
summary=json.loads(previous.read_text()) if previous.exists() else {"sources":{}}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: summary["sources"].update(dict(pool.map(one,urls.items())))
html=(OUT/"haslam.txt").read_text() if (OUT/"haslam.txt").exists() else ""
attrs=sorted(set(re.findall(r"getAttribute\(['\"]([^'\"]+)",html)))
summary["haslam_attributes"]=attrs
summary["haslam_mapping"]={a:[m.group() for m in re.finditer(r".{0,100}getAttribute\(['\"]"+re.escape(a)+r"['\"]\).{0,180}",html)][:2] for a in attrs}
summary["season"]=year;summary["updated"]=now.isoformat()
for key,d in summary["sources"].items(): d["sample"]=small(d.get("sample"))
previous.write_text(json.dumps(summary))
print(json.dumps({k:{x:v for x,v in d.items() if x not in ["sample","xml"]} for k,d in summary["sources"].items()},indent=2))
