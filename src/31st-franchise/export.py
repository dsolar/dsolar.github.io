import json
P = json.load(open('players.json'))
TEAMS = {}
import re
src = open('build.py').read()
exec(re.search(r"TEAM_NAMES = \{.*?\}", src, re.S).group(0))
F = ["n","t","pos","bpos","ps","age","s","yrs","st","o","d","mv","ppg","rpg","apg","gp","h","prot","note","src","usg","astp","blk","tpar","ts","rm","ovr","offr","defr","ovn","offn","defn","rn","s28","s29","ih","g3","mv28","mv29","pot","potr","tier","mpg"]
rows = []
for p in P:
    r = {f: p.get(f) for f in F}
    if not r["ih"]: r.pop("ih")
    if not r["g3"]: r.pop("g3")
    if r["s28"] is None: r.pop("s28")
    if r["s29"] is None: r.pop("s29")
    rows.append(r)
js = "const TEAMS=" + json.dumps(TEAM_NAMES, separators=(",", ":")) + ";\nconst PLAYERS=" + json.dumps(rows, separators=(",", ":")) + ";\n"
js += "PLAYERS.forEach(p=>{p.key=p.t+'|'+p.n; if(p.s28===undefined)p.s28=null; if(p.s29===undefined)p.s29=null;});\nconst PBYKEY=new Map(PLAYERS.map(p=>[p.key,p]));\nconst POOLP=PLAYERS.filter(p=>p.st!=='ufa'&&!p.prot);\n"
open('data.js', 'w', encoding='utf-8').write(js)
print(len(rows), "players,", len(js)//1024, "KB")
