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
    cover: { image: "assets/covers/degenerate-trail.jpg", bg: "#101916", band: "#D8EE82" }
  },
  {
    title: "Franchise Mode",
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
    cover: { image: "assets/covers/nick-chat.jpg", bg: "#e8ebf2", band: "#596579" }
  }
];
