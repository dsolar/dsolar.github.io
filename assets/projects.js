/* Every project on the home page comes from this list.
   To add a project: copy one { ... } block, paste it at the end, and change the values.
   No other file needs to change for it to show up.

   Fields
     title     Project name.
     type      Homepage category: "Fantasy Leagues", "Simulations", "Games", "Social Tools".
               Once there's more than one type, filter buttons appear on the home page.
     released  Year and month it went live, "YYYY-MM". Newest shows first.
     url       Where it lives on this site, relative to the home page (folder name + /).
     question  The question that started it. Shows in italics.
     summary   One or two sentences on what it is.
     facts     Three [number, label] pairs. The numbers hang on green scoreboard plates.
     stack     What it's built with.
     cover     image: screenshot in assets/covers/ (optional; without one, a colored
               block with the title is drawn instead). bg / band: the project's own colors.
     featured  true puts it at the top of its category and adds a Featured tag.
     spotlight true puts it first on the page in a full-width card (use on one project).
     status    "live" (default) or "building" (listed with no Play button).
     hidden    true hides it until the homepage app code is entered. Direct links still work.
     section   "kids" puts it in the "Made for my daughter" section at the bottom of the page instead.
     external  true for a project that lives on another site (url is then the full address).
     matchups  real games inside, shown on the card with both teams' logos: { you, opp, home or neutral, label },
               where you/opp are NFL abbreviations (Make the Call's famous calls, from its data.js).

   The home page shows projects in this list's order (the spotlight first), so order matters.
*/
window.PROJECTS = [
  {
    title: "Make the Call",
    featured: true,
    spotlight: true,
    type: "Games",
    released: "2026-10",
    url: "win-probability/",
    action: "Make the call",
    question: "Go for it, punt, or kick? Would the math agree with you?",
    summary: "Coach through real NFL decisions, from Belichick's 4th-and-2 to last Sunday, and get graded on win probability, not on whether the play worked.",
    facts: [["1,500+", "real situations to call"], ["26", "famous calls, 2009 to Super Bowl LX"], ["25", "seconds on the play clock"]],
    matchups: [
      { you: "NE", opp: "IND", home: false, label: "4th-and-2, 2009" },
      { you: "SEA", opp: "NE", neutral: true, label: "Super Bowl XLIX" },
      { you: "PHI", opp: "NE", neutral: true, label: "The Philly Special" },
      { you: "DET", opp: "SF", home: false, label: "NFC Title Game, 2023" }
    ],
    stack: ["JavaScript", "Python", "R", "Supabase"],
    cover: { image: "assets/covers/win-probability.jpg", bg: "#0E2A1F", band: "#F7D23E" }
  },
  {
    title: "Sunday Strategist",
    type: "Games",
    released: "2026-10",
    url: "sunday-strategist/",
    action: "Read the defense",
    question: "The nickel's walked down and showing blitz. Is he coming, and where does the ball go if he is?",
    summary: "A football coaching game: diagnose the defense, set the protection, call the play, then see who had to hold up and why it worked. Graded on the decision, not the result.",
    facts: [["6", "grades on every snap"], ["400", "reps behind every call's odds"], ["2", "scenarios, one pre-snap picture"]],
    stack: ["JavaScript", "SVG"],
    cover: { image: "assets/covers/sunday-strategist.svg", bg: "#0D1821", band: "#F7D23E" }
  },
  {
    title: "Bastille Day Odds",
    type: "Fantasy Leagues",
    released: "2026-10",
    url: "guillotine/",
    question: "In a league that cuts its lowest score every week, who's next, and who's left in December?",
    summary: "A Yahoo-powered fantasy football dashboard that models survival odds across thousands of seasons.",
    facts: [["20,000", "simulated seasons per update"], ["15", "teams, one cut every week"], ["Daily", "refresh from Yahoo"]],
    stack: ["JavaScript", "Python", "Monte Carlo simulation", "GitHub Actions"],
    cover: { image: "assets/covers/guillotine.svg", bg: "#0E1A30", band: "#C8102E" }
  },
  {
    title: "Don't Forget to Wipe Yoenis",
    type: "Fantasy Leagues",
    released: "2026-10",
    url: "yoenis/",
    action: "Open the record book",
    question: "Fourteen drafts in, who's worth keeping next March?",
    summary: "A searchable history of a long-running fantasy baseball league, with keeper analysis and draft tools.",
    facts: [["5,600", "draft picks since 2013"], ["14", "seasons of champions and standings"], ["3", "keeper years, then back in the draft"]],
    stack: ["JavaScript", "Python"],
    cover: { image: "assets/covers/yoenis.svg", bg: "#1F4532", band: "#BD3039" }
  },
  {
  title: "The 31st Franchise",
    type: "Simulations",
    released: "2026-10",
    url: "31st-franchise/",
    question: "How good a team could Seattle build from what the rest of the NBA leaves unprotected?",
    summary: "Build an NBA expansion roster, navigate the salary cap, and test your decisions across simulated seasons.",
    facts: [["$117.2M", "hard cap in year one"], ["14", "picks, one per NBA team at most"], ["1,000", "simulated seasons behind every grade"]],
    stack: ["JavaScript", "Python", "Monte Carlo simulation"],
    cover: { image: "assets/covers/31st-franchise-seattle.svg", bg: "#00653A", band: "#FFC200" }
  },
  {
    title: "Banner 19",
    type: "Simulations",
    released: "2026-10",
    url: "celtics/",
    action: "Run the front office",
    question: "Can Boston get to Banner 19 without lighting money on fire?",
    summary: "Manage the Celtics' roster, salary cap, trades, and draft strategy across simulated seasons.",
    facts: [["$1.7M", "under the tax on day one"], ["29", "front offices, each with its own tax stance"], ["60", "real prospects in the 2027 draft"]],
    stack: ["JavaScript", "Python", "GitHub Actions"],
    cover: { image: "assets/covers/celtics.jpg", bg: "#007A33", band: "#BA9653" }
  },
  {
    title: "Paint the Corners",
    type: "Games",
    released: "2026-10",
    url: "paint-the-corners/",
    question: "Could you out-pitch Pedro against the 2003 and 2004 Yankees at Fenway?",
    summary: "Pitch against historic Yankees lineups at Fenway, using hitter tendencies and pitch placement.",
    facts: [["14", "real Yankees across two ALCS lineups"], ["25", "spots to aim at, nine in the zone"], ["7", "pitches between Pedro and Papelbon"]],
    stack: ["JavaScript", "Monte Carlo simulation"],
    cover: { image: "assets/covers/paint-the-corners.jpg", bg: "#0A1A33", band: "#C8102E" }
  },
  {
    title: "The Degenerate Trail",
    type: "Games",
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
    hidden: true,
    action: "Open beta",
    type: "Simulations",
    status: "building",
    url: "franchise-mode/",
    question: "Can Seattle turn an expansion roster into a contender, season after season?",
    summary: "A multi-season front-office simulation with drafts, trades, and free agency.",
    stack: ["JavaScript", "Python"],
    cover: { image: "assets/covers/dynasty-mode.svg", bg: "#10251f", band: "#d6b46e" }
  },
  {
    title: "Chat with Nick",
    type: "Social Tools",
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
    title: "Night Out",
    hidden: true,
    type: "Social Tools",
    released: "2026-10",
    url: "calendar/",
    question: "What's worth leaving the couch for, and who's in?",
    summary: "A shared calendar for Boston events, restaurants, and trips, with group planning and ticket tracking.",
    facts: [["Daily", "refresh of shows and games"], ["62", "restaurants, rated 1 to 5 stars"], ["4½ hr", "longest road trip it looks for"]],
    stack: ["JavaScript", "Python", "Cloudflare Workers", "GitHub Actions"],
    cover: { image: "assets/covers/calendar.jpg", bg: "#17130E", band: "#FFC53D" }
  },
  {
    title: "Lige de Rohan",
    hidden: true,
    type: "Fantasy Leagues",
    released: "2026-10",
    url: "rohan/",
    action: "Enter the league",
    question: "Twenty-one seasons in, who's actually running this league?",
    summary: "The league house for a 10-team ESPN keeper league: live matchups and projections, league history, rules, and drafts.",
    facts: [["21", "seasons since 2006"], ["$205", "auction budget per team"], ["3", "keepers per team"]],
    stack: ["JavaScript", "ESPN and Sleeper data"],
    cover: { image: "assets/covers/rohan.jpg", bg: "#122B24", band: "#D4C08A" }
  },
  {
    title: "Trade Analyzer",
    hidden: true,
    type: "Fantasy Leagues",
    released: "2026-10",
    url: "trade-analyzer/",
    action: "Analyze a trade",
    question: "Who wins this trade under your league's actual rules?",
    summary: "Connect an ESPN league, build an offer from two real rosters, and compare lineups and keeper costs before and after. Needs a browser extension.",
    stack: ["JavaScript", "Browser extension", "Supabase"],
    cover: { image: "assets/covers/trade-analyzer.jpg", bg: "#F5F1E8", band: "#173A31" }

  },
  {
    title: "Jellycat Battle Club",
    section: "kids",
    type: "Games",
    released: "2026-10",
    url: "jellycat-battle/",
    action: "Start the adventure",
    question: "What if the plush on the shelf had to battle for its spot?",
    summary: "A collect-and-battle game I designed for my daughter. Pick a starter, explore the Softlands, win battles, and grow your Jellycat collection. Unofficial and fan-made.",
    facts: [["150", "Jellycats to collect"], ["24", "routes across the Softlands"], ["6", "types, from Food to Adventure"]],
    stack: ["JavaScript"],
    cover: { image: "assets/covers/jellycat-battle.jpg", bg: "#F9F1E8", band: "#64398E" }
  },
  {
    title: "Wild Bloom Isles",
    section: "kids",
    type: "Games",
    released: "2026-10",
    url: "https://claire-hidden-isles.davidbsolar.chatgpt.site/",
    external: true,
    action: "Play on ChatGPT",
    question: "What happens the morning a little cow says her first words?",
    summary: "A gentle island adventure I made for my daughter: name yourself, team up with Cow, explore the Bloom Isles and help the village grow. It lives on ChatGPT for now.",
    stack: ["ChatGPT"],
    cover: { image: "assets/covers/wild-bloom-isles.jpg", bg: "#171B35", band: "#B23A57" }
  }
];
