/* Every project on the home page comes from this list.
   To add a project: copy one { ... } block, paste it at the end, and change the values.
   No other file needs to change for it to show up.

   Fields
     title     Project name.
     type      What kind of thing it is: "Game", "Tool", "Simulation", "Writing", "Experiment".
               Once there's more than one type, filter buttons appear on the home page.
     released  Year and month it went live, "YYYY-MM". Newest shows first.
     url       Where it lives on this site, relative to the home page (folder name + /).
     question  The question that started it. Shows in italics.
     summary   One or two sentences on what it is.
     facts     Three [number, label] pairs. The numbers hang on green scoreboard plates.
     stack     What it's built with.
     cover     image: screenshot in assets/covers/ (optional; without one, a colored
               block with the title is drawn instead). bg / band: the project's own colors.
     featured  true puts it at the top of the list, ahead of anything newer.
     status    "live" (default) or "building" (listed with no Play button).
     hidden    true keeps it off the home page. The page itself still works by direct link.
*/
window.PROJECTS = [
  {
    title: "The 31st Franchise",
    type: "Game",
    released: "2026-10",
    url: "31st-franchise/",
    question: "How good a team could Seattle build from what the rest of the NBA leaves unprotected?",
    summary: "An NBA expansion draft game with real 2027-28 contracts and the reported expansion rules. Draft your roster, take on bad contracts for picks, sign free agents, then play the season.",
    facts: [["$117.2M", "hard cap in year one"], ["14", "picks, one per NBA team at most"], ["1,000", "simulated seasons behind every grade"]],
    stack: ["JavaScript", "Python", "Monte Carlo simulation"],
    cover: { image: "assets/covers/31st-franchise.jpg", bg: "#00653A", band: "#FFC200" },
    featured: true
  },
  {
    title: "The Degenerate Trail",
    type: "Game",
    released: "2026-10",
    url: "degenerate-trail/",
    question: "Can Nick make it eight blocks home through Montreal before the night wins?",
    summary: "An Oregon Trail-style browser game. Walk Nick home, dodge distractions, keep his energy, phone and cash alive, and talk your way through the encounters along the way.",
    facts: [["8", "blocks between the bar and home"], ["4:00", "on the clock before it's over"], ["5", "endings to discover"]],
    stack: ["JavaScript", "HTML Canvas"],
    cover: { image: "assets/covers/degenerate-trail.jpg", bg: "#101916", band: "#D8EE82" },
    hidden: true
  },
  {
    title: "Dynasty Mode",
    type: "Game",
    status: "building",
    url: "franchise-mode/",
    question: "Can Seattle turn an expansion roster into a contender, season after season?",
    summary: "The next chapter of The 31st Franchise. Keep running the team after year one, with multiple seasons, free agency, trades and rookie drafts.",
    stack: ["JavaScript", "Python"],
    cover: { bg: "#00653A", band: "#FFC200" }
  },
  {
    title: "Chat with Nick",
    type: "Experiment",
    released: "2026-10",
    url: "nick-chat/",
    question: "What if the group chat had an on-demand Nick?",
    summary: "A simple chat prototype inspired by Nick’s catchphrases and texting style. Try a conversation with scripted, topic-matched replies.",
    action: "Chat with Nick",
    stack: ["JavaScript"],
    cover: { image: "assets/covers/nick-chat.jpg", bg: "#e8ebf2", band: "#596579" },
    hidden: true
  },
  {
    title: "Bastille Day Odds",
    type: "Simulation",
    released: "2026-10",
    url: "guillotine/",
    question: "In a league that cuts its lowest score every week, who's next, and who's left in December?",
    summary: "Survival odds for my guillotine fantasy football league. It pulls the league from Yahoo every morning and plays out the rest of the season 20,000 times.",
    facts: [["20,000", "simulated seasons per update"], ["15", "teams, one cut every week"], ["Daily", "refresh from Yahoo"]],
    stack: ["JavaScript", "Python", "Monte Carlo simulation", "GitHub Actions"],
    cover: { image: "assets/covers/guillotine.jpg", bg: "#0E1A30", band: "#C8102E" }
  },
  {
    title: "Night Out",
    type: "Tool",
    released: "2026-10",
    url: "calendar/",
    question: "What's worth leaving the couch for, and who's in?",
    summary: "Our social calendar: shows, comics, games, movies and restaurants around Boston, plus road trips for the bands we love. Friends add plans and mark Interested or Going, and it watches ticket prices.",
    facts: [["Daily", "refresh of shows and games"], ["62", "restaurants, rated 1 to 5 stars"], ["4½ hr", "longest road trip it looks for"]],
    stack: ["JavaScript", "Python", "Cloudflare Workers", "GitHub Actions"],
    cover: { image: "assets/covers/calendar.jpg", bg: "#17130E", band: "#FFC53D" }
  },
  {
    title: "Paint the Corners",
    type: "Game",
    released: "2026-10",
    url: "paint-the-corners/",
    question: "Could you out-pitch Pedro against the 2003 and 2004 Yankees at Fenway?",
    summary: "A pitching game at Fenway. Throw as Pedro Martinez or Jonathan Papelbon against the real Yankees lineups from the 2003 and 2004 ALCS, learn each hitter's hot and cold zones, and paint the corners.",
    facts: [["14", "real Yankees across two ALCS lineups"], ["25", "spots to aim at, nine in the zone"], ["7", "pitches between Pedro and Papelbon"]],
    stack: ["JavaScript", "Monte Carlo simulation"],
    cover: { image: "assets/covers/paint-the-corners.jpg", bg: "#0A1A33", band: "#C8102E" }
  },
  {
    title: "Don't Forget to Wipe Yoenis",
    type: "Tool",
    released: "2026-10",
    url: "yoenis/",
    action: "Open the record book",
    question: "Fourteen drafts in, who's worth keeping next March?",
    summary: "The record book for my 16-team Yahoo keeper baseball league: every champion, draft pick, team stat line and yearly award since 2013, a graveyard for managers who left, and what each player will cost to keep in 2027.",
    facts: [["5,600", "draft picks since 2013"], ["14", "seasons of champions and standings"], ["3", "keeper years, then back in the draft"]],
    stack: ["JavaScript", "Python"],
    cover: { image: "assets/covers/yoenis.jpg", bg: "#1F4532", band: "#BD3039" }
  }
];
