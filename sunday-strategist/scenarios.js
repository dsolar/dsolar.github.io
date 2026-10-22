/* Sunday Strategist content: the football lives here, never in the UI.
   Three layers, so a scenario never repeats a definition:
     concepts      offensive concepts: what each one stresses, how it fails
     defenses      defensive calls: what they take away, where they're soft
     scenarios     situations that reference both and score every option

   Coordinates: x is yards from the left sideline (0 to 53.3), y is yards from the line of
   scrimmage, positive downfield. Times are seconds after the snap.

   Every scenario says where its facts came from (provenance). The two below are synthetic
   teaching scenarios: no real game, teams, or players, and the page says so.
   docs/DATA_MODEL.md documents every field; schema.js enforces them. */
(function (root, data) {
  if (typeof module === "object" && module.exports) module.exports = data;
  else root.SS_DATA = data;
})(this, {
  version: 1,

  concepts: {
    stick: {
      name: "Stick",
      family: "Quick game",
      plain: "A 6-yard 'stick' that settles in the window, with a route to the flat outside it. Two receivers, one underneath defender: he can't cover both.",
      stresses: "The curl-to-flat defender, horizontally.",
      strongVs: ["Zone pressure", "Cover 3", "Soft quarters"],
      weakVs: ["Tight man coverage with a robber", "A defender who sinks under the stick while another buzzes the flat"],
      timing: "Ball out by about 2.2 seconds.",
      failure: ["Stick runner drifts into the hook defender", "QB stares at one route and the conflict defender reads his eyes"]
    },
    "hot-slant": {
      name: "Hot slant",
      family: "Pressure answer",
      plain: "The slot runs a three-step slant into the spot the blitzing nickel just left. The ball comes out immediately.",
      stresses: "Nothing structural: it bets the vacated area stays empty.",
      strongVs: ["Cover 0 with no one replacing the blitzer"],
      weakVs: ["Fire zones and rotations that replace the blitzer", "A bluff, where the 'blitzer' drops into the slant"],
      timing: "Ball out in about 1.3 seconds.",
      failure: ["Throwing into the replacement defender", "Throwing into a bluffing nickel"]
    },
    verts: {
      name: "Four verticals",
      family: "Dropback shot",
      plain: "Four receivers go deep. Against three deep defenders, or two, someone is left with two receivers to cover.",
      stresses: "The deep middle defender (vs one-high) or the two halves safeties (vs two-high).",
      strongVs: ["Cover 3", "Cover 2 seams"],
      weakVs: ["Pressure that gets home before 2.8 seconds", "Quarters with deep safeties reading the seams"],
      timing: "Needs about 2.8 to 3.0 seconds.",
      failure: ["Protection breaks before the seams clear", "QB doesn't move the middle safety with his eyes"]
    },
    draw: {
      name: "Draw",
      family: "Run",
      plain: "Show pass, invite the rush upfield, then hand it off through the lanes the rushers vacated.",
      stresses: "Rushers who get too far upfield, and light boxes.",
      strongVs: ["Four-man rushes from a light box", "Defenses playing the sticks on long downs"],
      weakVs: ["Linebackers who stay home", "Blitzers who arrive in the run lane"],
      timing: "Handoff about 1.0 second; the run needs the linebackers to clear.",
      failure: ["An inside blitzer meets the back in the hole", "A dropping linebacker fills the lane"]
    },
    quick: {
      name: "Quick game (slant-flat)",
      family: "Quick game",
      plain: "Three-step drop. The outside receiver runs a slant, the slot runs to the flat. Ball out fast, high percentage, built to get the ball to a receiver in space.",
      stresses: "The flat defender, horizontally, and the rush, by getting the ball out first.",
      strongVs: ["Off coverage", "Cover 3", "Pressure"],
      weakVs: ["Press man with help inside", "Cover 2 corners squatting in the flat"],
      timing: "Ball out by about 1.4 seconds.",
      failure: ["Slant thrown into a hook defender sliding underneath", "Flat route jumped by a squatting corner"]
    },
    dagger: {
      name: "Dagger",
      family: "Dropback",
      plain: "The slot runs up the seam to clear the middle; the outside receiver runs a deep dig into the space the seam leaves behind the linebackers.",
      stresses: "The hook defenders and the middle safety, vertically.",
      strongVs: ["Cover 3", "Cover 1 with a linebacker on the slot"],
      weakVs: ["Quarters, where the safety jumps the dig", "Pressure before 2.8 seconds"],
      timing: "Needs about 2.8 seconds.",
      failure: ["Seam doesn't clear the safety", "Protection breaks before the dig crosses"]
    },
    screen: {
      name: "Running back screen",
      family: "Screen",
      plain: "Linemen let the rush go, then release in front of the back, who catches it behind the line with blockers ahead.",
      stresses: "Aggressive rushers and blitzers who run themselves out of the play.",
      strongVs: ["Pressure", "Long-yardage downs when the defense plays the sticks"],
      weakVs: ["Defenses that drop linemen or keep a linebacker home", "Short yardage"],
      timing: "Catch at about 1.5 seconds, then blockers have to get out in front.",
      failure: ["A rusher reads it and stays home", "A dropping lineman sits right on the back"]
    },
    "pa-shot": {
      name: "Play-action shot",
      family: "Play action",
      plain: "Fake the run, pull the linebackers and safeties forward, then throw deep behind them.",
      stresses: "Safeties and linebackers who are reading run, vertically.",
      strongVs: ["One-high defenses with eight in the box", "Run-heavy downs where the defense has to respect the run"],
      weakVs: ["Two-high shells with safeties at depth", "Long yardage, when nobody believes the fake"],
      timing: "Needs about 3 seconds. The fake buys some of it.",
      failure: ["Nobody bites on the fake", "The rush gets home before the shot develops"]
    },
    "inside-zone": {
      name: "Inside zone",
      family: "Run",
      plain: "The line steps playside together and double-teams up to the linebackers. The back reads the first down lineman and picks the hole: frontside, cutback or bend.",
      stresses: "The front's gap discipline, and the linebackers' fits.",
      strongVs: ["Light boxes", "Two-high shells", "Fast-flowing linebackers (cutback)"],
      weakVs: ["Eight-man boxes", "Penetrating defensive tackles"],
      timing: "Handoff about 0.8 seconds.",
      failure: ["An unblocked box defender fills the hole", "Penetration in the backfield"]
    },
    "outside-zone": {
      name: "Outside zone",
      family: "Run",
      plain: "Everyone reaches playside and runs laterally; the back aims for the edge and cuts up where the defense overflows.",
      stresses: "The edge and the force defender, horizontally.",
      strongVs: ["Light boxes", "Slow edges", "Defenses that over-pursue"],
      weakVs: ["A set edge with a fast-flowing safety", "Penetration across the line"],
      timing: "Handoff about 0.9 seconds; it develops wide.",
      failure: ["The edge gets set and the back has nowhere to go", "Backside pursuit catches it from behind"]
    },
    power: {
      name: "Power",
      family: "Run",
      plain: "A gap scheme: the playside line blocks down, a guard pulls around to kick out or lead through the hole. More bodies at the point of attack than the defense has there.",
      stresses: "The point of attack, by numbers.",
      strongVs: ["Short yardage", "Even fronts with a soft edge", "Defenses that don't spill the puller"],
      weakVs: ["Fast backside pursuit", "Penetration that trips up the puller"],
      timing: "Handoff about 1.0 second; the puller has to get there.",
      failure: ["The puller gets tripped up", "A spill defender forces it wide into pursuit"]
    },
    sneak: {
      name: "Quarterback sneak",
      family: "Run",
      plain: "The quarterback follows the center straight ahead. The fastest play in football to gain a yard.",
      stresses: "The interior defensive line's leverage.",
      strongVs: ["Short yardage of a yard or less"],
      weakVs: ["Anything longer than a yard or two", "A low, penetrating nose tackle"],
      timing: "Immediately.",
      failure: ["The interior gets driven back", "The line to gain is more than a yard away"]
    },
    mesh: {
      name: "Mesh",
      family: "Man beater",
      plain: "Two receivers cross underneath, close enough to rub each other's defenders. Man defenders get caught in the traffic.",
      stresses: "Man defenders trailing receivers across the field.",
      strongVs: ["Cover 1", "Cover 0", "Any man coverage without a low-hole defender"],
      weakVs: ["Zone defenders who sit in the crossing lane", "A robber in the middle"],
      timing: "First crosser at about 1.8 seconds, second at 2.3.",
      failure: ["Crossers too far apart to rub anyone", "Protection breaks before the crossers clear"]
    },
    fade: {
      name: "Fade",
      family: "One-on-one shot",
      plain: "A receiver runs straight up the field against his defender. No route trickery: a bet that he wins the release and the ball is placed away from the defender.",
      stresses: "A single defender with no help over the top.",
      strongVs: ["Cover 0", "Press man with the safety committed elsewhere"],
      weakVs: ["Any deep safety in position to help"],
      timing: "Ball out at about 1.8 to 2.0 seconds.",
      failure: ["Receiver loses the release", "Underthrown ball lets the defender recover"]
    },
    smash: {
      name: "Smash",
      family: "Quick game / high-low",
      plain: "Outside receiver runs a 5-yard hitch, slot runs a corner route over it. The flat defender can't take both.",
      stresses: "The corner in Cover 2, high to low.",
      strongVs: ["Cover 2", "Squatting corners"],
      weakVs: ["Cover 3 (the corner is already deep)", "Cover 6 with a sinking corner"],
      timing: "Hitch at 1.8 seconds, corner at about 2.5.",
      failure: ["Corner route flattens into the halves safety", "QB throws the hitch late into a squat corner"]
    }
  },

  defenses: {
    "fire-zone-3": {
      group: "three",
      name: "Nickel fire zone, Cover 3 behind it",
      plain: "Five rush (the nickel and a linebacker blitz, an end drops). Three deep, three underneath. The safety on the blitz side rotates down to replace the nickel.",
      vulnerable: ["Seams against three deep", "The hook-curl windows between three underneath defenders", "Quick game away from the rotating safety"],
      counters: ["Stick and spacing", "Max-protected seams", "Screens away from the pressure"]
    },
    "cover-1-nickel": {
      group: "man",
      name: "Nickel pressure, Cover 1 behind it",
      plain: "Five rush, the nickel among them. Everyone else is in man, with one free safety deep in the middle. Whoever covers the nickel's receiver has to come from farther away.",
      vulnerable: ["Quick throws to the receiver the blitzer left", "Crossing routes that rub man defenders", "Anything outside the free safety's reach"],
      counters: ["Hot slant", "Mesh", "Sight adjusts"]
    },
    "cover-0": {
      group: "zero",
      name: "Cover 0 all-out pressure",
      plain: "Six or more rush. Every other defender is in man, and nobody is deep.",
      vulnerable: ["Any quick throw that wins leverage, with no safety to tackle behind it", "One-on-ones deep, if protection holds"],
      counters: ["Quick slants", "Max protection with a fade", "Sight adjusts"]
    },
    "gen-cover-0": { group: "zero", name: "Cover 0", plain: "Man-to-man with nobody deep. Everyone not covering someone is rushing.", vulnerable: ["Any quick throw that wins leverage", "One-on-ones deep with no help"], counters: ["Quick game", "Fade", "Sight adjusts"] },
    "gen-cover-1": { group: "man", name: "Cover 1", plain: "Man-to-man across the board with one free safety deep in the middle, and often a robber underneath.", vulnerable: ["Crossers that rub man defenders", "Matchups outside, away from the free safety"], counters: ["Mesh", "Quick game", "Fade"] },
    "gen-2-man": { group: "twoMan", name: "2-Man", plain: "Man-to-man underneath with two deep safeties splitting the field. Defenders trail receivers, knowing help is over the top.", vulnerable: ["Underneath crossers and option routes", "Quarterback runs: everyone's back is turned"], counters: ["Mesh", "Quick game", "Runs and scrambles"] },
    "gen-cover-2": { group: "two", name: "Cover 2", plain: "Five underneath zones, two deep halves. Corners squat in the flats.", vulnerable: ["The hole between the corner and the halves safety (smash)", "Seams down the middle"], counters: ["Smash", "Four verticals", "Runs against a light box"] },
    "gen-cover-3": { group: "three", name: "Cover 3", plain: "Three deep thirds, four underneath zones. A one-high shell, usually with a safety rolled down near the box.", vulnerable: ["Seams against three deep", "Flats and curl windows underneath"], counters: ["Dagger", "Four verticals", "Quick game"] },
    "gen-cover-4": { group: "quarters", name: "Quarters (Cover 4)", plain: "Four deep defenders reading the receivers in front of them; safeties fit the run aggressively.", vulnerable: ["Short throws underneath, especially to the flats", "Runs before the safeties can fit"], counters: ["Quick game", "Smash", "Mesh"] },
    "gen-cover-6": { group: "quarters", name: "Cover 6", plain: "Quarters to one side, Cover 2 to the other: a split-field coverage.", vulnerable: ["Smash to the Cover 2 side", "The seam on the quarters side"], counters: ["Smash", "Quick game", "Dagger"] },
    "gen-cover-9": { group: "three", name: "Cover 9 (match 3)", plain: "A three-deep match coverage: it plays like Cover 3 but carries vertical routes like man.", vulnerable: ["Quick throws underneath", "Crossers that stress the matching rules"], counters: ["Quick game", "Mesh", "Smash"] },
    "gen-combo": { group: "quarters", name: "Combination coverage", plain: "Different rules on each side of the formation, often man on one side and zone on the other.", vulnerable: ["Whichever side is playing the softer rule"], counters: ["Quick game", "Mesh"] },
    "gen-run-fit": { name: "Run fits", plain: "On a run, every defender owns a gap. The coverage behind it matters less than whether the box has more defenders than you have blockers.", vulnerable: ["The extra gap when you have more blockers than they have defenders", "Cutback lanes against fast-flowing linebackers"], counters: ["Inside zone", "Power", "Play action"] },
    "cover-2-bluff": {
      group: "two",
      name: "Nickel bluff, Cover 2",
      plain: "Four rush. The nickel shows blitz, then bails to the curl. Corners squat in the flats, two safeties split the deep halves.",
      vulnerable: ["The hole between the corner and the halves safety (smash)", "Seams down the middle", "Draws against a four-man rush"],
      counters: ["Smash", "Four verticals", "Draw"]
    }
  },

  // What the read report calls each skill a scenario practices (learning.tags).
  tags: {
    "nickel-pressure": "Nickel pressure",
    "replacement-defender": "Finding the replacement defender",
    "protection-count": "Counting rushers vs blockers",
    "pressure-disguise": "Seeing through disguised pressure",
    "man-vs-zone": "Telling man pressure from zone pressure",
    "zero-pressure": "Beating all-out pressure",
    "run-vs-box": "Run or pass by the box count",
    "coverage-id": "Reading the coverage shell",
    "situational": "Situational football",
    "dc-personnel": "Matching personnel (defense)",
    "dc-coverage": "Calling pressure and coverage (defense)",
    "dc-situational": "Situational defense"
  },

  /* The film room grades real snaps with these tables. Coverage groups:
     zero (Cover 0), man (Cover 1), twoMan (2-Man), two (Cover 2), three (Cover 3, Cover 9),
     quarters (Cover 4, Cover 6, combination). Each entry: [window 0-1, why]. */
  matrix: {
    quick: {
      zero: [0.66, "Against zero the ball is out before the free rusher arrives, and nobody's behind the receiver to tackle him."],
      man: [0.6, "Slants beat man if the receiver wins inside leverage; the free safety is too deep to help on a quick throw."],
      twoMan: [0.5, "Defenders trail underneath with help over the top; the slant window is tight against inside leverage."],
      two: [0.48, "Cover 2 corners squat in the flats, right on the quick game. The slant can work behind them, but it's tight."],
      three: [0.66, "Cover 3 gives you the flats and the slant window: the corners bail deep and there are only four underneath."],
      quarters: [0.68, "Quarters plays deep and reads; underneath is soft. The quick game is what it gives away."]
    },
    smash: {
      zero: [0.42, "The corner route takes too long against zero; the hitch alone is a quick answer."],
      man: [0.48, "Against man, smash is just two one-on-ones. Fine, but not built for it."],
      twoMan: [0.5, "Trailing man defenders with halves help: the hitch is the throw, the corner gets squeezed by the safety."],
      two: [0.76, "Smash is the Cover 2 beater: the corner can't take the hitch and the corner route at the same time."],
      three: [0.5, "Against Cover 3 the corner is already deep, sitting on the corner route. Only the hitch is there."],
      quarters: [0.6, "The quarters corner sinks; the hitch is open and the safety has to decide on the corner route."]
    },
    mesh: {
      zero: [0.56, "Crossers rub man defenders, but six rushers may get home before they clear."],
      man: [0.72, "Mesh is built for man: the crossers rub each other's defenders and someone comes open running away."],
      twoMan: [0.68, "Underneath man with help over the top: crossers run away from trailing defenders. A good answer."],
      two: [0.52, "Zone defenders sit in the crossing lanes; the crossers find holes, but not with momentum."],
      three: [0.55, "Against Cover 3 the crossers settle in the hook-curl holes. Workable, not a beater."],
      quarters: [0.62, "Underneath is soft in quarters; the crossers find space in front of the deep defenders."]
    },
    dagger: {
      zero: [0.3, "Too slow against zero: the rush arrives before the dig crosses."],
      man: [0.5, "The dig works if the receiver wins; the seam pulls the free safety, but the timing is long."],
      twoMan: [0.4, "The halves safety sits on the dig; man defenders trail it underneath."],
      two: [0.5, "The seam splits the halves safeties; the dig fits behind the linebackers if they carry the seam."],
      three: [0.66, "Dagger is a Cover 3 beater: the seam holds the middle safety and the dig comes open behind the hook defenders."],
      quarters: [0.44, "Quarters safeties read the slot vertical, then drive on the dig."]
    },
    verts: {
      zero: [0.42, "No safety deep, but four verticals need almost three seconds, and six rushers rarely give you that."],
      man: [0.42, "One-on-ones deep with a free safety helping on the inside routes."],
      twoMan: [0.3, "Two deep safeties plus trailing man defenders: verticals are bracketed."],
      two: [0.56, "The seams split the two halves safeties: the middle of Cover 2 is open."],
      three: [0.6, "Four verticals against three deep: someone has two receivers to cover."],
      quarters: [0.32, "Four deep defenders for four vertical routes. That's what quarters is built to stop."]
    },
    "pa-shot": {
      zero: [0.4, "A play fake takes time you don't have against zero."],
      man: [0.54, "If the fake freezes the linebackers and the free safety bites, the post is one-on-one."],
      twoMan: [0.36, "Safeties at depth don't bite on the fake."],
      two: [0.42, "Two-high safeties stay deep; the fake pulls linebackers, not safeties."],
      three: [0.58, "The single high safety and the rolled-down safety have run responsibilities; the fake pulls them, and the post comes open."],
      quarters: [0.46, "Quarters safeties read run hard; a good fake catches them, but they're deep to start."]
    },
    fade: {
      zero: [0.5, "No safety to help: if the receiver wins the release, it's a completion and maybe a touchdown."],
      man: [0.42, "One-on-one outside, away from the free safety's reach."],
      twoMan: [0.28, "A halves safety is sitting over the top of every fade."],
      two: [0.3, "The halves safety and the squatting corner bracket the fade."],
      three: [0.35, "The corner bails into the deep third, right where the fade is going."],
      quarters: [0.3, "The corner and the quarters safety both play deep."]
    },
    screen: {
      zero: [0.62, "Six rushers run themselves past the back; the screen is behind them."],
      man: [0.5, "The linebacker in man on the back follows him to the screen."],
      twoMan: [0.46, "Man defenders underneath and safeties deep; the screen has to beat the back's defender."],
      two: [0.46, "Five underneath zone defenders can rally to the screen."],
      three: [0.48, "Four underneath; the screen needs blockers to beat the hook defender."],
      quarters: [0.5, "Soft underneath, but the safeties fit fast."]
    }
  },
  // The one principle each film-room situation teaches.
  situations: {
    "first-ten": "First and 10 is about staying on schedule: 4 yards is a win. Take what the shell gives you; save the shot for when they sell out to stop the run.",
    "second-long": "Second and long: get half of it back. A call that reliably gains 5 sets up a third down you can actually convert.",
    "second-medium": "Second and medium is the freest down in football: you can run, throw or take a shot, and a miss still leaves a makeable third.",
    "second-short": "Second and short is a free shot: the defense has to respect the run, and a miss still leaves third and short.",
    "third-short": "Third and short: count the box. If you have more blockers than they have defenders, run it. If they've loaded it, throw where they took the defenders from.",
    "third-medium": "Third and medium: the call has to reach the sticks on time against the pressure they can send. Throws short of the sticks are punts.",
    "third-long": "Third and long: the defense is playing the sticks. A completion short of them doesn't count; neither does a sack.",
    "fourth-down": "Fourth down: the only thing that counts is the line to gain. Pick the call most likely to get there, not the one that looks best on film if it works.",
    "red-zone": "In the red zone the field shrinks: deep routes have nowhere to go, windows get tighter, and the run game and quick throws get relatively better.",
    "goal-line": "At the goal line every defender is in the box and every gap counts. Win the numbers, or throw where they've emptied out.",
    "two-minute": "In the two-minute drill, time is a resource: throws that stop the clock or gain big chunks; avoid sacks and runs that let the clock bleed."
  },

  // The one principle each situation teaches from the defensive side.
  situationsDefense: {
    "first-ten": "First and 10: hold them under 4 yards and you're ahead. Match personnel and play sound; the big pressure call is a bad bet on a down where they can run or throw anything.",
    "second-long": "Second and long: they need chunks. Keep everything in front, rally to the catch, and make them earn a manageable third down.",
    "second-medium": "Second and medium is the offense's freest down. Play your base answer to their personnel and don't guess.",
    "second-short": "Second and short: they'll take a shot because a miss still leaves third and short. Stop the run without giving up the play-action shot over the top.",
    "third-short": "Third and short: count the box. If you can't outnumber their blockers, take away the quick throw and make them win with a run they have to block perfectly.",
    "third-medium": "Third and medium: everything happens at the sticks. Rush enough to speed up the quarterback, and sit on the routes that reach the line to gain.",
    "third-long": "Third and long: you're playing the sticks, not the ball. Keep it in front, rally and tackle short of the line; a completion short of the sticks is a win.",
    "fourth-down": "Fourth down: one stop wins the series. Take away the call they trust most on this distance and make them beat your best.",
    "red-zone": "In the red zone the field shrinks in your favor: fewer deep threats, tighter windows. Play man where you can and don't give up the easy run.",
    "goal-line": "At the goal line every gap matters. Match heavy personnel with bodies, and don't let a play-action throw leak behind a run fit.",
    "two-minute": "In the two-minute drill, time is your friend. Keep the ball in front and inbounds, rally to the catch, and make them burn the clock."
  },

  // Answer choices shared by every scenario's diagnosis step.
  confidence: [
    { id: "guess", label: "Guessing" },
    { id: "some", label: "Some evidence" },
    { id: "strong", label: "Strong evidence" },
    { id: "certain", label: "Certain" }
  ],

  scenarios: [
    {
      id: "nickel-fire-3rd-6",
      title: "The Nickel Comes",
      module: "nickel-pressure",
      order: 1,
      type: "synthetic",
      status: "published",
      version: 1,
      provenance: {
        type: "synthetic",
        label: "Synthetic teaching scenario. Not a real NFL play: the game, teams and result are invented to teach one principle.",
        sources: [],
        fieldConfidence: { all: "synthetic" },
        reviewer: "unreviewed",
        notes: "Built to the vertical-slice spec: 11 personnel vs nickel, nickel pressure with safety replacement."
      },
      context: {
        quarter: 3, clock: "8:41", score: { you: 17, opp: 17 },
        down: 3, distance: 6, yardLine: 38, side: "opp", hash: "left",
        objective: "Convert. A miss leaves a 55-yard field goal or a 4th-and-short decision.",
        scouting: "This defense brings the nickel on about a third of its third downs, and it rotates a safety down behind it."
      },
      offense: {
        personnel: "11",
        personnelText: "11 personnel: 1 back, 1 tight end, 3 receivers",
        formation: "Trips right (3x1), back offset weak",
        players: [
          { id: "X", label: "X", role: "Receiver (backside)", x: 6.5, y: -1 },
          { id: "LT", label: "LT", role: "Left tackle", x: 21.0, y: -1 },
          { id: "LG", label: "LG", role: "Left guard", x: 22.3, y: -1 },
          { id: "C", label: "C", role: "Center", x: 23.6, y: -1 },
          { id: "RG", label: "RG", role: "Right guard", x: 24.9, y: -1 },
          { id: "RT", label: "RT", role: "Right tackle", x: 26.2, y: -1 },
          { id: "QB", label: "QB", role: "Quarterback (shotgun)", x: 23.6, y: -5 },
          { id: "RB", label: "RB", role: "Running back, offset weak", x: 21.8, y: -5 },
          { id: "Y", label: "Y", role: "Tight end, wing (#3 to trips)", x: 28.4, y: -2 },
          { id: "H", label: "H", role: "Slot receiver (#2)", x: 34.5, y: -1.8 },
          { id: "Z", label: "Z", role: "Receiver (#1 to trips)", x: 44, y: -1 }
        ]
      },
      defense: {
        personnel: "nickel",
        personnelText: "Nickel: 4 linemen, 2 linebackers, 5 defensive backs",
        front: "Four-down even front",
        shell: "two-high",
        boxCount: 7,
        disguise: "high",
        players: [
          { id: "CBB", label: "LCB", role: "Left cornerback (boundary)", x: 6.5, y: 7 },
          { id: "FS", label: "FS", role: "Free safety (boundary)", x: 17, y: 13 },
          { id: "DEB", label: "E", role: "Boundary end", x: 20.2, y: 1 },
          { id: "WILL", label: "W", role: "Will linebacker, mugged in the B-gap", x: 21.6, y: 2.6 },
          { id: "DT", label: "T", role: "Defensive tackle (3-technique)", x: 22.6, y: 1 },
          { id: "NT", label: "N", role: "Nose tackle", x: 24.1, y: 1 },
          { id: "MIKE", label: "M", role: "Mike linebacker", x: 25, y: 5 },
          { id: "DEF", label: "E", role: "Field end", x: 27.6, y: 1 },
          { id: "NB", label: "NB", role: "Nickel, walked down over the slot", x: 33.5, y: 2.2 },
          { id: "SS", label: "SS", role: "Strong safety (field, trips side)", x: 33, y: 13 },
          { id: "CBF", label: "RCB", role: "Right cornerback (field)", x: 44, y: 7 }
        ]
      },
      actual: {
        call: "fire-zone-3",
        pressure: "five",
        rushers: ["DT", "NT", "DEF", "WILL", "NB"],
        droppers: ["DEB", "MIKE"],
        coverage: "Cover 3 (fire zone)",
        rotation: "The strong safety rotates down to replace the nickel; the free safety rotates to the deep middle.",
        post: {
          DEB: { x: 17, y: 7, zone: "Hook-curl" },
          DT: { x: 22.3, y: -3 },
          NT: { x: 24, y: -3.5 },
          DEF: { x: 25.6, y: -3 },
          WILL: { x: 21.8, y: -3.2 },
          NB: { x: 27.5, y: -4 },
          MIKE: { x: 26, y: 8, zone: "Middle hook" },
          CBB: { x: 9, y: 15, zone: "Deep third" },
          CBF: { x: 43, y: 15, zone: "Deep third" },
          FS: { x: 26.5, y: 16, zone: "Deep middle" },
          SS: { x: 36, y: 7, zone: "Curl-flat (replaces the nickel)" }
        },
        events: [
          { t: 0.3, text: "The nickel and the Will declare: five are coming." },
          { t: 0.5, text: "The boundary end drops out to the hook-curl. The line now has a 'rusher' who isn't rushing." },
          { t: 0.8, text: "The strong safety rotates down to replace the nickel. The two-high picture becomes Cover 3." }
        ]
      },
      diagnosis: {
        questions: [
          {
            id: "personnel", prompt: "What defensive personnel is on the field?", kind: "single",
            options: [{ id: "base", label: "Base (4 DBs)" }, { id: "nickel", label: "Nickel (5 DBs)" }, { id: "dime", label: "Dime (6 DBs)" }],
            credit: { base: 20, nickel: 100, dime: 40 }, error: "personnel",
            explain: "Five defensive backs (two corners, two safeties, the nickel over the slot) and two linebackers: nickel. The nickel is a defensive back playing where a linebacker would."
          },
          {
            id: "shell", prompt: "What safety shell is the defense showing?", kind: "single",
            options: [{ id: "two", label: "Two-high" }, { id: "one", label: "One-high" }, { id: "zero", label: "Zero (no deep safety)" }],
            credit: { two: 100, one: 40, zero: 0 }, error: "shell",
            explain: "Both safeties sit at 13 yards outside the hashes: two-high. That's what it shows, not what it promises. On a passing down with a nickel walked down, a rotation to one-high is a standard move."
          },
          {
            id: "rushers", prompt: "Tap every defender who could rush.", kind: "rushers",
            answer: ["DEB", "DT", "NT", "DEF", "WILL", "MIKE", "NB"], critical: "NB", error: "pressure-count",
            explain: "Seven can come: four linemen, both linebackers, and the nickel. Six blockers can't block seven, so someone is the quarterback's problem. The corners at 7 yards and the safeties at 13 can't get home in time."
          },
          {
            id: "pressure", prompt: "What's the most likely pressure?", kind: "single",
            options: [{ id: "four", label: "Four-man rush" }, { id: "five", label: "Five-man pressure" }, { id: "six", label: "Six or more (Cover 0)" }],
            credit: { four: 60, five: 100, six: 30 }, error: "pressure-count",
            explain: "The evidence points to five: a walked-down nickel and a mugged linebacker, with two deep safeties still showing. Cover 0 would usually show it with a safety in the box. Four is plausible (either could bluff), so it earns partial credit."
          }
        ]
      },
      motions: [
        { id: "none", label: "No motion", text: "Snap it on the first sound. You keep your formation, and the defense keeps its secrets." },
        {
          id: "yoyo", label: "Slot yo-yo motion", detail: "H motions in toward the tight end and back out.",
          path: { from: "H", to: [30.5, -2], back: true },
          moves: { SS: [34, 10.5], MIKE: [25.6, 5] },
          text: "Nobody traveled with the slot, and the strong safety crept from 13 yards to 10. Zone, with that safety coming down. That's evidence, not proof: a well-coached defense can fake both.",
          clue: "No one followed the motion and the strong safety crept to 10 yards: zone behind the pressure, with that safety rotating down."
        },
        {
          id: "rbshift", label: "Shift the back to the nickel's side", detail: "RB moves from the weak side to the trips side.",
          path: { from: "RB", to: [25.4, -5] },
          moves: { NB: [33, 2.2] },
          text: "The Will stayed mugged in the B-gap after the back left his side, and the nickel inched inside. Both still look live. Your back is now closer to the nickel and farther from the Will.",
          clue: "After the shift the Will stayed in the B-gap and the nickel edged inside: both still looked live."
        }
      ],
      protections: [
        {
          id: "slide-nickel", label: "Slide to the nickel, back scans the Will",
          detail: "The line slides right to pick up the field end and the nickel; the left side blocks man, with the back on the Will.",
          hold: 2.9, grade: 95, category: "recommended",
          why: "All five who can come are accounted for, and nobody crosses the formation. If the Will doesn't come, the back has time to check down.",
          assignments: [
            { player: "RT", assignment: "Slide out to the nickel off the edge", key: "NB", win: "Meets the nickel before he turns the corner", fail: "Sets too shallow and the nickel beats him outside", p: 0.92 },
            { player: "RB", assignment: "Scan inside-out: Will first, then the boundary end", key: "WILL", win: "Squares up the Will in the B-gap", fail: "Looks outside first and the Will runs through the gap", p: 0.88 }
          ]
        },
        {
          id: "five", label: "Five-man protection, QB is hot off the nickel",
          detail: "The back releases. Five linemen block the four down linemen and the Will; if the nickel comes, the ball has to come out.",
          hold: 1.5, grade: 72, category: "valid", hotPlan: true,
          why: "Legitimate, but only with a route that's open as the nickel arrives. You've made the quarterback responsible for a free rusher.",
          assignments: [
            { player: "QB", assignment: "Treat the nickel as his: ball out the moment he declares", key: "NB", win: "Ball out before 1.5 seconds", fail: "Holds it a beat too long", p: 0.85 }
          ]
        },
        {
          id: "slide-away", label: "Slide away, back crosses to the nickel",
          detail: "The line slides left toward the Will; the back crosses the quarterback's face to block the nickel off the right edge.",
          hold: 1.9, grade: 55, category: "risky",
          why: "Every rusher has a name on paper, but the back starts on the wrong side. He has to travel 6 yards to meet a nickel who has a 2-yard head start.",
          assignments: [
            { player: "RB", assignment: "Cross the formation and cut off the nickel", key: "NB", win: "Gets there before the nickel turns the corner", fail: "Arrives late; the nickel has a free run", p: 0.45 }
          ]
        },
        {
          id: "max", label: "Max protection: tight end and back stay in",
          detail: "Seven blockers. Only three receivers go out.",
          hold: 3.5, grade: 60, category: "safe",
          why: "Everyone is blocked, but three receivers against six droppers on third down is a math problem in the other direction.",
          assignments: [
            { player: "Y", assignment: "Stay in and take the field end", key: "DEF", win: "Walls off the end", fail: "Gets beat inside", p: 0.9 }
          ]
        }
      ],
      plays: [
        {
          id: "stick", concept: "stick", label: "Stick to the trips side",
          detail: "H runs the 6-yard stick, Y runs to the flat, Z clears the corner deep. X runs a backside slant.",
          need: 2.2, window: 0.78, yards: 7, spread: 2, intRisk: 0.04, luck: 0.03,
          hot: { window: 0.62, yards: 6, spread: 2, text: "Ball out early to the stick" },
          grade: 95, category: "recommended",
          conflict: "SS",
          why: "Stick puts two receivers on the defender who replaces the nickel. If the rotating safety widens to the flat, the stick is open inside him; if he sits on the stick, the flat is open. It also gets the ball out before a fifth rusher arrives.",
          key: { answer: "SS", partial: { NB: "The nickel decides your protection, not where this ball goes. The safety who replaces him is the read.", MIKE: "The Mike is the inside limit of the window, but the read is the safety who rotates down." } },
          routes: [
            { from: "H", path: [[34.5, 2], [35, 6], [34.2, 5.6]] },
            { from: "Y", path: [[30, 1], [37, 2.5], [41, 3]] },
            { from: "Z", path: [[44, 8], [45, 18]] },
            { from: "X", path: [[7.5, 2], [12, 5]] }
          ],
          assignments: [
            { player: "QB", assignment: "Read the strong safety as he rotates down: flat if he sits, stick if he widens", key: "SS", win: "Throws away from the safety on rhythm", fail: "Stares at the stick and the safety jumps it", p: 0.82, keyBonus: 0.1, critical: true },
            { player: "H", assignment: "Stick at 6 yards, settle between the Mike and the rotating safety", key: "MIKE", win: "Sits in the window facing the QB", fail: "Drifts outside into the safety", p: 0.85, critical: true },
            { player: "Y", assignment: "Arrow to the flat to widen the safety", key: "SS", win: "Gets width fast enough to pull the safety", fail: "Gets rerouted and the safety never has to choose", p: 0.9, critical: true },
            { player: "Z", assignment: "Clear the field corner deep", key: "CBF", win: "Takes the corner out of the flat", fail: "Corner passes him off and squats", p: 0.95 }
          ]
        },
        {
          id: "verts", concept: "verts", label: "Four verticals",
          detail: "X and Z go, H and Y run the seams. The back checks, then releases.",
          need: 2.9, window: 0.56, yards: 24, spread: 8, intRisk: 0.12, luck: 0.1,
          grade: 76, category: "aggressive",
          conflict: "FS",
          why: "Against three deep, two seams on one middle safety is a real advantage, and the payoff is a chunk play. But it needs nearly three seconds, which is exactly what a five-man pressure is built to deny.",
          key: { answer: "FS", partial: { SS: "He's the read on the stick. On verticals he rotates down and out of the picture; the deep-middle safety is the one choosing a seam." } },
          routes: [
            { from: "X", path: [[6.5, 18]] },
            { from: "Z", path: [[44, 18]] },
            { from: "H", path: [[34.5, 6], [33, 18]] },
            { from: "Y", path: [[29, 6], [28, 18]] }
          ],
          assignments: [
            { player: "QB", assignment: "Hold the deep-middle safety with his eyes, then throw the seam he leaves", key: "FS", win: "Moves the safety and throws on time", fail: "Locks on one seam; the safety breaks on it", p: 0.72, keyBonus: 0.1, critical: true },
            { player: "H", assignment: "Seam: stay on the landmark outside the middle safety", key: "FS", win: "Stays on his landmark through the throw", fail: "Drifts inside and gives the safety two routes in one spot", p: 0.75, critical: true },
            { player: "X", assignment: "Win on the go against the boundary corner", key: "CBB", win: "Holds the corner deep", fail: "Gets pressed to the sideline", p: 0.8 }
          ]
        },
        {
          id: "draw", concept: "draw", label: "Draw",
          detail: "Show pass, let the rush come upfield, hand off behind it.",
          kind: "run", need: 0, window: 0.32, yards: 8, spread: 3, failYards: 2, failSpread: 2, luck: 0.04,
          grade: 52, category: "conservative",
          conflict: "MIKE",
          why: "A draw punishes upfield rushers, but this pressure sends the Will straight into the draw lane and drops the Mike right on top of it. Even when it works, 6 yards is a lot to ask of a draw.",
          key: { answer: "MIKE", partial: { WILL: "The Will is coming either way. The Mike decides whether there's a lane." } },
          routes: [{ from: "RB", path: [[23.6, -3], [24.6, 3], [25, 8]] }],
          assignments: [
            { player: "C", assignment: "Invite the nose upfield, then wall him off", key: "NT", win: "Opens the A-gap", fail: "Gets driven back into the mesh", p: 0.8, critical: true },
            { player: "RB", assignment: "Sell pass, then read the Mike's fit", key: "MIKE", win: "Hits the lane before the Mike fills it", fail: "Runs into the dropping Mike", p: 0.7, critical: true }
          ]
        },
        {
          id: "slant", concept: "hot-slant", label: "Hot slant to the slot",
          detail: "H runs a three-step slant right through the spot the nickel just left.",
          need: 1.3, window: 0.28, yards: 7, spread: 3, intRisk: 0.22, luck: 0.02,
          grade: 35, category: "poor",
          conflict: "SS",
          why: "It's the most natural answer and the one this call is designed to bait. The nickel leaves, but the strong safety is already rotating into exactly that window, and the Mike's hook drop squeezes it from inside.",
          key: { answer: "NB", partial: { SS: "Right defender, wrong plan: if he's the threat, the slant shouldn't be the call." } },
          routes: [{ from: "H", path: [[34.5, 1], [30.5, 4.5]] }, { from: "Z", path: [[44, 1.5], [40.5, 5]] }],
          assignments: [
            { player: "QB", assignment: "Throw hot the moment the nickel declares", key: "NB", win: "Ball out in rhythm", fail: "Late; the safety has arrived", p: 0.95, critical: true },
            { player: "H", assignment: "Flat slant, inside the nickel's vacated spot", key: "SS", win: "Catches it before the safety triggers", fail: "Runs into the rotating safety", p: 0.85, critical: true }
          ]
        }
      ],
      contingencies: [
        {
          id: "built-in", label: "Built-in hot: if the nickel comes clean, ball out to the quick route now", onPressure: "hot",
          grades: { stick: 95, verts: 40, draw: 50, slant: 85 },
          why: "Stick is its own hot answer: the stick and the flat are open as the pressure arrives. Verticals has no quick route, so 'hot' means nothing there."
        },
        {
          id: "sight", label: "Sight adjust: the slot converts his route to a slant against pressure", onPressure: "sight",
          throw: { window: 0.28, yards: 7, spread: 3, intRisk: 0.22, text: "Sight-adjusted slant" },
          grades: { stick: 50, verts: 60, draw: 40, slant: 60 },
          why: "A real tool, but against a fire zone it throws into the replacement defender: the slant goes where the strong safety is rotating."
        },
        {
          id: "throwaway", label: "If the window closes, climb and throw it away", onPressure: "throwaway",
          grades: { stick: 75, verts: 75, draw: 60, slant: 70 },
          why: "Safe and sound: a throwaway on third down keeps the field goal. It's a floor, not an answer."
        },
        {
          id: "none", label: "Hold it: trust the protection", onPressure: "none",
          grades: { stick: 20, verts: 20, draw: 50, slant: 20 },
          why: "With seven possible rushers and six blockers at most, 'trust it' is how a third down becomes a sack and a punt."
        }
      ],
      interactions: [
        { when: { protection: "slide-away", motion: "rbshift" }, hold: 0.8, protection: 20, note: "Shifting the back to the nickel's side shortens his trip: now he can meet the nickel at the edge." },
        { when: { protection: "slide-nickel", motion: "rbshift" }, hold: -0.5, protection: -10, note: "You moved the back away from the Will he's supposed to scan; now he has to cross back to get him." },
        { when: { protection: "max", play: "stick" }, window: -0.45, play: -25, note: "Max protection keeps the tight end in to block, and he was the flat runner. The stick loses the route that widens the safety." },
        { when: { protection: "max", play: "verts" }, window: -0.2, play: -5, note: "With the tight end and back in, only three go deep against three deep defenders: you bought time but gave up the extra receiver." },
        { when: { protection: "five", play: "verts" }, protection: -30, note: "Five-man protection on a three-second concept leaves the nickel unblocked with nowhere to throw." },
        { when: { play: "draw" }, note: "On a draw the protection is a sell job: the line's job is to invite the rush, so the protection call matters less." }
      ],
      recommended: { motion: "yoyo", protection: "slide-nickel", play: "stick", contingency: "built-in" },
      fit: { downs: [3], distance: [4, 8], coverage: ["COVER_3"], rushers: [5, 5], blitz: true },
      clues: [
        { text: "The nickel is walked down to 2 yards, inside-shaded on the slot. That's a blitz alignment, not a coverage alignment.", kind: "meaningful" },
        { text: "The Will is mugged in the boundary B-gap: a second pressure threat on the other side of the formation.", kind: "meaningful" },
        { text: "Two-high shell. True before the snap, but a safety rotating down behind a blitzer is the whole point of a fire zone.", kind: "uncertain" },
        { text: "The boundary end was in a pass-rush stance. He dropped into coverage at the snap.", kind: "deceptive" }
      ],
      next: "The defense saw you answer nickel pressure with stick to the trips side. Expect the same look again, with the nickel bluffing and bailing into the window you just threw.",
      takeaway: "When a blitzer leaves, someone replaces him. Protect for the threat, then throw away from the replacement, not into the spot the blitzer vacated.",
      learning: {
        objectives: ["Count possible rushers against available blockers", "Identify the replacement defender in a fire zone", "Pair a protection with a built-in hot answer"],
        tags: ["nickel-pressure", "replacement-defender", "protection-count"],
        misconceptions: ["Throw hot to the spot the blitzer left"],
        difficulty: 2,
        transfer: ["3x1 to 2x2", "Field side right to left", "Real pressure to bluff"],
        revisitDays: 2
      }
    },

    {
      id: "nickel-bluff-2nd-7",
      title: "Same Look, Different Answer",
      module: "nickel-pressure",
      order: 2,
      type: "synthetic",
      status: "published",
      version: 1,
      provenance: {
        type: "synthetic",
        label: "Synthetic teaching scenario. Not a real NFL play: the game, teams and result are invented to teach one principle.",
        sources: [],
        fieldConfidence: { all: "synthetic" },
        reviewer: "unreviewed",
        notes: "The transfer test for 'The Nickel Comes': the same pre-snap tells, the formation and field side flipped, and the pressure is a bluff."
      },
      context: {
        quarter: 2, clock: "3:10", score: { you: 10, opp: 3 },
        down: 2, distance: 7, yardLine: 42, side: "own", hash: "right",
        objective: "Stay ahead of the chains. A first down is great; 4 yards to set up 3rd-and-short is a win too.",
        scouting: "Same defense. On second-and-medium it shows the nickel walked down about as often as it brings him."
      },
      offense: {
        personnel: "11",
        personnelText: "11 personnel: 1 back, 1 tight end, 3 receivers",
        formation: "Doubles (2x2), tight end wing right, back offset right",
        players: [
          { id: "X", label: "X", role: "Receiver (#1 to the field)", x: 9, y: -1 },
          { id: "H", label: "H", role: "Slot receiver (#2 to the field)", x: 17, y: -1.8 },
          { id: "LT", label: "LT", role: "Left tackle", x: 27.1, y: -1 },
          { id: "LG", label: "LG", role: "Left guard", x: 28.4, y: -1 },
          { id: "C", label: "C", role: "Center", x: 29.7, y: -1 },
          { id: "RG", label: "RG", role: "Right guard", x: 31, y: -1 },
          { id: "RT", label: "RT", role: "Right tackle", x: 32.3, y: -1 },
          { id: "QB", label: "QB", role: "Quarterback (shotgun)", x: 29.7, y: -5 },
          { id: "RB", label: "RB", role: "Running back, offset right", x: 31.5, y: -5 },
          { id: "Y", label: "Y", role: "Tight end, wing (#2 to the boundary)", x: 34.6, y: -2 },
          { id: "Z", label: "Z", role: "Receiver (#1 to the boundary)", x: 46, y: -1 }
        ]
      },
      defense: {
        personnel: "nickel",
        personnelText: "Nickel: 4 linemen, 2 linebackers, 5 defensive backs",
        front: "Four-down even front",
        shell: "two-high",
        boxCount: 7,
        disguise: "high",
        players: [
          { id: "CBF", label: "LCB", role: "Left cornerback (field)", x: 9, y: 6 },
          { id: "NB", label: "NB", role: "Nickel, walked down over the slot", x: 18, y: 2.2 },
          { id: "FS", label: "FS", role: "Free safety (field)", x: 21, y: 13 },
          { id: "DEF", label: "E", role: "Field end", x: 26, y: 1 },
          { id: "MIKE", label: "M", role: "Mike linebacker", x: 28.6, y: 5 },
          { id: "NT", label: "N", role: "Nose tackle", x: 29.2, y: 1 },
          { id: "DT", label: "T", role: "Defensive tackle (3-technique)", x: 31.4, y: 1 },
          { id: "WILL", label: "W", role: "Will linebacker, mugged in the B-gap", x: 31.7, y: 2.6 },
          { id: "DEB", label: "E", role: "Boundary end", x: 33.6, y: 1 },
          { id: "SS", label: "SS", role: "Strong safety (boundary, tight end side)", x: 37, y: 13 },
          { id: "CBB", label: "RCB", role: "Right cornerback (boundary)", x: 46, y: 7 }
        ]
      },
      actual: {
        call: "cover-2-bluff",
        pressure: "four",
        rushers: ["DEF", "NT", "DT", "DEB"],
        droppers: ["NB", "WILL", "MIKE"],
        coverage: "Cover 2",
        rotation: "None. Both safeties stay high and split the deep halves; the corners squat in the flats.",
        post: {
          CBF: { x: 11, y: 4, zone: "Flat" },
          NB: { x: 19.5, y: 8, zone: "Curl (bluffed)" },
          FS: { x: 17, y: 17, zone: "Deep half" },
          DEF: { x: 27, y: -3.5 },
          MIKE: { x: 27, y: 9, zone: "Middle hook" },
          NT: { x: 29.4, y: -3 },
          DT: { x: 31, y: -3 },
          WILL: { x: 34, y: 8, zone: "Curl (bluffed)" },
          DEB: { x: 33, y: -3.5 },
          SS: { x: 40, y: 17, zone: "Deep half" },
          CBB: { x: 44, y: 4, zone: "Flat" }
        },
        events: [
          { t: 0.2, text: "The nickel and the Will both bail at the snap. Only the four linemen rush." },
          { t: 0.6, text: "Both safeties stay high: the two-high shell was real. Cover 2." },
          { t: 0.9, text: "The field corner squats in the flat, sitting on anything short and outside." }
        ]
      },
      diagnosis: {
        questions: [
          {
            id: "personnel", prompt: "What defensive personnel is on the field?", kind: "single",
            options: [{ id: "base", label: "Base (4 DBs)" }, { id: "nickel", label: "Nickel (5 DBs)" }, { id: "dime", label: "Dime (6 DBs)" }],
            credit: { base: 20, nickel: 100, dime: 40 }, error: "personnel",
            explain: "Same nickel package: two corners, two safeties, the nickel over the slot, two linebackers. It's on the other side of the field now."
          },
          {
            id: "shell", prompt: "What safety shell is the defense showing?", kind: "single",
            options: [{ id: "two", label: "Two-high" }, { id: "one", label: "One-high" }, { id: "zero", label: "Zero (no deep safety)" }],
            credit: { two: 100, one: 40, zero: 0 }, error: "shell",
            explain: "Two-high again, both at 13 yards. This time it stayed two-high. You can't know that before the snap, which is why the call has to survive either answer."
          },
          {
            id: "rushers", prompt: "Tap every defender who could rush.", kind: "rushers",
            answer: ["DEF", "NT", "DT", "DEB", "WILL", "MIKE", "NB"], critical: "NB", error: "pressure-count",
            explain: "The same seven can come: four linemen, both linebackers, the nickel. Mirroring the formation doesn't change the count."
          },
          {
            id: "pressure", prompt: "What's the most likely pressure?", kind: "single",
            options: [{ id: "four", label: "Four-man rush" }, { id: "five", label: "Five-man pressure" }, { id: "six", label: "Six or more (Cover 0)" }],
            credit: { four: 60, five: 100, six: 30 }, error: "pressure-count",
            explain: "Pre-snap, this is the same picture as a five-man pressure, so five is still the best read of the evidence. It turned out to be a bluff. Reading the evidence correctly and being fooled by a disguise are not the same mistake."
          }
        ]
      },
      motions: [
        { id: "none", label: "No motion", text: "Snap it. You keep the formation, and the defense keeps its disguise." },
        {
          id: "yoyo", label: "Slot yo-yo motion", detail: "H motions in toward the formation and back out.",
          path: { from: "H", to: [23, -2], back: true },
          moves: { NB: [19.6, 2.8], CBF: [9.5, 5] },
          text: "The nickel widened with the slot and backed off half a yard, and both safeties stayed at 13. A defender who's really blitzing usually doesn't chase motion. It's evidence the pressure may be a bluff, not proof.",
          clue: "On motion the nickel widened with the slot and both safeties held at 13: a defender who's really coming rarely chases."
        },
        {
          id: "rbshift", label: "Shift the back to the nickel's side", detail: "RB moves from the right to the left of the quarterback.",
          path: { from: "RB", to: [27.9, -5] },
          moves: {},
          text: "Nobody adjusted. The Will stayed mugged, the nickel stayed down. The shift moved your back closer to the nickel and gave away nothing about the coverage.",
          clue: "Nobody moved on the back's shift: no new information."
        }
      ],
      protections: [
        {
          id: "slide-nickel", label: "Slide to the nickel, back scans the Will",
          detail: "The line slides left toward the nickel; the right side blocks man, with the back on the Will.",
          hold: 3.4, grade: 95, category: "recommended",
          why: "Same answer as before because it's the same threat: all seven possible rushers have a plan. When the nickel and the Will bail, the back is free to check down.",
          assignments: [
            { player: "LT", assignment: "Slide out to the nickel off the edge, pass to the end if he bails", key: "NB", win: "Sees the bail and helps inside", fail: "Chases the bailing nickel and leaves a gap", p: 0.92 },
            { player: "RB", assignment: "Scan: Will first, then release to the flat", key: "WILL", win: "Sees the Will drop and releases as an outlet", fail: "Stays in to block nobody", p: 0.9 }
          ]
        },
        {
          id: "five", label: "Five-man protection, QB is hot off the nickel",
          detail: "The back releases. Five linemen take the four down linemen and the Will.",
          hold: 3.0, grade: 72, category: "valid", hotPlan: true,
          why: "It held because the nickel didn't come, not because the plan accounted for him. Same process grade as last time.",
          assignments: [
            { player: "QB", assignment: "Treat the nickel as his: ball out the moment he declares", key: "NB", win: "Recognizes the bail and stays on schedule", fail: "Throws hot to a route that isn't there", p: 0.9 }
          ]
        },
        {
          id: "slide-away", label: "Slide away, back crosses to the nickel",
          detail: "The line slides right toward the Will; the back crosses to block the nickel off the left edge.",
          hold: 3.1, grade: 55, category: "risky",
          why: "It worked only because the nickel didn't rush. If he had, the back's 6-yard trip loses to his 2-yard head start every time.",
          assignments: [
            { player: "RB", assignment: "Cross the formation toward the nickel", key: "NB", win: "Gets there, finds no one, releases", fail: "Arrives late", p: 0.9 }
          ]
        },
        {
          id: "max", label: "Max protection: tight end and back stay in",
          detail: "Seven blockers. Three receivers go out.",
          hold: 3.8, grade: 60, category: "safe",
          why: "Seven block four. Safe, but on second down against a bluff you've left four blockers with nobody to block.",
          assignments: [
            { player: "Y", assignment: "Stay in and take the boundary end", key: "DEB", win: "Walls off the end", fail: "Gets beat inside", p: 0.92 }
          ]
        }
      ],
      plays: [
        {
          id: "smash", concept: "smash", label: "Smash to the field",
          detail: "X runs a 5-yard hitch, H runs a corner route over it. Y and Z run a backside curl-flat.",
          need: 2.5, window: 0.76, yards: 11, spread: 6, intRisk: 0.05, luck: 0.03,
          hot: { window: 0.6, yards: 5, spread: 2, text: "Ball out early to the hitch" },
          grade: 95, category: "recommended",
          conflict: "CBF",
          why: "Smash high-lows the field corner, the flat defender in Cover 2. If he squats on the hitch, the corner route is open behind him before the halves safety can get there; if he sinks, the hitch is free. Against pressure, the hitch is the hot answer.",
          key: { answer: "CBF", partial: { FS: "He's the help over the top. The corner's choice decides the throw.", NB: "The nickel decides your protection. In Cover 2, he bails inside of smash." } },
          routes: [
            { from: "X", path: [[9, 5], [9.6, 4.2]] },
            { from: "H", path: [[17, 9], [11, 15]] },
            { from: "Y", path: [[35.5, 2], [42, 3]] },
            { from: "Z", path: [[46, 9], [45, 8]] }
          ],
          assignments: [
            { player: "QB", assignment: "Read the field corner: hitch if he sinks, corner route if he squats", key: "CBF", win: "Throws away from the corner on time", fail: "Throws the hitch into a squatting corner", p: 0.84, keyBonus: 0.1, critical: true },
            { player: "H", assignment: "Corner route: break at 10 to 12 yards, stay away from the halves safety", key: "FS", win: "Climbs to the sideline, away from the safety", fail: "Flattens the route into the safety's range", p: 0.82, critical: true },
            { player: "X", assignment: "Hitch at 5: win inside and present your numbers", key: "CBF", win: "Squares up fast", fail: "Drifts and makes a tight window tighter", p: 0.9 }
          ]
        },
        {
          id: "verts", concept: "verts", label: "Four verticals",
          detail: "X and Z go, H and Y bend their seams away from the halves safeties.",
          need: 2.8, window: 0.6, yards: 22, spread: 8, intRisk: 0.1, luck: 0.1,
          grade: 80, category: "aggressive",
          conflict: "FS",
          why: "Cover 2 is soft down the middle seams, and a four-man rush gives you time. It's a real shot, but it would have been a sack if the nickel had come. You couldn't know he wouldn't.",
          key: { answer: "FS", partial: { MIKE: "In Tampa 2 the Mike runs the middle. Here he stays shallow, so the halves safety is the choice." } },
          routes: [
            { from: "X", path: [[9, 18]] },
            { from: "H", path: [[17, 7], [22, 18]] },
            { from: "Y", path: [[34.6, 7], [31, 18]] },
            { from: "Z", path: [[46, 18]] }
          ],
          assignments: [
            { player: "QB", assignment: "Hold the free safety with his eyes, throw the seam he leaves", key: "FS", win: "Moves the safety and throws on time", fail: "Stares at H and the safety rides the seam", p: 0.74, keyBonus: 0.1, critical: true },
            { player: "H", assignment: "Bend the seam away from the halves safety", key: "FS", win: "Splits the halves safeties", fail: "Runs into the safety's leverage", p: 0.76, critical: true }
          ]
        },
        {
          id: "draw", concept: "draw", label: "Draw",
          detail: "Show pass, let the four rushers come upfield, hand off behind them.",
          kind: "run", need: 0, window: 0.38, yards: 8, spread: 3, failYards: 3, failSpread: 2, luck: 0.04,
          grade: 80, category: "high-floor",
          conflict: "MIKE",
          why: "Against a four-man rush with both linebackers bailing, the box empties out. On second-and-medium a 4-yard draw sets up third-and-short. A real answer to the bluff, and still a reasonable call if the pressure is real.",
          key: { answer: "MIKE", partial: { WILL: "The Will bails here, so he's gone. The Mike is the one who has to fill." } },
          routes: [{ from: "RB", path: [[29.7, -3], [29.2, 3], [29, 8]] }],
          assignments: [
            { player: "C", assignment: "Invite the nose upfield, then wall him off", key: "NT", win: "Opens the A-gap", fail: "Gets driven back into the mesh", p: 0.82, critical: true },
            { player: "RB", assignment: "Sell pass, then hit the lane the rush vacates", key: "MIKE", win: "Gets to the second level", fail: "The Mike fills the hole", p: 0.78, critical: true }
          ]
        },
        {
          id: "slant", concept: "hot-slant", label: "Hot slant to the slot",
          detail: "H runs a three-step slant through the spot the nickel is showing.",
          need: 1.3, window: 0.24, yards: 7, spread: 3, intRisk: 0.22, luck: 0.02,
          grade: 35, category: "poor",
          conflict: "NB",
          why: "This time the nickel doesn't leave: he bails straight back into the slant's path. Against a bluff the hot slant runs into the 'blitzer' himself.",
          key: { answer: "NB", partial: {} },
          routes: [{ from: "H", path: [[17, 1], [21, 4.5]] }, { from: "X", path: [[9, 1.5], [12.5, 5]] }],
          assignments: [
            { player: "QB", assignment: "Throw hot off the nickel", key: "NB", win: "Sees the bail and moves on", fail: "Throws it to the bailing nickel", p: 0.7, critical: true },
            { player: "H", assignment: "Slant inside the nickel", key: "NB", win: "Wins inside before the nickel settles", fail: "Runs into the nickel's drop", p: 0.8, critical: true }
          ]
        }
      ],
      contingencies: [
        {
          id: "built-in", label: "Built-in hot: if the nickel comes clean, ball out to the quick route now", onPressure: "hot",
          grades: { smash: 95, verts: 40, draw: 50, slant: 85 },
          why: "The smash hitch is the built-in hot: if the nickel comes, it's open as he arrives. Four verticals has no quick route."
        },
        {
          id: "sight", label: "Sight adjust: the slot converts his route to a slant against pressure", onPressure: "sight",
          throw: { window: 0.24, yards: 7, spread: 3, intRisk: 0.22, text: "Sight-adjusted slant" },
          grades: { smash: 55, verts: 60, draw: 40, slant: 60 },
          why: "A real tool, but its trigger is the nickel showing pressure. Against a bluff the slot converts into a defender who is dropping into the slant."
        },
        {
          id: "throwaway", label: "If the window closes, climb and throw it away", onPressure: "throwaway",
          grades: { smash: 75, verts: 75, draw: 60, slant: 70 },
          why: "A sound floor: third-and-medium is better than a sack."
        },
        {
          id: "none", label: "Hold it: trust the protection", onPressure: "none",
          grades: { smash: 20, verts: 20, draw: 50, slant: 20 },
          why: "It happened to be fine, because only four came. The plan didn't account for the seven who could have."
        }
      ],
      interactions: [
        { when: { protection: "max", play: "smash" }, window: -0.05, note: "Smash only needs two receivers, so max protection costs little, but it takes away the backside answer." },
        { when: { protection: "max", play: "verts" }, window: -0.2, play: -5, note: "With the tight end and back in, only three go deep: you bought time against a rush that didn't need it." },
        { when: { protection: "five", play: "verts" }, protection: -30, note: "Five-man protection on a three-second concept: if the nickel had come, nobody blocks him and nobody's open." },
        { when: { protection: "slide-away", motion: "rbshift" }, protection: 20, note: "Shifting the back to the nickel's side shortens his trip to the edge." },
        { when: { play: "draw" }, note: "On a draw the protection is a sell job: the line invites the rush, so the protection call matters less." }
      ],
      recommended: { motion: "yoyo", protection: "slide-nickel", play: "smash", contingency: "built-in" },
      fit: { downs: [2], distance: [5, 9], coverage: ["COVER_2"], rushers: [4, 4], blitz: false },
      clues: [
        { text: "The nickel is walked down to 2 yards over the slot: the same blitz alignment as last time.", kind: "uncertain" },
        { text: "The Will is mugged in the B-gap again, on the boundary side.", kind: "uncertain" },
        { text: "Two-high shell, and this time it stayed two-high.", kind: "meaningful" },
        { text: "The nickel's walked-down alignment. He bailed to the curl at the snap.", kind: "deceptive" }
      ],
      next: "Now the defense knows you'll attack its Cover 2 corner. Expect a Cover 3 rotation from this same picture, which takes smash away and brings stick back.",
      takeaway: "A pressure look is evidence, not a promise. Protect for the threat, and pick a call that works whether or not he comes.",
      learning: {
        objectives: ["Recognize disguised (bluffed) pressure", "Choose a call that survives both pressure and a bluff", "Judge a protection by its plan, not its result"],
        tags: ["nickel-pressure", "pressure-disguise", "protection-count"],
        misconceptions: ["A walked-down nickel means he's coming"],
        difficulty: 3,
        transfer: ["Formation 3x1 to 2x2", "Field side right to left", "Real pressure to bluff"],
        revisitDays: 3
      }
    },

    {
      id: "nickel-man-3rd-5",
      title: "Man Behind It",
      module: "nickel-pressure",
      order: 3,
      type: "synthetic",
      status: "published",
      version: 1,
      provenance: {
        type: "synthetic",
        label: "Synthetic teaching scenario. Not a real NFL play: the game, teams and result are invented to teach one principle.",
        sources: [],
        fieldConfidence: { all: "synthetic" },
        reviewer: "unreviewed",
        notes: "The man-coverage version of the nickel pressure: the same slant that loses to a fire zone wins here."
      },
      context: {
        quarter: 4, clock: "5:27", score: { you: 20, opp: 24 },
        down: 3, distance: 5, yardLine: 45, side: "own", hash: "middle",
        objective: "Convert. Down four with five minutes left, a punt here might be the game.",
        scouting: "This defense plays man on about half its third downs, and its nickel blitzes out of it."
      },
      offense: {
        personnel: "11",
        personnelText: "11 personnel: 1 back, 1 tight end, 3 receivers",
        formation: "Doubles (2x2), tight end attached right, back offset right",
        players: [
          { id: "X", label: "X", role: "Receiver (#1 left)", x: 8, y: -1 },
          { id: "H", label: "H", role: "Slot receiver (#2 left)", x: 17, y: -1.8 },
          { id: "LT", label: "LT", role: "Left tackle", x: 24.05, y: -1 },
          { id: "LG", label: "LG", role: "Left guard", x: 25.35, y: -1 },
          { id: "C", label: "C", role: "Center", x: 26.65, y: -1 },
          { id: "RG", label: "RG", role: "Right guard", x: 27.95, y: -1 },
          { id: "RT", label: "RT", role: "Right tackle", x: 29.25, y: -1 },
          { id: "Y", label: "Y", role: "Tight end, attached right", x: 30.7, y: -1 },
          { id: "QB", label: "QB", role: "Quarterback (shotgun)", x: 26.65, y: -5 },
          { id: "RB", label: "RB", role: "Running back, offset right", x: 28.5, y: -5 },
          { id: "Z", label: "Z", role: "Receiver (#1 right)", x: 45, y: -1.8 }
        ]
      },
      defense: {
        personnel: "nickel",
        personnelText: "Nickel: 4 linemen, 2 linebackers, 5 defensive backs",
        front: "Four-down even front",
        shell: "one-high",
        boxCount: 6,
        disguise: "low",
        players: [
          { id: "CBL", label: "LCB", role: "Left cornerback, pressed on X", x: 8, y: 1.5 },
          { id: "NB", label: "NB", role: "Nickel, walked down over the slot", x: 18, y: 2 },
          { id: "SS", label: "SS", role: "Strong safety, down at 8 yards", x: 22, y: 8.5 },
          { id: "DEL", label: "E", role: "Left end", x: 23, y: 1 },
          { id: "WILL", label: "W", role: "Will linebacker", x: 24.6, y: 4.5 },
          { id: "DT", label: "T", role: "Defensive tackle", x: 25.2, y: 1 },
          { id: "FS", label: "FS", role: "Free safety, deep middle", x: 26.65, y: 13 },
          { id: "NT", label: "N", role: "Nose tackle", x: 27.5, y: 1 },
          { id: "MIKE", label: "M", role: "Mike linebacker", x: 28.4, y: 4.5 },
          { id: "DER", label: "E", role: "Right end", x: 30.6, y: 1 },
          { id: "CBR", label: "RCB", role: "Right cornerback, pressed on Z", x: 45, y: 1.5 }
        ]
      },
      actual: {
        call: "cover-1-nickel",
        pressure: "five",
        rushers: ["DEL", "DT", "NT", "DER", "NB"],
        droppers: ["WILL", "MIKE"],
        coverage: "Cover 1 (man-free)",
        rotation: "No rotation. The free safety stays deep in the middle; everyone else is in man. With the nickel blitzing, the strong safety has to come from 8 yards deep to cover the slot.",
        post: {
          CBL: { x: 9, y: 8, zone: "Man: X" },
          NB: { x: 22.5, y: -4 },
          SS: { x: 19.5, y: 5, zone: "Man: slot (from depth)" },
          DEL: { x: 24, y: -3 },
          WILL: { x: 30, y: 3, zone: "Man: back" },
          DT: { x: 25.3, y: -3 },
          FS: { x: 26.65, y: 16, zone: "Deep middle" },
          NT: { x: 27.5, y: -3 },
          MIKE: { x: 32.5, y: 5, zone: "Man: tight end" },
          DER: { x: 29.8, y: -3.5 },
          CBR: { x: 44, y: 8, zone: "Man: Z" }
        },
        events: [
          { t: 0.2, text: "Both corners turn and run with their receivers: man coverage across the board." },
          { t: 0.3, text: "The nickel blitzes off the left edge. Five are coming." },
          { t: 0.6, text: "The strong safety triggers from 8 yards to cover the slot the nickel left. He's late and has to come from outside-in." }
        ]
      },
      diagnosis: {
        questions: [
          {
            id: "personnel", prompt: "What defensive personnel is on the field?", kind: "single",
            options: [{ id: "base", label: "Base (4 DBs)" }, { id: "nickel", label: "Nickel (5 DBs)" }, { id: "dime", label: "Dime (6 DBs)" }],
            credit: { base: 20, nickel: 100, dime: 40 }, error: "personnel",
            explain: "Two corners, a nickel, two safeties: five defensive backs. Nickel."
          },
          {
            id: "shell", prompt: "What safety shell is the defense showing?", kind: "single",
            options: [{ id: "two", label: "Two-high" }, { id: "one", label: "One-high" }, { id: "zero", label: "Zero (no deep safety)" }],
            credit: { two: 30, one: 100, zero: 40 }, error: "shell",
            explain: "One safety deep in the middle at 13 yards, the other down at 8: one-high. One-high means Cover 1 or Cover 3 is most likely. The pressed corners tilt it toward man."
          },
          {
            id: "rushers", prompt: "Tap every defender who could rush.", kind: "rushers",
            answer: ["DEL", "DT", "NT", "DER", "WILL", "MIKE", "NB"], critical: "NB", error: "pressure-count",
            explain: "Seven can come: four linemen, both linebackers, the nickel. The strong safety at 8 yards could too, but late; the corners are pressed on receivers."
          },
          {
            id: "pressure", prompt: "What's the most likely pressure?", kind: "single",
            options: [{ id: "four", label: "Four-man rush" }, { id: "five", label: "Five-man pressure" }, { id: "six", label: "Six or more (Cover 0)" }],
            credit: { four: 60, five: 100, six: 50 }, error: "pressure-count",
            explain: "A walked-down nickel with a deep safety still in the middle: five-man pressure with man behind it is the classic version. Six would usually take the deep safety away too."
          }
        ]
      },
      motions: [
        { id: "none", label: "No motion", text: "Snap it. You don't learn whether it's man until the ball is out." },
        {
          id: "yoyo", label: "Slot yo-yo motion", detail: "H motions in toward the line and back out.",
          path: { from: "H", to: [22, -2], back: true },
          moves: { NB: [18.4, 2.2], SS: [21.2, 8] },
          text: "The nickel ran with the slot all the way in and back out. That's man coverage. If he blitzes, somebody else has to cover the slot, and the strong safety creeping down is the likely candidate.",
          clue: "The nickel ran with the slot in and back out: man coverage, so the blitzer's receiver goes to someone farther away."
        },
        {
          id: "rbshift", label: "Shift the back to the nickel's side", detail: "RB moves from the right to the left of the quarterback.",
          path: { from: "RB", to: [24.8, -5] },
          moves: { WILL: [25.2, 4.5], MIKE: [27.8, 4.5] },
          text: "Both linebackers bumped with the back. They're keyed on the back and the tight end, man again. The nickel didn't move.",
          clue: "The linebackers bumped with the back's shift: they're in man on the back and tight end."
        }
      ],
      protections: [
        {
          id: "slide-nickel", label: "Slide to the nickel, back scans the Will",
          detail: "The line slides left toward the nickel; the right side blocks man, with the back checking the Will.",
          hold: 2.9, grade: 95, category: "recommended",
          why: "All seven possible rushers have a plan. When the Will drops into man on the back, the back releases late as an outlet.",
          assignments: [
            { player: "LT", assignment: "Slide out to the nickel off the edge", key: "NB", win: "Meets the nickel before he turns the corner", fail: "Gets beat outside", p: 0.92 },
            { player: "RB", assignment: "Scan the Will, then release", key: "WILL", win: "Sees the Will cover him and releases", fail: "Stays in to block nobody", p: 0.9 }
          ]
        },
        {
          id: "five", label: "Five-man protection, QB is hot off the nickel",
          detail: "The back releases. If the nickel comes, the ball comes out.",
          hold: 1.5, grade: 75, category: "valid", hotPlan: true,
          why: "Better here than against a fire zone: against man, the hot throw goes to the receiver the blitzer left, and nobody is replacing him underneath.",
          assignments: [
            { player: "QB", assignment: "Treat the nickel as his: ball out the moment he declares", key: "NB", win: "Ball out before 1.5 seconds", fail: "Holds it a beat too long", p: 0.85 }
          ]
        },
        {
          id: "slide-away", label: "Slide away, back crosses to the nickel",
          detail: "The line slides right; the back crosses the quarterback's face to block the nickel.",
          hold: 1.9, grade: 55, category: "risky",
          why: "The back starts on the wrong side and has to beat a nickel with a head start to the edge.",
          assignments: [
            { player: "RB", assignment: "Cross the formation and cut off the nickel", key: "NB", win: "Gets there in time", fail: "Arrives late; the nickel has a free run", p: 0.45 }
          ]
        },
        {
          id: "max", label: "Max protection: tight end and back stay in",
          detail: "Seven blockers. Three receivers go out against man coverage.",
          hold: 3.5, grade: 62, category: "safe",
          why: "Everyone's blocked, but you've taken two receivers off a third down where the man-coverage matchups were the advantage.",
          assignments: [
            { player: "Y", assignment: "Stay in and take the right end", key: "DER", win: "Walls off the end", fail: "Gets beat inside", p: 0.9 }
          ]
        }
      ],
      plays: [
        {
          id: "slant", concept: "hot-slant", label: "Hot slant to the slot",
          detail: "H runs a three-step slant through the spot the nickel left. X runs a slant behind it.",
          need: 1.3, window: 0.72, yards: 8, spread: 3, intRisk: 0.05, luck: 0.03,
          hot: { window: 0.68, yards: 7, spread: 3, text: "Ball out on the third step to the slant" },
          grade: 95, category: "recommended",
          conflict: "SS",
          why: "Against man pressure the blitzer's receiver is covered by someone farther away: the strong safety has to come 8 yards, from outside-in, to a slot running inside. Nobody's replacing the nickel underneath. The same slant that died against the fire zone wins here.",
          key: { answer: "SS", partial: { NB: "The nickel is gone. The question is who's covering his man, and from where.", FS: "The free safety stays deep; he's only a factor if the ball sails." } },
          routes: [{ from: "H", path: [[17, 1], [21.5, 5]] }, { from: "X", path: [[8, 2], [11.5, 6]] }, { from: "Z", path: [[45, 18]] }],
          assignments: [
            { player: "QB", assignment: "Ball out on the third step, before the nickel arrives", key: "NB", win: "Throws on rhythm", fail: "Hitches and the nickel hits him", p: 0.9, critical: true },
            { player: "H", assignment: "Win inside against the safety arriving from depth", key: "SS", win: "Catches it in front of the safety", fail: "The safety closes faster than expected", p: 0.82, keyBonus: 0.08, critical: true },
            { player: "X", assignment: "Backside slant: second option against the press corner", key: "CBL", win: "Gets inside the press", fail: "Gets jammed", p: 0.7 }
          ]
        },
        {
          id: "mesh", concept: "mesh", label: "Mesh",
          detail: "H and Y cross underneath, rubbing their defenders; Z runs a corner, X clears.",
          need: 2.3, window: 0.66, yards: 7, spread: 3, intRisk: 0.03, luck: 0.04,
          hot: { window: 0.5, yards: 4, spread: 2, text: "Ball out early to the first crosser" },
          grade: 86, category: "high-floor",
          conflict: "MIKE",
          why: "Crossing routes are built for man coverage: the two crossers rub off each other's defenders. It takes a beat longer than the slant, so it needs the protection to account for the nickel.",
          key: { answer: "MIKE", partial: { SS: "He's chasing the slot crosser, but the Mike, trailing the tight end through the rub, decides which crosser comes open." } },
          routes: [{ from: "H", path: [[17, 1], [24, 2.5], [36, 3]] }, { from: "Y", path: [[30.7, 1], [24, 3.5], [14, 4]] }, { from: "Z", path: [[45, 10], [49, 17]] }, { from: "X", path: [[8, 18]] }],
          assignments: [
            { player: "QB", assignment: "Find the crosser who comes free of the rub", key: "MIKE", win: "Hits the crosser in stride", fail: "Waits for one to come open and gets hit", p: 0.84, keyBonus: 0.08, critical: true },
            { player: "Y", assignment: "Cross at 5 yards, close enough to H to pick the Mike", key: "MIKE", win: "The Mike gets caught in traffic", fail: "Runs too deep and the rub never happens", p: 0.8, critical: true }
          ]
        },
        {
          id: "verts", concept: "verts", label: "Four verticals",
          detail: "Everyone goes deep against one deep safety.",
          need: 2.9, window: 0.4, yards: 24, spread: 8, intRisk: 0.12, luck: 0.12,
          grade: 60, category: "aggressive",
          conflict: "FS",
          why: "One-on-ones outside are tempting, but the free safety sits in the middle to help on any seam, the corners are pressing, and five rushers want the ball out before three seconds.",
          key: { answer: "FS", partial: {} },
          routes: [{ from: "X", path: [[8, 18]] }, { from: "H", path: [[17, 6], [19, 18]] }, { from: "Y", path: [[30.7, 6], [33, 18]] }, { from: "Z", path: [[45, 18]] }],
          assignments: [
            { player: "QB", assignment: "Hold the free safety, throw the one-on-one away from him", key: "FS", win: "Moves the safety off a seam", fail: "Throws where the safety is helping", p: 0.68, keyBonus: 0.1, critical: true },
            { player: "X", assignment: "Beat press coverage on the go", key: "CBL", win: "Wins off the line", fail: "Gets pressed to the sideline", p: 0.6, critical: true }
          ]
        },
        {
          id: "stick", concept: "stick", label: "Stick to the left",
          detail: "H runs the 6-yard stick, X clears, the back checks and releases to the flat.",
          need: 2.2, window: 0.38, yards: 6, spread: 2, intRisk: 0.06, luck: 0.03,
          grade: 48, category: "poor",
          conflict: "SS",
          why: "Stick is a zone beater: it sits down in a hole. Against man there is no hole. The defender is on the receiver's hip and closes the moment he stops.",
          key: { answer: "SS", partial: {} },
          routes: [{ from: "H", path: [[17, 5.5], [17.8, 5]] }, { from: "X", path: [[8, 18]] }, { from: "RB", path: [[23, -2], [18, 1]] }],
          assignments: [
            { player: "QB", assignment: "Throw the stick as the receiver turns", key: "SS", win: "Fits it in before the safety closes", fail: "The safety drives on the sit route", p: 0.75, critical: true },
            { player: "H", assignment: "Sit at 6 yards against man", key: "SS", win: "Creates space at the top", fail: "Sits right into the defender", p: 0.6, critical: true }
          ]
        }
      ],
      contingencies: [
        {
          id: "built-in", label: "Built-in hot: if the nickel comes clean, ball out to the quick route now", onPressure: "hot",
          grades: { slant: 95, mesh: 88, verts: 40, stick: 65 },
          why: "The slant and the first mesh crosser are both on time against the nickel. Four verticals has nothing quick."
        },
        {
          id: "sight", label: "Sight adjust: the slot converts his route to a slant against pressure", onPressure: "sight",
          throw: { window: 0.66, yards: 7, spread: 3, intRisk: 0.05, text: "Sight-adjusted slant" },
          grades: { slant: 85, mesh: 80, verts: 75, stick: 80 },
          why: "Against man pressure this is exactly the right conversion: the slot runs away from a defender who's coming from depth."
        },
        {
          id: "throwaway", label: "If the window closes, climb and throw it away", onPressure: "throwaway",
          grades: { slant: 70, mesh: 70, verts: 75, stick: 75 },
          why: "Safe, but down four late, a throwaway on third down is a punt."
        },
        {
          id: "none", label: "Hold it: trust the protection", onPressure: "none",
          grades: { slant: 20, mesh: 20, verts: 20, stick: 20 },
          why: "Seven can come and at most six block. Trusting it is a plan for a sack."
        }
      ],
      interactions: [
        { when: { protection: "slide-away", motion: "rbshift" }, hold: 0.8, protection: 20, note: "Shifting the back to the nickel's side shortens his trip to the edge." },
        { when: { protection: "slide-nickel", motion: "rbshift" }, hold: -0.4, protection: -8, note: "The back moved away from the Will he's supposed to scan." },
        { when: { protection: "max", play: "mesh" }, window: -0.4, play: -25, note: "Max protection keeps the tight end in, and he's one of the two crossers. Mesh needs both." },
        { when: { protection: "max", play: "verts" }, window: -0.15, play: -5, note: "Three go deep against man with a deep safety: one fewer route for the safety to worry about." },
        { when: { protection: "five", play: "verts" }, protection: -30, note: "Five-man protection on a three-second concept leaves the nickel unblocked with nothing quick to throw." }
      ],
      recommended: { motion: "yoyo", protection: "slide-nickel", play: "slant", contingency: "built-in" },
      fit: { downs: [3], distance: [3, 7], coverage: ["COVER_1"], rushers: [5, 5], blitz: true },
      clues: [
        { text: "One-high shell: one safety deep in the middle, the other down at 8 yards.", kind: "meaningful" },
        { text: "Both corners pressed, inside of nobody: a man-coverage look.", kind: "meaningful" },
        { text: "The nickel walked down over the slot, inside-shaded.", kind: "meaningful" },
        { text: "The strong safety at 8 yards could be a robber in a zone, or a man defender. You can't tell before the snap.", kind: "uncertain" },
        { text: "The linebackers at normal depth looked like they'd drop into zones. They were in man on the back and the tight end.", kind: "deceptive" }
      ],
      next: "After a slant beats man pressure, expect the same picture with the strong safety sitting in the slant window as a robber: the fire-zone version of this call.",
      takeaway: "Against man pressure, the blitzer's receiver is covered by someone who started farther away. Throw to him, fast. The slant that dies against a fire zone wins against man.",
      learning: {
        objectives: ["Tell man pressure from zone pressure", "Find the receiver the blitzer left", "Match a man beater to the coverage"],
        tags: ["nickel-pressure", "man-vs-zone", "protection-count"],
        misconceptions: ["A hot throw is either always right or always wrong"],
        difficulty: 2,
        transfer: ["Zone pressure to man pressure", "Two-high to one-high"],
        revisitDays: 2
      }
    },

    {
      id: "zero-3rd-7",
      title: "Zero Hour",
      module: "nickel-pressure",
      order: 4,
      type: "synthetic",
      status: "published",
      version: 1,
      provenance: {
        type: "synthetic",
        label: "Synthetic teaching scenario. Not a real NFL play: the game, teams and result are invented to teach one principle.",
        sources: [],
        fieldConfidence: { all: "synthetic" },
        reviewer: "unreviewed",
        notes: "All-out pressure: more rushers than blockers and nobody deep."
      },
      context: {
        quarter: 2, clock: "1:48", score: { you: 7, opp: 10 },
        down: 3, distance: 7, yardLine: 41, side: "opp", hash: "right",
        objective: "Convert to stay in field goal range before the half.",
        scouting: "On third-and-medium this defense sends everyone a few times a game, usually after showing two linebackers in the A-gaps."
      },
      offense: {
        personnel: "11",
        personnelText: "11 personnel: 1 back, 1 tight end, 3 receivers",
        formation: "Trips left (3x1), tight end on the wing, back offset right",
        players: [
          { id: "Z", label: "Z", role: "Receiver (#1 to trips)", x: 7, y: -1 },
          { id: "H", label: "H", role: "Slot receiver (#2)", x: 15, y: -1.8 },
          { id: "Y", label: "Y", role: "Tight end, wing (#3)", x: 25.5, y: -2 },
          { id: "LT", label: "LT", role: "Left tackle", x: 27.13, y: -1 },
          { id: "LG", label: "LG", role: "Left guard", x: 28.43, y: -1 },
          { id: "C", label: "C", role: "Center", x: 29.73, y: -1 },
          { id: "RG", label: "RG", role: "Right guard", x: 31.03, y: -1 },
          { id: "RT", label: "RT", role: "Right tackle", x: 32.33, y: -1 },
          { id: "QB", label: "QB", role: "Quarterback (shotgun)", x: 29.73, y: -5 },
          { id: "RB", label: "RB", role: "Running back, offset right", x: 31.6, y: -5 },
          { id: "X", label: "X", role: "Receiver (backside, right)", x: 47, y: -1 }
        ]
      },
      defense: {
        personnel: "nickel",
        personnelText: "Nickel: 4 linemen, 2 linebackers, 5 defensive backs",
        front: "Four-down front with both linebackers mugged in the A-gaps",
        shell: "zero",
        boxCount: 8,
        disguise: "low",
        players: [
          { id: "CBL", label: "LCB", role: "Left cornerback, pressed on Z", x: 7, y: 1.5 },
          { id: "NB", label: "NB", role: "Nickel, pressed on the slot", x: 15.5, y: 1.5 },
          { id: "SS", label: "SS", role: "Strong safety, walked down over the tight end", x: 24.5, y: 5.5 },
          { id: "DEL", label: "E", role: "Left end", x: 26.2, y: 1 },
          { id: "DT", label: "T", role: "Defensive tackle", x: 27.7, y: 1 },
          { id: "MIKE", label: "M", role: "Mike linebacker, mugged in the left A-gap", x: 29.08, y: 1.8 },
          { id: "WILL", label: "W", role: "Will linebacker, mugged in the right A-gap", x: 30.4, y: 1.8 },
          { id: "NT", label: "N", role: "Nose tackle", x: 31.7, y: 1 },
          { id: "DER", label: "E", role: "Right end", x: 33.5, y: 1 },
          { id: "FS", label: "FS", role: "Free safety, 9 yards over the back", x: 33, y: 9 },
          { id: "CBR", label: "RCB", role: "Right cornerback, pressed on X", x: 47, y: 1.5 }
        ]
      },
      actual: {
        call: "cover-0",
        pressure: "six",
        rushers: ["DEL", "DT", "MIKE", "WILL", "NT", "DER"],
        droppers: [],
        coverage: "Cover 0 (all-out man)",
        rotation: "None, and nobody deep. Five defensive backs in man on five eligible receivers; the free safety takes the back.",
        post: {
          CBL: { x: 8, y: 8, zone: "Man: Z" },
          NB: { x: 17, y: 7, zone: "Man: slot" },
          SS: { x: 23, y: 6, zone: "Man: tight end" },
          DEL: { x: 27, y: -3.5 },
          DT: { x: 28.2, y: -3 },
          MIKE: { x: 29.2, y: -3.5 },
          WILL: { x: 30.3, y: -3.5 },
          NT: { x: 31.4, y: -3 },
          DER: { x: 32.6, y: -3.5 },
          FS: { x: 34, y: 3, zone: "Man: back" },
          CBR: { x: 46, y: 8, zone: "Man: X" }
        },
        events: [
          { t: 0.1, text: "Both A-gap linebackers come. Six rushers against six possible blockers, at most." },
          { t: 0.4, text: "Every defensive back is in man. Nobody is deeper than 9 yards." },
          { t: 1.4, text: "If any rusher comes free, he arrives about now." }
        ]
      },
      diagnosis: {
        questions: [
          {
            id: "personnel", prompt: "What defensive personnel is on the field?", kind: "single",
            options: [{ id: "base", label: "Base (4 DBs)" }, { id: "nickel", label: "Nickel (5 DBs)" }, { id: "dime", label: "Dime (6 DBs)" }],
            credit: { base: 20, nickel: 100, dime: 40 }, error: "personnel",
            explain: "Two corners, a nickel, two safeties: nickel. The linebackers lined up in the A-gaps are still linebackers."
          },
          {
            id: "shell", prompt: "What safety shell is the defense showing?", kind: "single",
            options: [{ id: "two", label: "Two-high" }, { id: "one", label: "One-high" }, { id: "zero", label: "Zero (no deep safety)" }],
            credit: { two: 0, one: 40, zero: 100 }, error: "shell",
            explain: "Nobody is deeper than 9 yards: zero. The free safety at 9 could still bail to the middle, which is why one-high earns partial credit."
          },
          {
            id: "rushers", prompt: "Tap every defender who could rush.", kind: "rushers",
            answer: ["DEL", "DT", "MIKE", "WILL", "NT", "DER", "NB", "SS"], critical: "MIKE", error: "pressure-count",
            explain: "Eight can come: four linemen, both A-gap linebackers, the pressed nickel and the strong safety over the tight end. Six blockers, eight threats: the ball has to come out."
          },
          {
            id: "pressure", prompt: "What's the most likely pressure?", kind: "single",
            options: [{ id: "four", label: "Four-man rush" }, { id: "five", label: "Five-man pressure" }, { id: "six", label: "Six or more (Cover 0)" }],
            credit: { four: 20, five: 60, six: 100 }, error: "pressure-count",
            explain: "Double A-gap mugs with no deep safety is the zero look. Teams do bail out of it (simulated pressure), but with nobody deep the evidence says six or more."
          }
        ]
      },
      motions: [
        { id: "none", label: "No motion", text: "Snap it fast. Against zero, every extra second pre-snap is time for the defense to adjust its blitz." },
        {
          id: "yoyo", label: "Slot yo-yo motion", detail: "H motions in and back out.",
          path: { from: "H", to: [21, -2], back: true },
          moves: { NB: [15.8, 1.6] },
          text: "The nickel went with the slot every step: man. Nobody rotated deep to replace anyone, so there's still no safety in the middle.",
          clue: "The nickel ran with the motion and no one rotated deep: man coverage with nobody in the middle."
        },
        {
          id: "rbshift", label: "Shift the back to the left", detail: "RB moves to the trips side of the quarterback.",
          path: { from: "RB", to: [27.9, -5] },
          moves: { FS: [31, 7.5] },
          text: "The free safety slid over with the back: he has the back in man. That confirms it. There's nobody deep.",
          clue: "The free safety slid with the back's shift: he's in man on the back, so nobody is deep."
        }
      ],
      protections: [
        {
          id: "six", label: "Six-man: line on the down linemen and backers, back takes the edge",
          detail: "The line takes the four down linemen and the two A-gap linebackers; the back takes anyone who comes off the edge.",
          hold: 2.1, grade: 90, category: "recommended",
          why: "Six blockers for six rushers, every one with a name. It won't last long, so the call still has to be quick.",
          assignments: [
            { player: "C", assignment: "Take the Mike in the left A-gap", key: "MIKE", win: "Stones him at the line", fail: "Gets beat inside", p: 0.85 },
            { player: "RB", assignment: "Take the first defender off the edge", key: "DER", win: "Squares up the end", fail: "Gets run over", p: 0.85 }
          ]
        },
        {
          id: "five", label: "Five-man protection, QB is hot off the A-gaps",
          detail: "The back releases. The QB has the A-gap linebackers: if both come, the ball comes out.",
          hold: 1.1, grade: 70, category: "valid", hotPlan: true,
          why: "Legitimate against zero only if the ball is out in about a second. One rusher will be free.",
          assignments: [
            { player: "QB", assignment: "Ball out before the free A-gap rusher arrives", key: "WILL", win: "Ball out in 1.1 seconds", fail: "Holds it", p: 0.8 }
          ]
        },
        {
          id: "slide", label: "Full slide right, back blocks the left edge",
          detail: "The line slides right as a unit; the back takes the left end.",
          hold: 1.5, grade: 55, category: "risky",
          why: "Sliding against two mugged A-gap linebackers lets one of them run straight through the middle. Against zero, the middle is the fastest path to the quarterback.",
          assignments: [
            { player: "LG", assignment: "Slide right and hope the Mike goes with him", key: "MIKE", win: "The Mike runs into the slide", fail: "The Mike comes through the vacated A-gap", p: 0.5 }
          ]
        },
        {
          id: "max", label: "Max protection: tight end and back stay in",
          detail: "Seven block six. Three receivers go out against man with no help.",
          hold: 2.8, grade: 80, category: "safe",
          why: "A classic zero answer: block everyone, and take one-on-ones with no safety behind them.",
          assignments: [
            { player: "Y", assignment: "Stay in and take the left end", key: "DEL", win: "Walls him off", fail: "Gets beat inside", p: 0.9 }
          ]
        }
      ],
      plays: [
        {
          id: "slants", concept: "hot-slant", label: "Double slants to the trips side",
          detail: "Z and H run three-step slants; Y runs to the flat. The ball comes out on the third step.",
          need: 1.2, window: 0.64, yards: 9, spread: 5, intRisk: 0.06, luck: 0.1,
          hot: { window: 0.6, yards: 8, spread: 5, text: "Ball out on the third step to a slant" },
          grade: 95, category: "recommended",
          conflict: "NB",
          why: "The zero beater. The ball is out before six rushers get home, and with nobody deep a slant that wins its leverage can go the distance. The read is the nickel: if he's inside the slot, throw Z's slant; if he's outside, throw H's.",
          key: { answer: "NB", partial: { CBL: "He's the read only if the nickel takes away H. Start with the nickel." } },
          routes: [{ from: "Z", path: [[7, 1.5], [11, 5]] }, { from: "H", path: [[15, 1.5], [19, 5]] }, { from: "Y", path: [[24, 1], [19, 2]] }],
          assignments: [
            { player: "QB", assignment: "Read the nickel's leverage and throw on the third step", key: "NB", win: "Ball out in rhythm, away from leverage", fail: "Throws into the nickel's leverage", p: 0.86, keyBonus: 0.08, critical: true },
            { player: "H", assignment: "Win inside on the slant against press man", key: "NB", win: "Gets inside the nickel", fail: "Gets jammed and the window closes", p: 0.78, critical: true }
          ]
        },
        {
          id: "fade", concept: "fade", label: "Slot fade",
          detail: "H runs a fade up the seam with no safety behind his defender. Max-protect friendly.",
          need: 1.9, window: 0.42, yards: 28, spread: 10, intRisk: 0.1, luck: 0.1,
          grade: 74, category: "aggressive",
          conflict: "NB",
          why: "With nobody deep, any one-on-one that wins is a touchdown, and that's the bet. It needs almost two seconds, which six rushers rarely give you unless everyone stays in to block.",
          key: { answer: "NB", partial: { FS: "He's in man on the back, not deep. That's why the fade is open if H wins." } },
          routes: [{ from: "H", path: [[15.5, 6], [17, 18]] }, { from: "Z", path: [[7, 18]] }],
          assignments: [
            { player: "QB", assignment: "Throw it early and over the top: no safety to worry about", key: "NB", win: "Leads H away from the nickel", fail: "Underthrows it", p: 0.78, critical: true },
            { player: "H", assignment: "Win the release against the pressed nickel", key: "NB", win: "Gets on top of him", fail: "Gets jammed into the boundary", p: 0.6, critical: true }
          ]
        },
        {
          id: "stick", concept: "stick", label: "Stick to the trips side",
          detail: "H sits at 6 yards, Y to the flat, Z clears.",
          need: 2.2, window: 0.42, yards: 6, spread: 2, intRisk: 0.06, luck: 0.03,
          hot: { window: 0.35, yards: 5, spread: 2, text: "Ball out early to the flat" },
          grade: 52, category: "risky",
          conflict: "NB",
          why: "Too slow and the wrong shape: stick sits down in zone holes, and against zero there are no holes, just a man defender on every hip and six rushers who get home in about two seconds.",
          key: { answer: "NB", partial: { SS: "He has the tight end in the flat; the stick is the nickel's." } },
          routes: [{ from: "H", path: [[15, 5.5], [15.8, 5]] }, { from: "Y", path: [[24, 1], [18, 2.5]] }, { from: "Z", path: [[7, 18]] }],
          assignments: [
            { player: "QB", assignment: "Throw the stick as he turns", key: "NB", win: "Fits it in", fail: "The nickel is on his hip", p: 0.75, critical: true },
            { player: "H", assignment: "Sit at 6 against press man", key: "NB", win: "Creates space", fail: "Sits into the defender", p: 0.6, critical: true }
          ]
        },
        {
          id: "draw", concept: "draw", label: "Draw",
          detail: "Show pass, let six rush upfield, hand off behind them.",
          kind: "run", need: 0, window: 0.28, yards: 14, spread: 8, failYards: 1, failSpread: 2, luck: 0.05,
          grade: 50, category: "conservative",
          conflict: "MIKE",
          why: "Tempting, since nobody is behind the rush. But both A-gap linebackers are running straight through the draw's lane, and the free safety has the back in man.",
          key: { answer: "MIKE", partial: { FS: "He has the back in man; he's the last line if the draw gets through." } },
          routes: [{ from: "RB", path: [[29.7, -3], [29.6, 3], [29.5, 10]] }],
          assignments: [
            { player: "C", assignment: "Let the Mike through, then seal him", key: "MIKE", win: "Opens the A-gap behind him", fail: "The Mike meets the back at the mesh", p: 0.55, critical: true },
            { player: "RB", assignment: "Hit the lane and beat the free safety", key: "FS", win: "Gets past the man defender", fail: "The safety makes the tackle", p: 0.7, critical: true }
          ]
        }
      ],
      contingencies: [
        {
          id: "built-in", label: "Built-in hot: if a rusher comes free, ball out to the quick route now", onPressure: "hot",
          grades: { slants: 95, fade: 55, stick: 75, draw: 50 },
          why: "The slants are their own hot answer. The fade has nothing quick."
        },
        {
          id: "sight", label: "Sight adjust: the slot converts his route to a slant against pressure", onPressure: "sight",
          throw: { window: 0.6, yards: 8, spread: 5, intRisk: 0.06, text: "Sight-adjusted slant" },
          grades: { slants: 85, fade: 80, stick: 85, draw: 40 },
          why: "Against zero this is the textbook conversion: nobody is replacing anyone, and nobody's deep."
        },
        {
          id: "throwaway", label: "If the window closes, climb and throw it away", onPressure: "throwaway",
          grades: { slants: 65, fade: 70, stick: 70, draw: 60 },
          why: "Against zero there's rarely room to climb. It beats a sack, barely."
        },
        {
          id: "none", label: "Hold it: trust the protection", onPressure: "none",
          grades: { slants: 10, fade: 10, stick: 10, draw: 50 },
          why: "Eight can come, six can block. There's no trusting it."
        }
      ],
      interactions: [
        { when: { protection: "max", play: "fade" }, play: 12, note: "Max protection plus a slot fade is a classic zero answer: everyone's blocked and the one-on-one has no help behind it." },
        { when: { protection: "max", play: "stick" }, window: -0.3, play: -15, note: "Max protection keeps the tight end in, and he was the flat route that makes stick work." },
        { when: { protection: "five", play: "fade" }, protection: -30, note: "Five-man protection against six rushers on a two-second route: a free rusher with nothing quick to throw." },
        { when: { protection: "slide", motion: "rbshift" }, hold: 0.3, note: "Moving the back to the left helps a little against the left end, but the middle is still open." }
      ],
      recommended: { motion: "none", protection: "six", play: "slants", contingency: "built-in" },
      fit: { downs: [3], distance: [4, 9], coverage: ["COVER_0"], rushers: [6, 11], blitz: true },
      clues: [
        { text: "Both linebackers mugged in the A-gaps: the fastest path to the quarterback, and a protection problem before the snap.", kind: "meaningful" },
        { text: "Nobody is deeper than 9 yards: zero shell.", kind: "meaningful" },
        { text: "Everyone is pressed. Man coverage is likely, but press can also bail into zone.", kind: "uncertain" },
        { text: "The nickel pressed on the slot looked like another blitzer. He was in man the whole way.", kind: "deceptive" }
      ],
      next: "After a quick throw beats zero, expect the same double-A look with the linebackers bailing into the slant windows: simulated pressure.",
      takeaway: "Against zero, the ball has to beat the free rusher. Nobody's deep to help the defense, so a quick throw that wins its leverage can go a long way.",
      learning: {
        objectives: ["Recognize a zero look", "Count rushers against blockers when they outnumber you", "Get the ball out before the free rusher"],
        tags: ["protection-count", "man-vs-zone", "zero-pressure"],
        misconceptions: ["More time to throw always helps"],
        difficulty: 2,
        transfer: ["Five-man to six-man pressure", "Trips right to trips left"],
        revisitDays: 2
      }
    },

    {
      id: "quarters-2nd-6",
      title: "Quarters Wall",
      module: "nickel-pressure",
      order: 5,
      type: "synthetic",
      status: "published",
      version: 1,
      provenance: {
        type: "synthetic",
        label: "Synthetic teaching scenario. Not a real NFL play: the game, teams and result are invented to teach one principle.",
        sources: [],
        fieldConfidence: { all: "synthetic" },
        reviewer: "unreviewed",
        notes: "Quarters takes away the deep and intermediate middle; the flats and the run are what it gives."
      },
      context: {
        quarter: 1, clock: "9:52", score: { you: 0, opp: 0 },
        down: 2, distance: 6, yardLine: 36, side: "own", hash: "middle",
        objective: "Gain 4 or more and stay ahead of the chains.",
        scouting: "This defense lives in quarters on early downs: two safeties at 12 yards reading your slot receivers."
      },
      offense: {
        personnel: "11",
        personnelText: "11 personnel: 1 back, 1 tight end, 3 receivers",
        formation: "Doubles (2x2), tight end attached right, back offset right",
        players: [
          { id: "X", label: "X", role: "Receiver (#1 left)", x: 8, y: -1 },
          { id: "H", label: "H", role: "Slot receiver (#2 left)", x: 17, y: -1.8 },
          { id: "LT", label: "LT", role: "Left tackle", x: 24.05, y: -1 },
          { id: "LG", label: "LG", role: "Left guard", x: 25.35, y: -1 },
          { id: "C", label: "C", role: "Center", x: 26.65, y: -1 },
          { id: "RG", label: "RG", role: "Right guard", x: 27.95, y: -1 },
          { id: "RT", label: "RT", role: "Right tackle", x: 29.25, y: -1 },
          { id: "Y", label: "Y", role: "Tight end, attached right", x: 30.7, y: -1 },
          { id: "QB", label: "QB", role: "Quarterback (shotgun)", x: 26.65, y: -5 },
          { id: "RB", label: "RB", role: "Running back, offset right", x: 28.5, y: -5 },
          { id: "Z", label: "Z", role: "Receiver (#1 right)", x: 45, y: -1.8 }
        ]
      },
      defense: {
        personnel: "nickel",
        personnelText: "Nickel: 4 linemen, 2 linebackers, 5 defensive backs",
        front: "Four-down even front",
        shell: "two-high",
        boxCount: 6,
        disguise: "low",
        players: [
          { id: "CBL", label: "LCB", role: "Left cornerback, off at 7 yards", x: 8, y: 7 },
          { id: "NB", label: "NB", role: "Nickel, apex over the slot", x: 18, y: 5 },
          { id: "FS", label: "FS", role: "Free safety, 12 yards over the slot", x: 18.5, y: 12 },
          { id: "DEL", label: "E", role: "Left end", x: 23, y: 1 },
          { id: "WILL", label: "W", role: "Will linebacker", x: 24.6, y: 4.5 },
          { id: "DT", label: "T", role: "Defensive tackle", x: 25.2, y: 1 },
          { id: "NT", label: "N", role: "Nose tackle", x: 27.6, y: 1 },
          { id: "MIKE", label: "M", role: "Mike linebacker", x: 28.6, y: 4.5 },
          { id: "DER", label: "E", role: "Right end", x: 30.6, y: 1 },
          { id: "SS", label: "SS", role: "Strong safety, 12 yards over the tight end", x: 35, y: 12 },
          { id: "CBR", label: "RCB", role: "Right cornerback, off at 7 yards", x: 45, y: 7 }
        ]
      },
      actual: {
        call: "gen-cover-4",
        pressure: "four",
        rushers: ["DEL", "DT", "NT", "DER"],
        droppers: ["CBL", "NB", "FS", "WILL", "MIKE", "SS", "CBR"],
        coverage: "Cover 4 (quarters)",
        rotation: "None. Both safeties stay deep and read the slot receivers; the corners bail to deep quarters. Three defenders underneath for the whole width of the field.",
        post: {
          CBL: { x: 9, y: 15, zone: "Deep quarter" },
          NB: { x: 14, y: 6, zone: "Curl-flat" },
          FS: { x: 20, y: 14, zone: "Deep quarter" },
          DEL: { x: 24.5, y: -3.5 },
          WILL: { x: 25, y: 7, zone: "Hook" },
          DT: { x: 25.6, y: -3 },
          NT: { x: 27.4, y: -3 },
          MIKE: { x: 33, y: 6, zone: "Curl-flat" },
          DER: { x: 29, y: -3.5 },
          SS: { x: 34, y: 14, zone: "Deep quarter" },
          CBR: { x: 44, y: 15, zone: "Deep quarter" }
        },
        events: [
          { t: 0.3, text: "Four rush. Seven drop: four deep, only three underneath." },
          { t: 0.6, text: "Both safeties read the slot receivers. Anything vertical or breaking inside at 12 yards has a safety driving on it." },
          { t: 0.9, text: "The corners bail. The flats are wide open until a linebacker can get there." }
        ]
      },
      diagnosis: {
        questions: [
          { id: "personnel", prompt: "What defensive personnel is on the field?", kind: "single",
            options: [{ id: "base", label: "Base (4 DBs)" }, { id: "nickel", label: "Nickel (5 DBs)" }, { id: "dime", label: "Dime (6 DBs)" }],
            credit: { base: 20, nickel: 100, dime: 40 }, error: "personnel",
            explain: "Two corners, a nickel, two safeties: nickel." },
          { id: "shell", prompt: "What safety shell is the defense showing?", kind: "single",
            options: [{ id: "two", label: "Two-high" }, { id: "one", label: "One-high" }, { id: "zero", label: "Zero (no deep safety)" }],
            credit: { two: 100, one: 40, zero: 0 }, error: "shell",
            explain: "Both safeties at 12 yards, over the slots rather than the hashes: two-high, and their spot hints at quarters, where safeties read the slot." },
          { id: "rushers", prompt: "Tap every defender who could rush.", kind: "rushers",
            answer: ["DEL", "DT", "NT", "DER", "WILL", "MIKE", "NB"], critical: "NB", error: "pressure-count",
            explain: "Seven can come, but with two safeties deep and corners off, everything about this look says four rush and seven drop." },
          { id: "pressure", prompt: "What's the most likely pressure?", kind: "single",
            options: [{ id: "four", label: "Four-man rush" }, { id: "five", label: "Five-man pressure" }, { id: "six", label: "Six or more (Cover 0)" }],
            credit: { four: 100, five: 60, six: 20 }, error: "pressure-count",
            explain: "Two-high, off corners, six in the box: a four-man rush with seven in coverage is the likely answer." }
        ]
      },
      motions: [
        { id: "none", label: "No motion", text: "Snap it. Quarters is easy to read before the snap; motion mostly confirms it." },
        { id: "yoyo", label: "Slot yo-yo motion", detail: "H motions in toward the formation and back out.",
          path: { from: "H", to: [22, -2], back: true },
          moves: { NB: [18.8, 5], FS: [19.4, 11.5] },
          text: "The nickel and the free safety bumped a step with him; nobody ran with him. Zone, and both safeties stayed deep: quarters or Cover 2. The flats are soft against both.",
          clue: "On motion the nickel and safety bumped but didn't run with the slot, and both safeties stayed at 12: two-high zone." },
        { id: "rbshift", label: "Shift the back to the left", detail: "RB moves to the other side of the quarterback.",
          path: { from: "RB", to: [24.8, -5] },
          moves: { WILL: [24, 4.5], MIKE: [27.8, 4.5] },
          text: "The linebackers slid a half step with the back. Zone again; nothing changed in the shell.",
          clue: "The linebackers slid with the back: zone." }
      ],
      protections: [
        { id: "five", label: "Five-man protection, the back runs a route", detail: "The line blocks four rushers and the Mike; the back releases to the flat.",
          hold: 3.0, grade: 92, category: "recommended", hotPlan: true,
          why: "Two-high with six in the box says four rush. Five blockers handle it, and the back becomes a fifth receiver against a defense with only three underneath.",
          assignments: [{ player: "QB", assignment: "If a sixth rusher comes, ball out to the back", key: "NB", win: "Ball out on time", fail: "Holds it against a surprise blitz", p: 0.9 }] },
        { id: "six", label: "Six-man: the back stays in to check", detail: "The back checks the linebackers before releasing.",
          hold: 3.4, grade: 84, category: "valid",
          why: "Safe and sound, but it keeps a receiver home against a look that almost never pressures.",
          assignments: [{ player: "RB", assignment: "Check the Will, then release", key: "WILL", win: "Sees him drop and releases", fail: "Releases late, after the window", p: 0.9 }] },
        { id: "max", label: "Max protection: back and tight end stay in", detail: "Seven block four.",
          hold: 3.8, grade: 60, category: "safe",
          why: "Seven blockers for four rushers on second-and-6: you've taken the routes that beat quarters off the field.",
          assignments: [{ player: "Y", assignment: "Block the right end", key: "DER", win: "Walls him off", fail: "Gets beat inside", p: 0.92 }] }
      ],
      plays: [
        { id: "quick", concept: "quick", label: "Slant-flat to the right",
          detail: "Z runs a slant, Y releases to the flat. The ball comes out fast.",
          need: 1.4, window: 0.72, yards: 7, spread: 3, intRisk: 0.03, luck: 0.03,
          hot: { window: 0.65, yards: 6, spread: 2, text: "Ball out early to the flat" },
          grade: 95, category: "recommended", conflict: "MIKE",
          why: "Quarters puts four defenders deep, so only three cover the whole field underneath. The Mike has to cover both the slant and the flat on his side: whichever he takes, throw the other.",
          key: { answer: "MIKE", partial: { SS: "The safety reads the tight end. If Y releases flat, the safety isn't the one who covers him underneath." } },
          routes: [{ from: "Z", path: [[45, 1.5], [41, 5]] }, { from: "Y", path: [[32, 1], [37, 2.5]] }],
          assignments: [
            { player: "QB", assignment: "Read the Mike: flat if he sits inside, slant if he widens", key: "MIKE", win: "Throws away from the Mike on rhythm", fail: "Throws into the Mike's widening drop", p: 0.85, keyBonus: 0.08, critical: true },
            { player: "Z", assignment: "Win inside on the slant against the bailing corner", key: "CBR", win: "Catches it in front of the deep corner", fail: "The corner drives on it", p: 0.86, critical: true }
          ] },
        { id: "smash", concept: "smash", label: "Smash to the left",
          detail: "X runs a hitch, H a corner route over it.",
          need: 2.4, window: 0.58, yards: 9, spread: 5, intRisk: 0.05, luck: 0.04,
          hot: { window: 0.55, yards: 5, spread: 2, text: "Ball out early to the hitch" },
          grade: 80, category: "high-floor", conflict: "FS",
          why: "The hitch is there because the quarters corner bails. The corner route is the problem: the free safety is reading H, and when H breaks outside at 12 yards the safety is already on top of it.",
          key: { answer: "FS", partial: { CBL: "He bails deep; the hitch is open under him. The safety decides whether the corner route is." } },
          routes: [{ from: "X", path: [[8, 5], [8.5, 4.5]] }, { from: "H", path: [[17, 10], [12, 15]] }],
          assignments: [
            { player: "QB", assignment: "Hitch unless the free safety bites down", key: "FS", win: "Takes the hitch on time", fail: "Forces the corner route into the safety", p: 0.84, keyBonus: 0.08, critical: true },
            { player: "X", assignment: "Hitch at 5, square up", key: "CBL", win: "Presents his numbers fast", fail: "Drifts", p: 0.9, critical: true }
          ] },
        { id: "inside-zone", concept: "inside-zone", label: "Inside zone",
          detail: "Run it at six in the box with six blockers.", kind: "run",
          need: 0, window: 0.52, yards: 6, spread: 3, failYards: 2, failSpread: 2, luck: 0.04,
          grade: 85, category: "valid", conflict: "SS",
          why: "Six in the box against six blockers: even numbers. Quarters safeties fit the run fast from 12 yards, so the run is honest but not free.",
          key: { answer: "SS", partial: { MIKE: "He's blocked on a double team; the safety is the free hitter." } },
          routes: [{ from: "RB", path: [[27.5, -2], [26, 1], [25.5, 6]] }],
          assignments: [
            { player: "LG", assignment: "Combo the tackle up to the Will", key: "WILL", win: "Seals the Will", fail: "Comes off too late", p: 0.8, critical: true },
            { player: "RB", assignment: "Read the first down lineman, then beat the safety", key: "SS", win: "Gets to the safety with a step", fail: "The safety fits him at the line", p: 0.78, critical: true }
          ] },
        { id: "dagger", concept: "dagger", label: "Dagger",
          detail: "H runs the seam, X runs a deep dig behind it.",
          need: 2.8, window: 0.42, yards: 15, spread: 4, intRisk: 0.07, luck: 0.06,
          grade: 58, category: "risky", conflict: "FS",
          why: "Dagger beats Cover 3. Against quarters, the free safety reads H's seam, carries it, then drives on the dig as soon as he sees it. The concept attacks exactly where quarters is strongest.",
          key: { answer: "FS", partial: {} },
          routes: [{ from: "H", path: [[17, 18]] }, { from: "X", path: [[8, 13], [20, 14]] }],
          assignments: [
            { player: "QB", assignment: "Hold the safety on the seam, then throw the dig", key: "FS", win: "The safety bites on the seam", fail: "The safety drives on the dig", p: 0.72, keyBonus: 0.08, critical: true },
            { player: "X", assignment: "Deep dig behind the linebackers", key: "WILL", win: "Clears the hook", fail: "Breaks too shallow", p: 0.8, critical: true }
          ] },
        { id: "verts", concept: "verts", label: "Four verticals",
          detail: "Everyone goes deep.",
          need: 2.9, window: 0.3, yards: 24, spread: 9, intRisk: 0.12, luck: 0.08,
          grade: 42, category: "poor", conflict: "FS",
          why: "Four deep defenders for four vertical routes: that's what quarters is built for.",
          key: { answer: "FS", partial: {} },
          routes: [{ from: "X", path: [[8, 18]] }, { from: "H", path: [[17, 18]] }, { from: "Y", path: [[31, 18]] }, { from: "Z", path: [[45, 18]] }],
          assignments: [
            { player: "QB", assignment: "Find a one-on-one deep", key: "FS", win: "A safety guesses wrong", fail: "Every route has a deep defender", p: 0.65, keyBonus: 0.08, critical: true },
            { player: "H", assignment: "Seam against the safety", key: "FS", win: "Gets on top", fail: "The safety stays on top", p: 0.6, critical: true }
          ] }
      ],
      contingencies: [
        { id: "built-in", label: "Built-in hot: if a rusher comes free, ball out to the quick route now", onPressure: "hot",
          grades: { quick: 95, smash: 88, "inside-zone": 75, dagger: 45, verts: 40 },
          why: "Against a four-man look the hot answer rarely matters, but slant-flat and the smash hitch have one built in." },
        { id: "sight", label: "Sight adjust: the slot converts to a slant against pressure", onPressure: "sight",
          throw: { window: 0.45, yards: 7, spread: 3, intRisk: 0.08, text: "Sight-adjusted slant" },
          grades: { quick: 80, smash: 75, "inside-zone": 65, dagger: 65, verts: 65 },
          why: "Fine as a rule, but against quarters the slot slant runs into the hook defender." },
        { id: "throwaway", label: "If the window closes, climb and throw it away", onPressure: "throwaway",
          grades: { quick: 75, smash: 75, "inside-zone": 65, dagger: 75, verts: 75 },
          why: "Second down: an incompletion leaves third-and-6. Better than a sack." },
        { id: "none", label: "Hold it: trust the protection", onPressure: "none",
          grades: { quick: 45, smash: 45, "inside-zone": 70, dagger: 40, verts: 40 },
          why: "Against this look you'll usually get away with it. That's not the same as a plan." }
      ],
      interactions: [
        { when: { protection: "max", play: "quick" }, window: -0.3, play: -20, note: "Max protection keeps the tight end in, and he was the flat route that makes slant-flat work." },
        { when: { protection: "five", play: "verts" }, protection: -10, note: "Five-man protection on a three-second concept: survivable against four, but a free rusher would get home." },
        { when: { play: "inside-zone" }, note: "On a run the protection call doesn't matter: the line is run blocking." }
      ],
      recommended: { motion: "yoyo", protection: "five", play: "quick", contingency: "built-in" },
      fit: { downs: [1, 2], distance: [4, 10], coverage: ["COVER_4", "COVER_6"], rushers: [4, 4], blitz: false },
      clues: [
        { text: "Two safeties at 12 yards, lined up over the slots rather than the hashes.", kind: "meaningful" },
        { text: "Corners off at 7 yards with outside leverage: they're bailing.", kind: "meaningful" },
        { text: "Six in the box against six blockers: even numbers for the run.", kind: "meaningful" },
        { text: "The safeties looked like Cover 2. They played quarters, reading your slots instead of the deep halves.", kind: "deceptive" }
      ],
      next: "Once you hit the flats, quarters teams roll a safety down or play Cover 6 to the side you attacked. Watch which side the safety leaves.",
      takeaway: "Quarters takes away the deep and intermediate middle with four deep defenders. That leaves only three underneath: throw the flats and quick game, and run it when the box is even.",
      learning: { objectives: ["Recognize quarters from its safety alignment", "Attack three underneath defenders", "Weigh the run against an even box"], tags: ["coverage-id", "run-vs-box"], misconceptions: ["Two-high always means Cover 2"], difficulty: 2, transfer: ["Cover 2 to quarters"], revisitDays: 3 }
    },

    {
      id: "rotation-3rd-7",
      title: "The Rotation",
      module: "nickel-pressure",
      order: 6,
      type: "synthetic",
      status: "published",
      version: 1,
      provenance: {
        type: "synthetic",
        label: "Synthetic teaching scenario. Not a real NFL play: the game, teams and result are invented to teach one principle.",
        sources: [],
        fieldConfidence: { all: "synthetic" },
        reviewer: "unreviewed",
        notes: "Two-high before the snap, Cover 3 after it: the most common disguise in the league."
      },
      context: {
        quarter: 3, clock: "4:15", score: { you: 13, opp: 17 },
        down: 3, distance: 7, yardLine: 44, side: "opp", hash: "left",
        objective: "Convert. A stop means a long field goal try or a punt from the 44.",
        scouting: "On third down this defense shows two safeties, then spins one down at the snap about half the time."
      },
      offense: {
        personnel: "11",
        personnelText: "11 personnel: 1 back, 1 tight end, 3 receivers",
        formation: "Trips right (3x1), tight end on the wing, back offset left",
        players: [
          { id: "X", label: "X", role: "Receiver (backside, left)", x: 6.5, y: -1 },
          { id: "LT", label: "LT", role: "Left tackle", x: 21.0, y: -1 },
          { id: "LG", label: "LG", role: "Left guard", x: 22.3, y: -1 },
          { id: "C", label: "C", role: "Center", x: 23.6, y: -1 },
          { id: "RG", label: "RG", role: "Right guard", x: 24.9, y: -1 },
          { id: "RT", label: "RT", role: "Right tackle", x: 26.2, y: -1 },
          { id: "QB", label: "QB", role: "Quarterback (shotgun)", x: 23.6, y: -5 },
          { id: "RB", label: "RB", role: "Running back, offset left", x: 21.8, y: -5 },
          { id: "Y", label: "Y", role: "Tight end, wing (#3 to trips)", x: 28.4, y: -2 },
          { id: "H", label: "H", role: "Slot receiver (#2)", x: 34.5, y: -1.8 },
          { id: "Z", label: "Z", role: "Receiver (#1 to trips)", x: 44, y: -1 }
        ]
      },
      defense: {
        personnel: "nickel",
        personnelText: "Nickel: 4 linemen, 2 linebackers, 5 defensive backs",
        front: "Four-down even front",
        shell: "two-high",
        boxCount: 6,
        disguise: "high",
        players: [
          { id: "CBL", label: "LCB", role: "Left cornerback", x: 6.5, y: 7 },
          { id: "FS", label: "FS", role: "Free safety, boundary side", x: 15, y: 13 },
          { id: "DEL", label: "E", role: "Left end", x: 20.2, y: 1 },
          { id: "DT", label: "T", role: "Defensive tackle", x: 22.6, y: 1 },
          { id: "WILL", label: "W", role: "Will linebacker", x: 21.8, y: 4.5 },
          { id: "NT", label: "N", role: "Nose tackle", x: 24.1, y: 1 },
          { id: "MIKE", label: "M", role: "Mike linebacker", x: 25.5, y: 4.5 },
          { id: "DER", label: "E", role: "Right end", x: 27.6, y: 1 },
          { id: "NB", label: "NB", role: "Nickel, off over the slot", x: 33.5, y: 5 },
          { id: "SS", label: "SS", role: "Strong safety, trips side", x: 34, y: 13 },
          { id: "CBR", label: "RCB", role: "Right cornerback", x: 44, y: 7 }
        ]
      },
      actual: {
        call: "gen-cover-3",
        pressure: "four",
        rushers: ["DEL", "DT", "NT", "DER"],
        droppers: ["CBL", "FS", "WILL", "MIKE", "NB", "SS", "CBR"],
        coverage: "Cover 3 (rotated from two-high)",
        rotation: "At the snap the strong safety spins down to the curl-flat on the trips side and the free safety rotates to the deep middle. Two-high became one-high.",
        post: {
          CBL: { x: 8, y: 15, zone: "Deep third" },
          FS: { x: 24, y: 16, zone: "Deep middle third" },
          DEL: { x: 21.5, y: -3.5 },
          DT: { x: 22.6, y: -3 },
          WILL: { x: 19, y: 7, zone: "Curl-flat" },
          NT: { x: 24, y: -3 },
          MIKE: { x: 25, y: 7, zone: "Hook" },
          DER: { x: 25.8, y: -3.5 },
          NB: { x: 30, y: 7, zone: "Hook-curl" },
          SS: { x: 37, y: 6, zone: "Curl-flat (rotated down)" },
          CBR: { x: 42, y: 15, zone: "Deep third" }
        },
        events: [
          { t: 0.2, text: "Four rush. At the snap the strong safety spins down; the free safety runs to the middle." },
          { t: 0.7, text: "Two-high has become Cover 3: three deep, four underneath." },
          { t: 1.2, text: "The hook defenders sit at 7 yards. Behind them, between the hook and the deep third, is the dagger window." }
        ]
      },
      diagnosis: {
        questions: [
          { id: "personnel", prompt: "What defensive personnel is on the field?", kind: "single",
            options: [{ id: "base", label: "Base (4 DBs)" }, { id: "nickel", label: "Nickel (5 DBs)" }, { id: "dime", label: "Dime (6 DBs)" }],
            credit: { base: 20, nickel: 100, dime: 40 }, error: "personnel",
            explain: "Two corners, a nickel, two safeties: nickel." },
          { id: "shell", prompt: "What safety shell is the defense showing?", kind: "single",
            options: [{ id: "two", label: "Two-high" }, { id: "one", label: "One-high" }, { id: "zero", label: "Zero (no deep safety)" }],
            credit: { two: 100, one: 40, zero: 0 }, error: "shell",
            explain: "It shows two-high, both safeties at 13. It played one-high. Reading what's shown correctly is the right answer here; the lesson is what you do about the chance it rotates." },
          { id: "rushers", prompt: "Tap every defender who could rush.", kind: "rushers",
            answer: ["DEL", "DT", "NT", "DER", "WILL", "MIKE", "NB"], critical: "NB", error: "pressure-count",
            explain: "Seven can come; nothing about this look says more than four will." },
          { id: "pressure", prompt: "What's the most likely pressure?", kind: "single",
            options: [{ id: "four", label: "Four-man rush" }, { id: "five", label: "Five-man pressure" }, { id: "six", label: "Six or more (Cover 0)" }],
            credit: { four: 100, five: 60, six: 20 }, error: "pressure-count",
            explain: "Two-high with the nickel off: four rush." }
        ]
      },
      motions: [
        { id: "none", label: "No motion", text: "Snap it. The rotation, if it's coming, comes at the snap." },
        { id: "yoyo", label: "Slot yo-yo motion", detail: "H motions in and back out.",
          path: { from: "H", to: [30.5, -2], back: true },
          moves: { SS: [34, 10.5] },
          text: "The strong safety crept down from 13 to 10 yards as H moved. Safeties who creep on motion are often the one rotating down. Evidence, not proof.",
          clue: "The strong safety crept to 10 yards on motion: a sign he's the one rotating down." },
        { id: "rbshift", label: "Shift the back to the trips side", detail: "RB moves to the right of the quarterback.",
          path: { from: "RB", to: [25.4, -5] },
          moves: { MIKE: [26, 4.5] },
          text: "The Mike bumped with the back; the safeties held. No new information about the shell.",
          clue: "The Mike bumped with the back; the safeties held still." }
      ],
      protections: [
        { id: "five", label: "Five-man protection, back releases", detail: "Five block four; the back checks and releases.",
          hold: 3.0, grade: 85, category: "valid", hotPlan: true,
          why: "Fine against four, but dagger needs time and a sixth blocker buys it.",
          assignments: [{ player: "QB", assignment: "If a fifth rusher comes, ball out hot", key: "NB", win: "Ball out on time", fail: "Holds it", p: 0.88 }] },
        { id: "six", label: "Six-man: the back stays in to check", detail: "The back checks the linebackers, then releases late.",
          hold: 3.4, grade: 92, category: "recommended",
          why: "Dagger needs nearly three seconds. Six blockers against a likely four-man rush buys them.",
          assignments: [{ player: "RB", assignment: "Check the Mike, then release to the flat", key: "MIKE", win: "Picks him up or releases late", fail: "Misses a blitzing Mike", p: 0.9 }] },
        { id: "max", label: "Max protection: back and tight end stay in", detail: "Seven block; three go out.",
          hold: 3.8, grade: 62, category: "safe",
          why: "Too many blockers for four rushers on third-and-7, and Y was the seam runner that makes dagger work.",
          assignments: [{ player: "Y", assignment: "Block the right end", key: "DER", win: "Walls him off", fail: "Gets beat", p: 0.92 }] }
      ],
      plays: [
        { id: "dagger", concept: "dagger", label: "Dagger to the trips side",
          detail: "Y runs the seam, H runs a deep dig behind it at 14 yards, Z runs a go.",
          need: 2.8, window: 0.68, yards: 15, spread: 4, intRisk: 0.05, luck: 0.05,
          grade: 95, category: "recommended", conflict: "FS",
          why: "Dagger beats Cover 3 and survives two-high. Against the rotation, Y's seam holds the free safety in the deep middle and the dig comes open behind the hook defenders. If it stays two-high, the seam splits the safeties.",
          key: { answer: "FS", partial: { MIKE: "The Mike is the hook defender the dig runs behind. The free safety decides if the seam or the dig is open." } },
          routes: [{ from: "Y", path: [[29, 18]] }, { from: "H", path: [[34.5, 13], [24, 14]] }, { from: "Z", path: [[44, 18]] }],
          assignments: [
            { player: "QB", assignment: "Read the middle of the field: seam if it's open, dig if the safety takes the seam", key: "FS", win: "Throws the side the safety leaves", fail: "Throws the dig into a hook defender", p: 0.84, keyBonus: 0.08, critical: true },
            { player: "H", assignment: "Deep dig behind the hook defenders", key: "MIKE", win: "Breaks at 14, behind the Mike", fail: "Breaks too shallow into the Mike", p: 0.82, critical: true }
          ] },
        { id: "verts", concept: "verts", label: "Four verticals",
          detail: "Four go deep.",
          need: 2.9, window: 0.56, yards: 22, spread: 8, intRisk: 0.1, luck: 0.08,
          grade: 80, category: "aggressive", conflict: "FS",
          why: "Four verticals beats Cover 3 too: four routes on three deep defenders. Bigger payoff than dagger, but it needs the quarterback to move the safety and the line to hold up longer.",
          key: { answer: "FS", partial: {} },
          routes: [{ from: "X", path: [[6.5, 18]] }, { from: "Y", path: [[29, 18]] }, { from: "H", path: [[34.5, 6], [33, 18]] }, { from: "Z", path: [[44, 18]] }],
          assignments: [
            { player: "QB", assignment: "Look off the free safety, throw the seam he leaves", key: "FS", win: "Moves the safety", fail: "Stares down one seam", p: 0.74, keyBonus: 0.08, critical: true },
            { player: "H", assignment: "Seam, outside the free safety", key: "FS", win: "Stays on his landmark", fail: "Drifts into the safety", p: 0.78, critical: true }
          ] },
        { id: "mesh", concept: "mesh", label: "Mesh",
          detail: "H and Y cross underneath.",
          need: 2.3, window: 0.5, yards: 7, spread: 4, intRisk: 0.04, luck: 0.03,
          hot: { window: 0.45, yards: 5, spread: 2, text: "Ball out early to the first crosser" },
          grade: 70, category: "valid", conflict: "MIKE",
          why: "Crossers are built for man. Against Cover 3 they run into four underneath zone defenders and sit down short of the sticks.",
          key: { answer: "MIKE", partial: {} },
          routes: [{ from: "H", path: [[34.5, 1], [26, 3], [16, 3]] }, { from: "Y", path: [[28.4, 1], [33, 5], [40, 5]] }],
          assignments: [
            { player: "QB", assignment: "Hit the crosser who settles in a hole", key: "MIKE", win: "Finds the hole on time", fail: "Throws into a zone defender", p: 0.8, keyBonus: 0.08, critical: true },
            { player: "H", assignment: "Cross and settle past the sticks", key: "MIKE", win: "Settles at 7 in a hole", fail: "Runs into a hook defender", p: 0.75, critical: true }
          ] },
        { id: "smash", concept: "smash", label: "Smash to the trips side",
          detail: "Z runs a hitch, H a corner route over it.",
          need: 2.4, window: 0.42, yards: 9, spread: 5, intRisk: 0.05, luck: 0.04,
          hot: { window: 0.4, yards: 5, spread: 2, text: "Ball out early to the hitch" },
          grade: 58, category: "poor", conflict: "SS",
          why: "Smash beats Cover 2, the shell they showed. After the rotation the corner is already deep in his third, sitting on the corner route, and the rotated safety sits on the hitch at 6 yards, short of the sticks.",
          key: { answer: "SS", partial: { CBR: "In Cover 3 he's deep; the rotated safety is the one squeezing the hitch." } },
          routes: [{ from: "Z", path: [[44, 5], [44.5, 4.5]] }, { from: "H", path: [[34.5, 10], [40, 15]] }],
          assignments: [
            { player: "QB", assignment: "Corner route if the corner squats, hitch if he bails", key: "CBR", win: "Reads the corner right", fail: "Throws the corner into a deep third", p: 0.8, keyBonus: 0.05, critical: true },
            { player: "H", assignment: "Corner route at 12", key: "CBR", win: "Gets outside the corner", fail: "Runs into the deep third", p: 0.7, critical: true }
          ] }
      ],
      contingencies: [
        { id: "built-in", label: "Built-in hot: if a rusher comes free, ball out to the quick route now", onPressure: "hot",
          grades: { dagger: 55, verts: 45, mesh: 90, smash: 85 },
          why: "Dagger and verticals have no quick route, so a hot answer means nothing there; that's why the protection matters more on this call." },
        { id: "sight", label: "Sight adjust: the slot converts to a slant against pressure", onPressure: "sight",
          throw: { window: 0.4, yards: 7, spread: 3, intRisk: 0.08, text: "Sight-adjusted slant" },
          grades: { dagger: 70, verts: 70, mesh: 70, smash: 70 },
          why: "A reasonable fallback against an unexpected blitz." },
        { id: "throwaway", label: "If the window closes, climb and throw it away", onPressure: "throwaway",
          grades: { dagger: 80, verts: 80, mesh: 75, smash: 75 },
          why: "On third down a throwaway keeps the field goal try alive." },
        { id: "none", label: "Hold it: trust the protection", onPressure: "none",
          grades: { dagger: 50, verts: 45, mesh: 40, smash: 40 },
          why: "Against four rushers it often works. It's still a hope, not a plan." }
      ],
      interactions: [
        { when: { protection: "max", play: "dagger" }, window: -0.3, play: -25, note: "Max protection keeps Y in, and his seam is what holds the safety for the dig." },
        { when: { protection: "five", play: "verts" }, protection: -10, note: "Five-man protection on a three-second concept: risky if a fifth comes." },
        { when: { protection: "five", play: "dagger" }, protection: -5, note: "Dagger develops slowly; a sixth blocker is cheap insurance." }
      ],
      recommended: { motion: "yoyo", protection: "six", play: "dagger", contingency: "built-in" },
      fit: { downs: [3], distance: [5, 10], coverage: ["COVER_3", "COVER_9"], rushers: [4, 4], blitz: false },
      clues: [
        { text: "Two safeties at 13 yards before the snap.", kind: "deceptive" },
        { text: "The nickel off at 5 yards and the corners at 7: no pressure tell.", kind: "meaningful" },
        { text: "Third-and-7 against a defense that rotates about half the time on third down.", kind: "meaningful" },
        { text: "Which safety rotates, if either: you can't know before the snap.", kind: "uncertain" }
      ],
      next: "After dagger hurts the rotation, expect them to stay two-high and sit a defender at 14 yards in the middle (Tampa 2 or quarters). Then the flats and the seams outside the safeties come open.",
      takeaway: "Two-high before the snap isn't a promise. Pick a call that wins against the shell they show and the one they can rotate to: dagger beats Cover 3 and still splits two-high safeties.",
      learning: { objectives: ["Expect post-snap rotation", "Choose a call that survives two shells", "Beat Cover 3 in the middle of the field"], tags: ["coverage-id", "pressure-disguise"], misconceptions: ["Two-high means Cover 2"], difficulty: 3, transfer: ["Two-high shown to one-high played"], revisitDays: 3 }
    },

    {
      id: "creeper-3rd-6",
      title: "Creeper",
      module: "nickel-pressure",
      order: 7,
      type: "synthetic",
      status: "published",
      version: 1,
      provenance: {
        type: "synthetic",
        label: "Synthetic teaching scenario. Not a real NFL play: the game, teams and result are invented to teach one principle.",
        sources: [],
        fieldConfidence: { all: "synthetic" },
        reviewer: "unreviewed",
        notes: "Simulated pressure: four rush, but not the four you expect. A linebacker blitzes and an end drops into the throwing lane."
      },
      context: {
        quarter: 2, clock: "6:30", score: { you: 7, opp: 7 },
        down: 3, distance: 6, yardLine: 47, side: "own", hash: "middle",
        objective: "Convert to keep the drive alive near midfield.",
        scouting: "This defense rushes four on most third downs, but often not the same four: a linebacker comes and an end drops."
      },
      offense: {
        personnel: "11",
        personnelText: "11 personnel: 1 back, 1 tight end, 3 receivers",
        formation: "Doubles (2x2), tight end attached right, back offset left",
        players: [
          { id: "X", label: "X", role: "Receiver (#1 left)", x: 8, y: -1 },
          { id: "H", label: "H", role: "Slot receiver (#2 left)", x: 17, y: -1.8 },
          { id: "LT", label: "LT", role: "Left tackle", x: 24.05, y: -1 },
          { id: "LG", label: "LG", role: "Left guard", x: 25.35, y: -1 },
          { id: "C", label: "C", role: "Center", x: 26.65, y: -1 },
          { id: "RG", label: "RG", role: "Right guard", x: 27.95, y: -1 },
          { id: "RT", label: "RT", role: "Right tackle", x: 29.25, y: -1 },
          { id: "Y", label: "Y", role: "Tight end, attached right", x: 30.7, y: -1 },
          { id: "QB", label: "QB", role: "Quarterback (shotgun)", x: 26.65, y: -5 },
          { id: "RB", label: "RB", role: "Running back, offset left", x: 24.8, y: -5 },
          { id: "Z", label: "Z", role: "Receiver (#1 right)", x: 45, y: -1.8 }
        ]
      },
      defense: {
        personnel: "nickel",
        personnelText: "Nickel: 4 linemen, 2 linebackers, 5 defensive backs",
        front: "Four-down front, both linebackers walked up",
        shell: "two-high",
        boxCount: 6,
        disguise: "high",
        players: [
          { id: "CBL", label: "LCB", role: "Left cornerback", x: 8, y: 7 },
          { id: "NB", label: "NB", role: "Nickel over the slot", x: 18, y: 4 },
          { id: "FS", label: "FS", role: "Free safety", x: 19, y: 13 },
          { id: "DEL", label: "E", role: "Left end", x: 23, y: 1 },
          { id: "WILL", label: "W", role: "Will linebacker, walked up in the A-gap", x: 26, y: 2.5 },
          { id: "DT", label: "T", role: "Defensive tackle", x: 25.2, y: 1 },
          { id: "NT", label: "N", role: "Nose tackle", x: 27.6, y: 1 },
          { id: "MIKE", label: "M", role: "Mike linebacker, walked up in the other A-gap", x: 27.4, y: 2.5 },
          { id: "DER", label: "E", role: "Right end", x: 30.6, y: 1 },
          { id: "SS", label: "SS", role: "Strong safety", x: 34, y: 13 },
          { id: "CBR", label: "RCB", role: "Right cornerback", x: 45, y: 7 }
        ]
      },
      actual: {
        call: "gen-cover-3",
        pressure: "four",
        rushers: ["DT", "NT", "MIKE", "DER"],
        droppers: ["CBL", "NB", "FS", "DEL", "WILL", "SS", "CBR"],
        coverage: "Cover 3 behind simulated pressure",
        rotation: "The left end drops into the hook zone, the Will bails from the A-gap to the middle, and the Mike blitzes. The free safety rotates to the deep middle.",
        post: {
          CBL: { x: 9, y: 15, zone: "Deep third" },
          NB: { x: 15, y: 6, zone: "Curl-flat" },
          FS: { x: 26, y: 16, zone: "Deep middle third" },
          DEL: { x: 21, y: 6, zone: "Hook (dropped end)" },
          WILL: { x: 28, y: 7, zone: "Hook" },
          DT: { x: 25, y: -3 },
          NT: { x: 27.2, y: -3 },
          MIKE: { x: 27.6, y: -3.5 },
          DER: { x: 29.5, y: -3.5 },
          SS: { x: 36, y: 6, zone: "Curl-flat" },
          CBR: { x: 44, y: 15, zone: "Deep third" }
        },
        events: [
          { t: 0.2, text: "The Mike blitzes up the A-gap; the left end, who looked like a rusher, drops." },
          { t: 0.5, text: "Only four rush, but the line slid toward the end who dropped. The Mike is unblocked unless someone has him by rule." },
          { t: 0.9, text: "The dropped end sits in the slant window to the left. Cover 3 behind it." }
        ]
      },
      diagnosis: {
        questions: [
          { id: "personnel", prompt: "What defensive personnel is on the field?", kind: "single",
            options: [{ id: "base", label: "Base (4 DBs)" }, { id: "nickel", label: "Nickel (5 DBs)" }, { id: "dime", label: "Dime (6 DBs)" }],
            credit: { base: 20, nickel: 100, dime: 40 }, error: "personnel",
            explain: "Two corners, a nickel, two safeties: nickel." },
          { id: "shell", prompt: "What safety shell is the defense showing?", kind: "single",
            options: [{ id: "two", label: "Two-high" }, { id: "one", label: "One-high" }, { id: "zero", label: "Zero (no deep safety)" }],
            credit: { two: 100, one: 40, zero: 0 }, error: "shell",
            explain: "Two safeties at 13: two-high before the snap." },
          { id: "rushers", prompt: "Tap every defender who could rush.", kind: "rushers",
            answer: ["DEL", "DT", "NT", "DER", "WILL", "MIKE", "NB"], critical: "MIKE", error: "pressure-count",
            explain: "Seven can come, six with a fast path: four linemen and two linebackers walked into the A-gaps. That's more than five can block, so the protection has to decide by rule who's whose." },
          { id: "pressure", prompt: "What's the most likely pressure?", kind: "single",
            options: [{ id: "four", label: "Four-man rush" }, { id: "five", label: "Five-man pressure" }, { id: "six", label: "Six or more (Cover 0)" }],
            credit: { four: 70, five: 100, six: 60 }, error: "pressure-count",
            explain: "Double A-gap linebackers look like five or six. It was four, a simulated pressure. Reading it as pressure was the right read of the evidence; what matters is that the protection handles any four of the six." }
        ]
      },
      motions: [
        { id: "none", label: "No motion", text: "Snap it. Against a creeper, motion rarely reveals who's dropping." },
        { id: "yoyo", label: "Slot yo-yo motion", detail: "H motions in and back out.",
          path: { from: "H", to: [22, -2], back: true },
          moves: { NB: [18.6, 4] },
          text: "The nickel bumped but didn't follow: zone behind whatever they're bringing. Both linebackers stayed in the A-gaps.",
          clue: "The nickel bumped without following: zone behind the pressure look." },
        { id: "rbshift", label: "Shift the back to the right", detail: "RB moves to the other side of the quarterback.",
          path: { from: "RB", to: [28.5, -5] },
          moves: { WILL: [25.8, 2.5] },
          text: "The Will shuffled with the back. The linebackers are keyed on him: one might be spying or taking him in coverage.",
          clue: "The Will shuffled with the back's shift." }
      ],
      protections: [
        { id: "big-on-big", label: "Big-on-big: linemen on linemen, the back takes the first linebacker who comes", detail: "Each lineman blocks the man in front of him; the back is responsible for either linebacker.",
          hold: 2.9, grade: 95, category: "recommended",
          why: "A rule-based protection: whichever linebacker comes, the back has him, and when an end drops his tackle simply helps inside. Simulated pressure can't create a free rusher against it.",
          assignments: [{ player: "RB", assignment: "Take the first linebacker who comes", key: "MIKE", win: "Meets the Mike in the A-gap", fail: "Commits to the Will, who dropped", p: 0.88 }] },
        { id: "slide", label: "Slide left toward the end, back takes the right side", detail: "The line slides left as a unit; the back blocks anything off the right.",
          hold: 1.8, grade: 60, category: "risky",
          why: "Sliding toward an end who drops wastes a blocker on nobody, and the A-gap linebacker on the other side comes free.",
          assignments: [{ player: "C", assignment: "Slide left with the line", key: "MIKE", win: "The Mike comes into the slide", fail: "The Mike comes through the vacated A-gap", p: 0.4 }] },
        { id: "five", label: "Five-man: the back runs a route, QB hot off the linebackers", detail: "Five linemen; any linebacker who comes is the quarterback's.",
          hold: 1.6, grade: 72, category: "valid", hotPlan: true,
          why: "Legitimate if the ball comes out hot, but the hot throw goes right where the dropping end sits.",
          assignments: [{ player: "QB", assignment: "Throw hot when a linebacker comes", key: "MIKE", win: "Ball out on time, away from the dropper", fail: "Hot throw into the dropped end", p: 0.75 }] },
        { id: "max", label: "Max protection: back and tight end stay in", detail: "Seven block; three go out.",
          hold: 3.4, grade: 65, category: "safe",
          why: "Everyone is blocked, but three receivers against seven droppers on third-and-6.",
          assignments: [{ player: "Y", assignment: "Block the right end", key: "DER", win: "Walls him off", fail: "Gets beat inside", p: 0.9 }] }
      ],
      plays: [
        { id: "stick", concept: "stick", label: "Stick to the right",
          detail: "Y runs the stick at 6, Z clears deep, the back releases to the flat after checking.",
          need: 2.2, window: 0.7, yards: 7, spread: 2, intRisk: 0.04, luck: 0.03,
          hot: { window: 0.6, yards: 6, spread: 2, text: "Ball out early to the stick" },
          grade: 95, category: "recommended", conflict: "SS",
          why: "Stick attacks the side away from the dropped end. Against Cover 3 the curl-flat defender has the stick and the flat; whichever he takes, throw the other.",
          key: { answer: "SS", partial: { DEL: "He's the trap on the other side. Throwing away from him is the point; the safety on this side is your read." } },
          routes: [{ from: "Y", path: [[31, 5.5], [30.4, 5]] }, { from: "Z", path: [[45, 18]] }, { from: "RB", path: [[27, -3], [34, 1]] }],
          assignments: [
            { player: "QB", assignment: "Read the strong safety: stick if he widens, flat if he sits", key: "SS", win: "Throws away from the safety on rhythm", fail: "Stares at the stick", p: 0.84, keyBonus: 0.08, critical: true },
            { player: "Y", assignment: "Stick at 6, settle in the hole", key: "WILL", win: "Sits in the window facing the QB", fail: "Drifts into the hook defender", p: 0.85, critical: true }
          ] },
        { id: "slant", concept: "hot-slant", label: "Hot slant to the left",
          detail: "H runs a three-step slant, the natural answer to A-gap pressure.",
          need: 1.3, window: 0.3, yards: 7, spread: 3, intRisk: 0.2, luck: 0.02,
          grade: 40, category: "poor", conflict: "DEL",
          why: "This is exactly what a creeper is designed to bait. The quarterback sees A-gap pressure and throws hot to the slant, right into the defensive end who dropped into that lane.",
          key: { answer: "DEL", partial: { NB: "The nickel is outside; the dropped end is the defender sitting in the slant window." } },
          routes: [{ from: "H", path: [[17, 1], [21.5, 5]] }],
          assignments: [
            { player: "QB", assignment: "Throw hot off the linebacker", key: "MIKE", win: "Ball out on rhythm", fail: "Throws it to the dropped end", p: 0.9, critical: true },
            { player: "H", assignment: "Slant inside the nickel", key: "DEL", win: "Catches it before the end gets there", fail: "Runs into the dropped end", p: 0.6, critical: true }
          ] },
        { id: "verts", concept: "verts", label: "Four verticals",
          detail: "Everyone goes deep.",
          need: 2.9, window: 0.55, yards: 22, spread: 8, intRisk: 0.1, luck: 0.08,
          grade: 72, category: "aggressive", conflict: "FS",
          why: "Cover 3 behind it, so four verticals on three deep is a real shot, but only if the protection picks up the blitzing linebacker for three seconds.",
          key: { answer: "FS", partial: {} },
          routes: [{ from: "X", path: [[8, 18]] }, { from: "H", path: [[17, 6], [19, 18]] }, { from: "Y", path: [[31, 6], [33, 18]] }, { from: "Z", path: [[45, 18]] }],
          assignments: [
            { player: "QB", assignment: "Move the free safety, throw the open seam", key: "FS", win: "Moves him", fail: "Locks on one seam", p: 0.74, keyBonus: 0.08, critical: true },
            { player: "H", assignment: "Seam outside the safety", key: "FS", win: "Stays on his landmark", fail: "Drifts inside", p: 0.76, critical: true }
          ] },
        { id: "screen", concept: "screen", label: "Running back screen",
          detail: "Let the rush through, throw it to the back behind it.",
          need: 1.5, window: 0.42, yards: 7, spread: 5, intRisk: 0.02, luck: 0.04,
          grade: 62, category: "conservative", conflict: "DEL",
          why: "Screens punish blitzers who run past the back. A creeper drops an end right where screens go, and he's facing the play.",
          key: { answer: "DEL", partial: {} },
          routes: [{ from: "RB", path: [[22, -2], [19, 1]] }],
          assignments: [
            { player: "LT", assignment: "Release and lead the screen", key: "DEL", win: "Gets a hat on the dropped end", fail: "The end sits on the back", p: 0.7, critical: true },
            { player: "RB", assignment: "Sell the block, catch it behind the line", key: "DEL", win: "Turns upfield behind blockers", fail: "Caught by the dropped end", p: 0.8, critical: true }
          ] }
      ],
      contingencies: [
        { id: "built-in", label: "Built-in hot: if a rusher comes free, ball out to the quick route now", onPressure: "hot",
          grades: { stick: 92, slant: 70, verts: 40, screen: 75 },
          why: "With a rule-based protection nobody should come free; the stick is still there if one does." },
        { id: "sight", label: "Sight adjust: the slot converts to a slant against pressure", onPressure: "sight",
          throw: { window: 0.3, yards: 7, spread: 3, intRisk: 0.2, text: "Sight-adjusted slant" },
          grades: { stick: 45, slant: 50, verts: 50, screen: 45 },
          why: "The conversion a creeper is built to bait: the slant goes straight to the end who dropped." },
        { id: "throwaway", label: "If the window closes, climb and throw it away", onPressure: "throwaway",
          grades: { stick: 75, slant: 70, verts: 75, screen: 65 },
          why: "A sound floor on third down." },
        { id: "none", label: "Hold it: trust the protection", onPressure: "none",
          grades: { stick: 55, slant: 30, verts: 45, screen: 50 },
          why: "With the right protection, trusting it is closer to reasonable here. Still not a plan." }
      ],
      interactions: [
        { when: { protection: "max", play: "stick" }, window: -0.3, play: -20, note: "Max protection keeps Y in, and he's the stick runner." },
        { when: { protection: "five", play: "verts" }, protection: -30, note: "Five-man protection with a blitzing linebacker and a three-second concept: nobody blocks him and nothing's quick." },
        { when: { protection: "slide", play: "verts" }, protection: -10, note: "The slide leaves the A-gap open on a long-developing call." }
      ],
      recommended: { motion: "yoyo", protection: "big-on-big", play: "stick", contingency: "built-in" },
      fit: { downs: [3], distance: [4, 8], rushers: [4, 4], blitz: true },
      clues: [
        { text: "Both linebackers walked up into the A-gaps: six can come fast.", kind: "meaningful" },
        { text: "Two safeties deep behind it. Real pressure usually leaves one.", kind: "meaningful" },
        { text: "The left end in a rushing stance. He dropped into the slant lane.", kind: "deceptive" },
        { text: "Which linebacker comes, if either: you can't tell before the snap.", kind: "uncertain" }
      ],
      next: "Beat a creeper with the right protection and they'll bring both linebackers next time: a real six-man pressure. The same rule-based protection has to hand the second one to the quarterback.",
      takeaway: "Simulated pressure rushes four, but not the four you expect. Protect by rule (linemen on linemen, the back on the first linebacker) and throw away from the defender who dropped.",
      learning: { objectives: ["Recognize simulated pressure", "Protect by rule rather than by guess", "Throw away from a dropping lineman"], tags: ["protection-count", "pressure-disguise"], misconceptions: ["A-gap pressure means throw hot"], difficulty: 3, transfer: ["Real pressure to simulated pressure"], revisitDays: 3 }
    },

    {
      id: "two-man-3rd-9",
      title: "2-Man on Third and Long",
      module: "nickel-pressure",
      order: 8,
      type: "synthetic",
      status: "published",
      version: 1,
      provenance: {
        type: "synthetic",
        label: "Synthetic teaching scenario. Not a real NFL play: the game, teams and result are invented to teach one principle.",
        sources: [],
        fieldConfidence: { all: "synthetic" },
        reviewer: "unreviewed",
        notes: "2-Man: trailing man coverage underneath, two safeties over the top. The classic third-and-long call."
      },
      context: {
        quarter: 4, clock: "8:02", score: { you: 21, opp: 24 },
        down: 3, distance: 9, yardLine: 32, side: "own", hash: "middle",
        objective: "Convert. Down three in the fourth quarter, a punt from your own 32 hands them the ball with a lead.",
        scouting: "On third and long this defense plays 2-Man: everyone in man with inside leverage, two safeties deep."
      },
      offense: {
        personnel: "11",
        personnelText: "11 personnel: 1 back, 1 tight end, 3 receivers",
        formation: "Doubles (2x2), tight end detached right, back to the left",
        players: [
          { id: "X", label: "X", role: "Receiver (#1 left)", x: 8, y: -1 },
          { id: "H", label: "H", role: "Slot receiver (#2 left)", x: 17, y: -1.8 },
          { id: "LT", label: "LT", role: "Left tackle", x: 24.05, y: -1 },
          { id: "LG", label: "LG", role: "Left guard", x: 25.35, y: -1 },
          { id: "C", label: "C", role: "Center", x: 26.65, y: -1 },
          { id: "RG", label: "RG", role: "Right guard", x: 27.95, y: -1 },
          { id: "RT", label: "RT", role: "Right tackle", x: 29.25, y: -1 },
          { id: "QB", label: "QB", role: "Quarterback (shotgun)", x: 26.65, y: -5 },
          { id: "RB", label: "RB", role: "Running back, offset left", x: 24.8, y: -5 },
          { id: "Y", label: "Y", role: "Tight end, detached slot right", x: 36, y: -1.8 },
          { id: "Z", label: "Z", role: "Receiver (#1 right)", x: 45, y: -1 }
        ]
      },
      defense: {
        personnel: "nickel",
        personnelText: "Nickel: 4 linemen, 2 linebackers, 5 defensive backs",
        front: "Four-down front",
        shell: "two-high",
        boxCount: 6,
        disguise: "low",
        players: [
          { id: "CBL", label: "LCB", role: "Left cornerback, pressed with inside leverage", x: 8.6, y: 1.5 },
          { id: "NB", label: "NB", role: "Nickel, pressed on the slot", x: 17.6, y: 1.5 },
          { id: "FS", label: "FS", role: "Free safety, deep half", x: 15, y: 14 },
          { id: "DEL", label: "E", role: "Left end", x: 23, y: 1 },
          { id: "WILL", label: "W", role: "Will linebacker", x: 24.6, y: 4.5 },
          { id: "DT", label: "T", role: "Defensive tackle", x: 25.2, y: 1 },
          { id: "NT", label: "N", role: "Nose tackle", x: 27.6, y: 1 },
          { id: "MIKE", label: "M", role: "Mike linebacker", x: 29, y: 4.5 },
          { id: "DER", label: "E", role: "Right end", x: 30.6, y: 1 },
          { id: "SS", label: "SS", role: "Strong safety, deep half", x: 38, y: 14 },
          { id: "CBR", label: "RCB", role: "Right cornerback, pressed with inside leverage", x: 44.4, y: 1.5 }
        ]
      },
      actual: {
        call: "gen-2-man",
        pressure: "four",
        rushers: ["DEL", "DT", "NT", "DER"],
        droppers: ["CBL", "NB", "FS", "WILL", "MIKE", "SS", "CBR"],
        coverage: "2-Man",
        rotation: "None. Five defenders in man with inside leverage, trailing their receivers; two safeties split the deep halves. Nobody is watching the quarterback.",
        post: {
          CBL: { x: 9, y: 7, zone: "Man: X" },
          NB: { x: 18, y: 6, zone: "Man: H" },
          FS: { x: 15, y: 16, zone: "Deep half" },
          DEL: { x: 24.5, y: -3.5 },
          WILL: { x: 23, y: 2, zone: "Man: RB" },
          DT: { x: 25.6, y: -3 },
          NT: { x: 27.4, y: -3 },
          MIKE: { x: 35, y: 6, zone: "Man: Y" },
          DER: { x: 29, y: -3.5 },
          SS: { x: 38, y: 16, zone: "Deep half" },
          CBR: { x: 44, y: 7, zone: "Man: Z" }
        },
        events: [
          { t: 0.2, text: "Every underneath defender turns and trails his man from inside leverage. Two safeties stay over the top." },
          { t: 0.8, text: "Vertical routes are bracketed: a trailing defender underneath, a safety on top." },
          { t: 1.5, text: "With every back turned, the middle of the field behind the rush is empty." }
        ]
      },
      diagnosis: {
        questions: [
          { id: "personnel", prompt: "What defensive personnel is on the field?", kind: "single",
            options: [{ id: "base", label: "Base (4 DBs)" }, { id: "nickel", label: "Nickel (5 DBs)" }, { id: "dime", label: "Dime (6 DBs)" }],
            credit: { base: 20, nickel: 100, dime: 40 }, error: "personnel",
            explain: "Two corners, a nickel, two safeties: nickel." },
          { id: "shell", prompt: "What safety shell is the defense showing?", kind: "single",
            options: [{ id: "two", label: "Two-high" }, { id: "one", label: "One-high" }, { id: "zero", label: "Zero (no deep safety)" }],
            credit: { two: 100, one: 40, zero: 0 }, error: "shell",
            explain: "Two safeties at 14, wide: two-high, with pressed corners underneath. That combination is the 2-Man tell." },
          { id: "rushers", prompt: "Tap every defender who could rush.", kind: "rushers",
            answer: ["DEL", "DT", "NT", "DER", "WILL", "MIKE"], critical: "WILL", error: "pressure-count",
            explain: "Six can come: four linemen and two linebackers. The pressed DBs have receivers." },
          { id: "pressure", prompt: "What's the most likely pressure?", kind: "single",
            options: [{ id: "four", label: "Four-man rush" }, { id: "five", label: "Five-man pressure" }, { id: "six", label: "Six or more (Cover 0)" }],
            credit: { four: 100, five: 60, six: 20 }, error: "pressure-count",
            explain: "Two deep safeties and five in man: four rush. Third-and-9 is where defenses trust coverage." }
        ]
      },
      motions: [
        { id: "none", label: "No motion", text: "Snap it." },
        { id: "yoyo", label: "Slot yo-yo motion", detail: "H motions in and back out.",
          path: { from: "H", to: [22, -2], back: true },
          moves: { NB: [17.8, 1.6] },
          text: "The nickel ran with him in and back out, staying on his inside hip, and both safeties stayed deep. Man underneath, two-high over the top: 2-Man.",
          clue: "The nickel ran with the slot's motion and both safeties held: 2-Man." },
        { id: "rbshift", label: "Shift the back to the right", detail: "RB moves to the other side of the quarterback.",
          path: { from: "RB", to: [28.5, -5] },
          moves: { WILL: [27.6, 4.5] },
          text: "The Will slid with the back: he has the back in man.",
          clue: "The Will slid with the back: man." }
      ],
      protections: [
        { id: "five", label: "Five-man protection, the back runs a route", detail: "Five block four; the back releases.",
          hold: 3.0, grade: 92, category: "recommended", hotPlan: true,
          why: "Four rush against five blockers, and the back's route gives the Will someone to cover, so he can't rush or spy.",
          assignments: [{ player: "QB", assignment: "If a linebacker comes, ball out", key: "WILL", win: "Ball out on time", fail: "Holds it", p: 0.9 }] },
        { id: "six", label: "Six-man: the back stays in", detail: "The back blocks; the Will is free to spy or rush.",
          hold: 3.4, grade: 80, category: "valid",
          why: "Safe, but it frees the Will to spy the quarterback, which takes away the scramble that 2-Man gives you.",
          assignments: [{ player: "RB", assignment: "Block whoever comes", key: "WILL", win: "Picks up a blitzer", fail: "Blocks nobody", p: 0.9 }] },
        { id: "max", label: "Max protection: back and tight end stay in", detail: "Seven block; three go out.",
          hold: 3.8, grade: 55, category: "safe",
          why: "Three receivers against five man defenders and two safeties on third-and-9: every route is doubled.",
          assignments: [{ player: "Y", assignment: "Block the right end", key: "DER", win: "Walls him off", fail: "Gets beat", p: 0.9 }] }
      ],
      plays: [
        { id: "mesh", concept: "mesh", label: "Mesh with a corner route",
          detail: "H and Y cross at 6 yards, rubbing their man defenders; Z runs a corner route, X a go.",
          need: 2.3, window: 0.62, yards: 10, spread: 4, intRisk: 0.03, luck: 0.04,
          hot: { window: 0.5, yards: 6, spread: 2, text: "Ball out early to the first crosser" },
          grade: 95, category: "recommended", conflict: "MIKE",
          why: "Man defenders with inside leverage have to fight through traffic on crossers, and the safeties are too deep to help underneath. The crosser who comes free runs away from his defender toward the sticks.",
          key: { answer: "MIKE", partial: { NB: "He's trailing H; the Mike, trailing the tight end through the rub, is usually the one who gets caught." } },
          routes: [{ from: "H", path: [[17, 1], [26, 6], [36, 6.5]] }, { from: "Y", path: [[36, 1], [26, 6.5], [16, 7]] }, { from: "Z", path: [[45, 10], [49, 16]] }, { from: "X", path: [[8, 18]] }],
          assignments: [
            { player: "QB", assignment: "Find the crosser who comes free of the rub, lead him past the sticks", key: "MIKE", win: "Hits him in stride", fail: "Throws behind him", p: 0.84, keyBonus: 0.08, critical: true },
            { player: "Y", assignment: "Cross tight to H to rub the Mike", key: "MIKE", win: "The Mike gets caught in traffic", fail: "Runs too deep for a rub", p: 0.78, critical: true }
          ] },
        { id: "draw", concept: "draw", label: "Quarterback draw",
          detail: "Show pass, then the quarterback runs it up the middle.",
          kind: "run", need: 0, window: 0.36, yards: 11, spread: 4, failYards: 3, failSpread: 2, luck: 0.06,
          grade: 82, category: "high-floor", conflict: "WILL",
          why: "In 2-Man every underneath defender has his back to the quarterback. If the back releases and pulls the Will away, there's no one left in the middle.",
          key: { answer: "WILL", partial: {} },
          routes: [{ from: "QB", path: [[26.6, -3], [26.6, 4], [26.6, 10]] }],
          assignments: [
            { player: "C", assignment: "Let the nose upfield, then seal him", key: "NT", win: "Opens the A-gap", fail: "Gets driven back", p: 0.8, critical: true },
            { player: "QB", assignment: "Sell the pass, then go when the Will turns", key: "WILL", win: "Gets past the linebacker level", fail: "The Will spied him", p: 0.75, critical: true }
          ] },
        { id: "quick", concept: "quick", label: "Slant-flat",
          detail: "Quick throws to the outside receivers.",
          need: 1.4, window: 0.55, yards: 6, spread: 3, intRisk: 0.04, luck: 0.03,
          hot: { window: 0.5, yards: 5, spread: 2, text: "Ball out early" },
          grade: 60, category: "conservative", conflict: "CBL",
          why: "Completions, mostly short of the sticks. Inside leverage sits right on the slant, and a 5-yard gain on third-and-9 is a punt.",
          key: { answer: "CBL", partial: {} },
          routes: [{ from: "X", path: [[8, 1.5], [11, 5]] }, { from: "H", path: [[19, 2]] }],
          assignments: [
            { player: "QB", assignment: "Throw on the third step", key: "CBL", win: "Ball out on time", fail: "Late into inside leverage", p: 0.9, critical: true },
            { player: "X", assignment: "Win inside against inside leverage", key: "CBL", win: "Gets across his face", fail: "The corner sits on it", p: 0.6, critical: true }
          ] },
        { id: "verts", concept: "verts", label: "Four verticals",
          detail: "Four go deep.",
          need: 2.9, window: 0.28, yards: 24, spread: 8, intRisk: 0.12, luck: 0.06,
          grade: 40, category: "poor", conflict: "FS",
          why: "Every vertical route is bracketed: a man defender trailing underneath, a safety on top. 2-Man is built to stop exactly this.",
          key: { answer: "FS", partial: {} },
          routes: [{ from: "X", path: [[8, 18]] }, { from: "H", path: [[17, 18]] }, { from: "Y", path: [[36, 18]] }, { from: "Z", path: [[45, 18]] }],
          assignments: [
            { player: "QB", assignment: "Find a seam between the safeties", key: "FS", win: "A safety guesses wrong", fail: "Throws into a bracket", p: 0.6, keyBonus: 0.05, critical: true },
            { player: "H", assignment: "Seam against trail technique", key: "NB", win: "Gets separation", fail: "Bracketed", p: 0.6, critical: true }
          ] }
      ],
      contingencies: [
        { id: "built-in", label: "Built-in hot: if a rusher comes free, ball out to the quick route now", onPressure: "hot",
          grades: { mesh: 92, draw: 75, quick: 85, verts: 40 },
          why: "The first mesh crosser is the hot answer." },
        { id: "sight", label: "Sight adjust: the slot converts to a slant against pressure", onPressure: "sight",
          throw: { window: 0.35, yards: 6, spread: 3, intRisk: 0.1, text: "Sight-adjusted slant" },
          grades: { mesh: 60, draw: 55, quick: 65, verts: 60 },
          why: "Against inside leverage, a converted slant runs into the defender." },
        { id: "throwaway", label: "If the window closes, climb and throw it away", onPressure: "throwaway",
          grades: { mesh: 70, draw: 65, quick: 70, verts: 75 },
          why: "Against 2-Man the better answer is often to run: the middle is empty." },
        { id: "none", label: "Hold it: trust the protection", onPressure: "none",
          grades: { mesh: 50, draw: 70, quick: 45, verts: 40 },
          why: "Against four rushers, holding it a beat is survivable. Scrambling is better." }
      ],
      interactions: [
        { when: { protection: "max", play: "mesh" }, window: -0.35, play: -25, note: "Max protection keeps Y in, and he's one of the two crossers." },
        { when: { protection: "six", play: "draw" }, window: -0.12, play: -10, note: "Keeping the back in to block lets the Will stay home and spy the quarterback, which is what kills the draw." },
        { when: { protection: "five", play: "draw" }, note: "The back's route takes the Will out of the middle: the draw needs exactly that." }
      ],
      recommended: { motion: "yoyo", protection: "five", play: "mesh", contingency: "built-in" },
      fit: { downs: [3, 4], distance: [7, 15], coverage: ["2_MAN"], rushers: [3, 5] },
      clues: [
        { text: "Two safeties wide at 14 with every underneath defender pressed: the 2-Man look.", kind: "meaningful" },
        { text: "Inside leverage on every receiver: they're taking away slants and digs.", kind: "meaningful" },
        { text: "Third-and-9: defenses trust coverage and rush four.", kind: "meaningful" },
        { text: "The linebacker over the back might spy the quarterback instead of covering.", kind: "uncertain" }
      ],
      next: "Once crossers and the quarterback's legs hurt 2-Man, expect a robber: a safety or linebacker sitting in the middle at 8 yards, taking away the crossing lane and the draw.",
      takeaway: "2-Man brackets everything vertical and turns every back to the quarterback. Beat it underneath with crossers that rub trailing defenders, and with the quarterback's legs.",
      learning: { objectives: ["Recognize 2-Man", "Attack trailing man coverage", "Use the quarterback's legs when backs are turned"], tags: ["man-vs-zone", "situational"], misconceptions: ["Third and long needs a deep shot"], difficulty: 3, transfer: ["Cover 1 to 2-Man"], revisitDays: 3 }
    },

    {
      id: "count-box-1st-10",
      title: "Count the Box",
      module: "nickel-pressure",
      order: 9,
      type: "synthetic",
      status: "published",
      version: 1,
      provenance: {
        type: "synthetic",
        label: "Synthetic teaching scenario. Not a real NFL play: the game, teams and result are invented to teach one principle.",
        sources: [],
        fieldConfidence: { all: "synthetic" },
        reviewer: "unreviewed",
        notes: "Heavy personnel invites a loaded box; a loaded box invites play action."
      },
      context: {
        quarter: 1, clock: "11:20", score: { you: 0, opp: 3 },
        down: 1, distance: 10, yardLine: 40, side: "own", hash: "middle",
        objective: "Stay on schedule: 4 yards is a win, and a chunk play is better.",
        scouting: "Against two tight ends this defense stays in base and brings the strong safety into the box."
      },
      offense: {
        personnel: "12",
        personnelText: "12 personnel: 1 back, 2 tight ends, 2 receivers",
        formation: "Under center, tight ends attached on both sides, back at 7 yards",
        players: [
          { id: "X", label: "X", role: "Receiver, wide left", x: 9, y: -1 },
          { id: "U", label: "U", role: "Tight end, attached left", x: 22.75, y: -1 },
          { id: "LT", label: "LT", role: "Left tackle", x: 24.05, y: -1 },
          { id: "LG", label: "LG", role: "Left guard", x: 25.35, y: -1 },
          { id: "C", label: "C", role: "Center", x: 26.65, y: -1 },
          { id: "RG", label: "RG", role: "Right guard", x: 27.95, y: -1 },
          { id: "RT", label: "RT", role: "Right tackle", x: 29.25, y: -1 },
          { id: "Y", label: "Y", role: "Tight end, attached right", x: 30.55, y: -1 },
          { id: "QB", label: "QB", role: "Quarterback (under center)", x: 26.65, y: -1.8 },
          { id: "RB", label: "RB", role: "Running back", x: 26.65, y: -7 },
          { id: "Z", label: "Z", role: "Receiver, wide right", x: 44, y: -1 }
        ]
      },
      defense: {
        personnel: "base",
        personnelText: "Base: 4 linemen, 3 linebackers, 4 defensive backs",
        front: "Four-down over front",
        shell: "one-high",
        boxCount: 8,
        disguise: "low",
        players: [
          { id: "CBL", label: "LCB", role: "Left cornerback", x: 9, y: 7 },
          { id: "SAM", label: "S", role: "Sam linebacker, over the left tight end", x: 21.5, y: 4 },
          { id: "DEL", label: "E", role: "Left end", x: 23.4, y: 1 },
          { id: "DT", label: "T", role: "Defensive tackle", x: 25.4, y: 1 },
          { id: "WILL", label: "W", role: "Will linebacker", x: 25, y: 4.5 },
          { id: "NT", label: "N", role: "Nose tackle", x: 27.5, y: 1 },
          { id: "FS", label: "FS", role: "Free safety, deep middle", x: 26.65, y: 13 },
          { id: "MIKE", label: "M", role: "Mike linebacker", x: 28.4, y: 4.5 },
          { id: "DER", label: "E", role: "Right end", x: 30.2, y: 1 },
          { id: "SS", label: "SS", role: "Strong safety, down in the box", x: 32.5, y: 6 },
          { id: "CBR", label: "RCB", role: "Right cornerback", x: 44, y: 7 }
        ]
      },
      actual: {
        call: "gen-cover-3",
        pressure: "four",
        rushers: ["DEL", "DT", "NT", "DER"],
        droppers: ["CBL", "SAM", "WILL", "FS", "MIKE", "SS", "CBR"],
        coverage: "Cover 3 with eight in the box",
        rotation: "The strong safety is already down; the free safety stays deep in the middle. On a run fake, the linebackers and the strong safety step up first.",
        post: {
          CBL: { x: 10, y: 15, zone: "Deep third" },
          SAM: { x: 20, y: 5, zone: "Curl-flat" },
          DEL: { x: 24, y: -2.5 },
          DT: { x: 25.6, y: -2.5 },
          WILL: { x: 24.5, y: 3, zone: "Hook (stepped up on the fake)" },
          NT: { x: 27.4, y: -2.5 },
          FS: { x: 26.65, y: 17, zone: "Deep middle third" },
          MIKE: { x: 28.5, y: 3, zone: "Hook (stepped up on the fake)" },
          DER: { x: 29.5, y: -2.5 },
          SS: { x: 33, y: 4, zone: "Curl-flat (stepped up on the fake)" },
          CBR: { x: 43, y: 15, zone: "Deep third" }
        },
        events: [
          { t: 0.4, text: "The run fake. The linebackers and the strong safety step up to fill their gaps." },
          { t: 1.2, text: "Behind them, the space between the hook defenders and the deep thirds is empty." },
          { t: 2.0, text: "The free safety alone in the middle has to choose between the post and the crossing route." }
        ]
      },
      diagnosis: {
        questions: [
          { id: "personnel", prompt: "What defensive personnel is on the field?", kind: "single",
            options: [{ id: "base", label: "Base (4 DBs)" }, { id: "nickel", label: "Nickel (5 DBs)" }, { id: "dime", label: "Dime (6 DBs)" }],
            credit: { base: 100, nickel: 30, dime: 0 }, error: "personnel",
            explain: "Two corners, two safeties, three linebackers: base, the standard answer to two tight ends." },
          { id: "shell", prompt: "What safety shell is the defense showing?", kind: "single",
            options: [{ id: "two", label: "Two-high" }, { id: "one", label: "One-high" }, { id: "zero", label: "Zero (no deep safety)" }],
            credit: { two: 0, one: 100, zero: 40 }, error: "shell",
            explain: "One safety deep in the middle, the other down in the box at 6 yards: one-high." },
          { id: "rushers", prompt: "Tap every defender who could rush.", kind: "rushers",
            answer: ["DEL", "DT", "NT", "DER", "SAM", "WILL", "MIKE", "SS"], critical: "SS", error: "pressure-count",
            explain: "Eight in the box: four linemen, three linebackers and the strong safety. That's one more than your seven run blockers." },
          { id: "pressure", prompt: "What's the most likely pressure if you throw?", kind: "single",
            options: [{ id: "four", label: "Four-man rush" }, { id: "five", label: "Five-man pressure" }, { id: "six", label: "Six or more (Cover 0)" }],
            credit: { four: 100, five: 70, six: 30 }, error: "pressure-count",
            explain: "The eighth man in the box is there for the run. On first down, most of these looks rush four and play Cover 3." }
        ]
      },
      motions: [
        { id: "none", label: "No motion", text: "Snap it." },
        { id: "zmotion", label: "Motion Z in tight to the formation", detail: "Z comes in to a tight split.",
          path: { from: "Z", to: [36, -1.8] },
          moves: { CBR: [37, 6], SS: [32, 5.5] },
          text: "The right corner came down with Z and the strong safety stayed in the box: they're committed to stopping the run with eight. One deep safety.",
          clue: "On Z's motion the corner followed and the strong safety stayed down: eight in the box, one deep." }
      ],
      protections: [
        { id: "max", label: "Max protection off play action: both tight ends and the back stay in", detail: "Eight block; the receivers run the shot.",
          hold: 3.6, grade: 88, category: "recommended",
          why: "Play-action shots against eight-man boxes are where max protection earns its keep: everyone they can bring is blocked while the fake pulls the second level forward.",
          assignments: [{ player: "Y", assignment: "Sell the run block, then hold the end", key: "DER", win: "Holds him for three seconds", fail: "Releases too early", p: 0.9 }] },
        { id: "six", label: "Six-man: one tight end releases", detail: "U releases on a crossing route; Y and the back stay in.",
          hold: 3.0, grade: 92, category: "recommended",
          why: "The fake buys time, and a crossing tight end gives the quarterback a second option under the post.",
          assignments: [{ player: "RB", assignment: "Carry out the fake, then block the first linebacker", key: "MIKE", win: "Picks up a blitzer after the fake", fail: "Fakes too long", p: 0.88 }] },
        { id: "five", label: "Five-man: everyone else runs a route", detail: "The line blocks alone.",
          hold: 2.0, grade: 60, category: "risky",
          why: "Eight in the box against five blockers: any linebacker who doesn't bite on the fake is free.",
          assignments: [{ player: "QB", assignment: "Get the ball out before a free rusher", key: "MIKE", win: "Ball out on time", fail: "The Mike didn't bite and gets home", p: 0.7 }] }
      ],
      plays: [
        { id: "pa-shot", concept: "pa-shot", label: "Play-action post",
          detail: "Fake the handoff; Z runs a post behind the linebackers, U crosses underneath.",
          need: 2.8, window: 0.62, yards: 24, spread: 9, intRisk: 0.06, luck: 0.06,
          grade: 95, category: "recommended", conflict: "FS",
          why: "Eight in the box means the linebackers and the strong safety are reading run. The fake pulls them forward, and the free safety is alone in the middle with a post and a crosser to cover.",
          key: { answer: "FS", partial: { MIKE: "He's the one the fake has to move; the free safety decides where the ball goes." } },
          routes: [{ from: "Z", path: [[44, 10], [36, 19]] }, { from: "U", path: [[22.75, 1], [30, 8], [40, 10]] }],
          assignments: [
            { player: "QB", assignment: "Sell the fake, then read the free safety: post if he jumps the crosser, crosser if he stays", key: "FS", win: "Throws away from the safety", fail: "Throws the post into the safety", p: 0.84, keyBonus: 0.08, critical: true },
            { player: "RB", assignment: "Sell the fake like it's a real run", key: "MIKE", win: "The linebackers step up", fail: "Nobody bites", p: 0.85, critical: true }
          ] },
        { id: "quick", concept: "quick", label: "Quick game outside",
          detail: "Slant-flat to the receivers, away from the box.",
          need: 1.4, window: 0.62, yards: 6, spread: 3, intRisk: 0.03, luck: 0.03,
          hot: { window: 0.55, yards: 5, spread: 2, text: "Ball out early" },
          grade: 82, category: "high-floor", conflict: "SAM",
          why: "With eight in the box, there's space outside. A quick throw to the receivers gets 5 or 6 reliably; it just doesn't use the box against them.",
          key: { answer: "SAM", partial: {} },
          routes: [{ from: "X", path: [[9, 1.5], [13, 5]] }, { from: "U", path: [[23, 1], [17, 2]] }],
          assignments: [
            { player: "QB", assignment: "Quick read of the curl-flat defender", key: "SAM", win: "Throws away from him", fail: "Throws into him", p: 0.86, keyBonus: 0.06, critical: true },
            { player: "X", assignment: "Slant inside the corner", key: "CBL", win: "Wins inside", fail: "The corner jumps it", p: 0.82, critical: true }
          ] },
        { id: "outside-zone", concept: "outside-zone", label: "Outside zone",
          detail: "Stretch it to the right and look for a cutback.", kind: "run",
          need: 0, window: 0.42, yards: 6, spread: 4, failYards: 1, failSpread: 2, luck: 0.04,
          grade: 70, category: "valid", conflict: "SS",
          why: "Stretching an eight-man box can find a cutback lane if the pursuit overflows, but the strong safety down in the box is a free hitter on the edge.",
          key: { answer: "SS", partial: {} },
          routes: [{ from: "RB", path: [[28, -6], [34, -1], [35, 5]] }],
          assignments: [
            { player: "Y", assignment: "Reach the right end", key: "DER", win: "Seals the edge", fail: "Gets beat across his face", p: 0.75, critical: true },
            { player: "RB", assignment: "Press the edge, cut back if it overflows", key: "SS", win: "Finds the cutback", fail: "The safety fills the edge", p: 0.75, critical: true }
          ] },
        { id: "inside-zone", concept: "inside-zone", label: "Inside zone",
          detail: "Run it right at the eight-man box.", kind: "run",
          need: 0, window: 0.38, yards: 5, spread: 3, failYards: 1, failSpread: 2, luck: 0.04,
          grade: 62, category: "poor", conflict: "SS",
          why: "Eight in the box against seven blockers: they have one more defender than you can block, and he's the strong safety, coming downhill untouched.",
          key: { answer: "SS", partial: { MIKE: "He's blocked on a double team; the unblocked strong safety makes the tackle." } },
          routes: [{ from: "RB", path: [[26.6, -5], [26, 1], [25.5, 6]] }],
          assignments: [
            { player: "LG", assignment: "Combo up to the Will", key: "WILL", win: "Seals him", fail: "Comes off late", p: 0.78, critical: true },
            { player: "RB", assignment: "Find a crease before the safety fills it", key: "SS", win: "Beats the safety to the hole", fail: "The unblocked safety fills it", p: 0.65, critical: true }
          ] }
      ],
      contingencies: [
        { id: "built-in", label: "Built-in hot: if a rusher comes free, ball out to the quick route now", onPressure: "hot",
          grades: { "pa-shot": 60, quick: 95, "outside-zone": 75, "inside-zone": 75 },
          why: "Play action has a built-in outlet in the crossing tight end; the quick game is its own answer." },
        { id: "sight", label: "Sight adjust: a receiver converts to a slant against pressure", onPressure: "sight",
          throw: { window: 0.45, yards: 7, spread: 3, intRisk: 0.08, text: "Sight-adjusted slant" },
          grades: { "pa-shot": 65, quick: 80, "outside-zone": 65, "inside-zone": 65 },
          why: "Reasonable against a surprise blitz." },
        { id: "throwaway", label: "If the window closes, climb and throw it away", onPressure: "throwaway",
          grades: { "pa-shot": 85, quick: 75, "outside-zone": 65, "inside-zone": 65 },
          why: "First down: an incompletion still leaves second-and-10. Never take the sack off play action." },
        { id: "none", label: "Hold it: trust the protection", onPressure: "none",
          grades: { "pa-shot": 55, quick: 45, "outside-zone": 70, "inside-zone": 70 },
          why: "With max protection, holding it a beat for the post is part of the play." }
      ],
      interactions: [
        { when: { protection: "five", play: "pa-shot" }, protection: -30, window: -0.15, note: "Five blockers on a three-second play-action shot against eight in the box: someone who didn't bite gets home." },
        { when: { protection: "max", play: "quick" }, window: -0.2, play: -10, note: "Max protection keeps your tight ends in; the quick game only has two receivers." },
        { when: { play: "inside-zone" }, note: "On a run the protection call doesn't matter: the line is run blocking." },
        { when: { play: "outside-zone" }, note: "On a run the protection call doesn't matter: the line is run blocking." }
      ],
      recommended: { motion: "zmotion", protection: "six", play: "pa-shot", contingency: "throwaway" },
      fit: { downs: [1], distance: [10, 10], offPers: ["12", "13", "21", "22"], pkg: ["base", "heavy"], box: [8, 11], kinds: ["run", "pass"] },
      clues: [
        { text: "Eight in the box against seven run blockers: they've outnumbered your run game.", kind: "meaningful" },
        { text: "One deep safety: the middle of the field behind the linebackers has one defender.", kind: "meaningful" },
        { text: "The strong safety at 6 yards is a run defender first. He'll step up on a fake.", kind: "meaningful" },
        { text: "Whether the linebackers bite on the fake: you find out after the snap.", kind: "uncertain" }
      ],
      next: "Hit play action over an eight-man box and they'll pull the strong safety back to two-high. Then the box is seven against your seven blockers, and the run is back on.",
      takeaway: "Count the box before you call a run. When they've put one more defender in it than you can block, use it against them: play action pulls those defenders forward and throws behind them.",
      learning: { objectives: ["Count box defenders against run blockers", "Use play action against a loaded box", "Match heavy personnel to the defense it invites"], tags: ["run-vs-box", "situational"], misconceptions: ["Heavy personnel means run"], difficulty: 2, transfer: ["11 personnel to 12 personnel"], revisitDays: 3 }
    }
  ],

  /* Defense-side lessons: you're the defensive coordinator. Each one is a synthetic snap with
     hand-written teaching for every option; the grades come from defense.js and the fitted model,
     and a test checks that each lesson's best call agrees with the model. */
  defenseLessons: [
    {
      id: "def-personnel",
      title: "Match the Personnel",
      order: 1,
      provenance: { type: "synthetic", label: "Synthetic teaching scenario. Not a real NFL play: the game, teams and result are invented to teach one principle.", sources: [], fieldConfidence: { all: "synthetic" } },
      snap: { down: 1, dist: 10, yl100: 65, situation: "first-ten", offPers: "12", wrs: 2, ol: 5, fb: 0, formation: "Under Center", kind: "run", runGap: "end", runLoc: "right", qtr: 1, clock: "13:05", offScore: 0, defScore: 0, box: 7,
        desc: "Outside zone to the right, toward the second tight end. The back presses the edge and cuts up." },
      context: { objective: "Win first down: hold them under 4 yards.", scouting: "Two tight ends, under center, back at 7 yards: from this look offenses run it about 60% of the time." },
      read: {
        pers: "One back, two tight ends: 12 personnel. Two tight ends means two more run blockers and two receivers who can block or release.",
        likely: "From 12 personnel on first and 10, offenses run it about 6 times in 10. Under center makes the run even likelier."
      },
      why: {
        pkg: {
          heavy: "Goal-line bodies on first and 10: strong against the run, but a linebacker ends up on a receiver if they throw.",
          base: "The textbook match: three linebackers for two tight ends, seven in the box against their seven blockers.",
          nickel: "A defensive back in place of a linebacker: fine in coverage, but the box goes light against a run-heavy look.",
          dime: "Two extra DBs against two tight ends: you're daring them to run, and from this look they will."
        },
        pressure: {
          four: "Rush four and fit the run with everyone else. Sound on a down where they can do anything.",
          sim: "Simulated pressure is a passing-down tool; against a likely run it just moves a run fitter out of his gap.",
          fire: "A five-man zone pressure can blow up a run, or leave a gap open if the blitzer guesses wrong.",
          man5: "Five-man man pressure adds a run fitter at the line, but gives up a free safety's help if they throw.",
          zero: "Zero on first and 10 is a coin flip: a tackle for loss or a touchdown."
        },
        cov: {
          zero: "Nobody deep: any run that gets past the line goes the distance.",
          man: "Cover 1 rolls a safety into the box: an eighth run defender, with the free safety still deep.",
          twoMan: "Two deep safeties take two run fitters out of the box.",
          two: "Two deep halves: the safeties are 12 yards from the run.",
          three: "Cover 3 rolls a safety down like Cover 1, but in zone: sound against both run and play action.",
          quarters: "Quarters safeties fit the run fast from depth; a good answer if your safeties can tackle."
        },
        area: {
          run: "They run it 6 times in 10 here. Take that away first.",
          quick: "Quick throws are their second choice from this look.",
          middle: "Play action to a tight end over the middle is their best counter to an eight-man front.",
          deep: "A deep shot is rare from this look, but it's what play action is for."
        }
      },
      best: { pkg: "base", pressure: "four", cov: "man", area: "run" },
      clues: [
        { text: "Two tight ends and a back at 7 yards, under center: a run look.", kind: "meaningful" },
        { text: "First and 10: they can run or throw. Nothing about the down forces their hand.", kind: "uncertain" },
        { text: "The second tight end lined up like a blocker. He can release on play action.", kind: "deceptive" }
      ],
      next: "Stop the run with base and they'll go to play action from the same look. Your strong safety and Sam linebacker have to read run before they fill.",
      takeaway: "Match personnel first. Two tight ends get base: three linebackers for their blockers and a box that can fit the run without guessing. Every package grades close here, which is the point: matching is a small, steady edge.",
      learning: { tags: ["dc-personnel", "dc-situational"] },
      fit: { downs: [1], distance: [10, 10], offPers: ["12", "13"], pkg: ["heavy", "base", "nickel", "dime", "quarter"], kinds: ["run", "pass"] }
    },

    {
      id: "def-sticks",
      title: "Play the Sticks",
      order: 2,
      provenance: { type: "synthetic", label: "Synthetic teaching scenario. Not a real NFL play: the game, teams and result are invented to teach one principle.", sources: [], fieldConfidence: { all: "synthetic" } },
      snap: { down: 3, dist: 9, yl100: 58, situation: "third-long", offPers: "11", wrs: 3, ol: 5, fb: 0, formation: "Shotgun", kind: "pass", route: "In/Dig", airYards: 7, qtr: 2, clock: "6:41", offScore: 10, defScore: 7, box: 6, rushers: 4,
        desc: "A dig at 7 yards, two short of the sticks, and the receiver tries to turn it upfield." },
      context: { objective: "Get off the field: stop them short of the line to gain.", scouting: "On third and long, 11 personnel throws it more than 9 times in 10, mostly quick and intermediate routes." },
      read: {
        pers: "One back, one tight end, three receivers: 11 personnel, in shotgun.",
        likely: "Third and 9: they're throwing. Quick throws and intermediate routes are almost evenly split; runs and screens are rare."
      },
      why: {
        pkg: {
          heavy: "Goal-line bodies on third and 9: linebackers covering receivers. The worst match on the board.",
          base: "Three linebackers against three receivers: someone slow is covering someone fast.",
          nickel: "Five DBs for three receivers and a tight end: coverage without giving up the scramble lane.",
          dime: "Six DBs is fine on paper, but you lose a linebacker to spy the quarterback and tackle the dig."
        },
        pressure: {
          four: "Rush four, drop seven: sound, and nearly as good as the best call here.",
          sim: "Four rush, but a linebacker comes and a lineman drops: the protection guesses wrong without you losing a coverage defender.",
          fire: "Five rush with three deep: more pressure, one fewer defender where the throw goes.",
          man5: "Five-man man pressure: more heat, but one-on-one routes break at the sticks.",
          zero: "Zero on third and 9: one missed tackle and it's a touchdown. Expected points say it's one of the worst calls here."
        },
        cov: {
          zero: "Nobody deep on third and long: a missed tackle is six points.",
          man: "Cover 1: tight coverage at the sticks with a free safety on top. Close behind quarters.",
          twoMan: "2-Man brackets deep routes, but trailing defenders can't rally to a short catch.",
          two: "Cover 2 rallies well underneath, but the seams split the safeties.",
          three: "Cover 3 sits at the sticks with four underneath. Solid.",
          quarters: "Quarters keeps four deep and sits on routes at the sticks: everything in front, then rally and tackle."
        },
        area: {
          run: "They run it less than 1 time in 10 here.",
          quick: "Quick throws are their most common call: take away the short completion that can break a tackle to the sticks.",
          middle: "Digs and crossers are nearly as likely. A close second choice.",
          deep: "Deep shots are their third choice; quarters already protects you there."
        }
      },
      best: { pkg: "nickel", pressure: "sim", cov: "quarters", area: "quick" },
      clues: [
        { text: "Third and 9: they need nine, so anything short of that is your win.", kind: "meaningful" },
        { text: "Three receivers in shotgun: a passing look on a passing down.", kind: "meaningful" },
        { text: "A dig breaking at 7 yards looks dangerous. Tackled where it's caught, it's a punt.", kind: "deceptive" }
      ],
      next: "When the dig short of the sticks stops working for them, they'll run it at 10 yards. Your hook defenders have to carry the depth of the sticks.",
      takeaway: "On third and long you're playing the sticks, not the ball. Rush four (or simulate more), keep everything in front, and tackle the catch short of the line. A zero blitz trades a likely stop for a chance at a touchdown.",
      learning: { tags: ["dc-coverage", "dc-situational"] },
      fit: { downs: [3], distance: [8, 15], offPers: ["11"], pkg: ["heavy", "base", "nickel", "dime", "quarter"], kinds: ["pass", "run"] }
    },

    {
      id: "def-empty",
      title: "Empty Set",
      order: 3,
      provenance: { type: "synthetic", label: "Synthetic teaching scenario. Not a real NFL play: the game, teams and result are invented to teach one principle.", sources: [], fieldConfidence: { all: "synthetic" } },
      snap: { down: 3, dist: 6, yl100: 45, situation: "third-medium", offPers: "01", wrs: 4, ol: 5, fb: 0, formation: "Shotgun", kind: "pass", route: "Slant", airYards: 4, qtr: 3, clock: "9:12", offScore: 14, defScore: 17, box: 5, rushers: 4,
        desc: "Five receivers out, nobody in the backfield. A quick slant on the third step." },
      context: { objective: "Get off the field on third and 6.", scouting: "Empty sets on third down throw quick more than 6 times in 10: the ball is out before pressure arrives." },
      read: {
        pers: "No backs, one tight end, four receivers: 01 personnel, an empty set.",
        likely: "Empty on third and 6 is a quick-game look: about 6 in 10 are quick throws. With nobody in the backfield, a run is almost off the table."
      },
      why: {
        pkg: {
          heavy: "Goal-line bodies against five receivers: two or three of them get linebackers. The worst match on the board.",
          base: "Four DBs for five receivers: at least one linebacker covers a receiver.",
          nickel: "Five DBs for five receivers, but no help: a linebacker still covers somebody.",
          dime: "Six DBs against five receivers: everyone is covered by a defensive back."
        },
        pressure: {
          four: "Rush four. Empty means five blockers for four rushers and a quick throw; win in coverage, not the backfield.",
          sim: "Simulated pressure can confuse an empty protection, but the ball is out in 1.5 seconds.",
          fire: "Five rush against five blockers: even, and the quick throw beats it.",
          man5: "Five-man man pressure: one-on-ones everywhere with a single free safety.",
          zero: "Zero against empty: five receivers, five man defenders, nobody deep, and the ball is out before your sixth rusher arrives."
        },
        cov: {
          zero: "Man with no help against five receivers: one missed tackle and it's six.",
          man: "Cover 1 can work if your DBs win their matchups; the free safety only helps on the deep ball.",
          twoMan: "2-Man: tight man underneath on every receiver, two safeties over the top. Built for quick throws on passing downs.",
          two: "Cover 2 zones give the quick game soft spots between five underneath defenders.",
          three: "Cover 3 sits underneath, but four receivers flood three underneath zones.",
          quarters: "Quarters is soft underneath, exactly where empty attacks."
        },
        area: {
          run: "No back: a run is a quarterback draw or nothing.",
          quick: "Quick throws are what empty is for: take them away.",
          middle: "Intermediate routes are their second choice.",
          deep: "Deep shots happen, but your safeties are there."
        }
      },
      best: { pkg: "dime", pressure: "four", cov: "twoMan", area: "quick" },
      clues: [
        { text: "Nobody in the backfield: the quarterback has five receivers and five blockers.", kind: "meaningful" },
        { text: "Empty usually means the ball comes out fast.", kind: "meaningful" },
        { text: "Five-man protection looks easy to beat with six. The ball is gone first.", kind: "deceptive" }
      ],
      next: "Take away the quick game against empty and they'll run a quarterback draw: every defender's back is turned in 2-Man. Keep a linebacker or the dime on the quarterback.",
      takeaway: "Empty spreads five receivers and gets the ball out fast. Match it with DBs, cover tight underneath with help over the top, and don't blitz into a throw that's out in a second and a half.",
      learning: { tags: ["dc-personnel", "dc-coverage"] },
      fit: { downs: [3], distance: [3, 8], offPers: ["01", "02", "00"], pkg: ["heavy", "base", "nickel", "dime", "quarter"], kinds: ["pass", "run"] }
    },

    {
      id: "def-goalline",
      title: "Goal Line Stand",
      order: 4,
      provenance: { type: "synthetic", label: "Synthetic teaching scenario. Not a real NFL play: the game, teams and result are invented to teach one principle.", sources: [], fieldConfidence: { all: "synthetic" } },
      snap: { down: 3, dist: 2, yl100: 2, situation: "goal-line", offPers: "22", wrs: 1, ol: 5, fb: 1, formation: "Under Center", kind: "pass", route: "Shallow Cross/Drag", airYards: 1, playAction: true, qtr: 4, clock: "7:30", offScore: 13, defScore: 17, box: 9, rushers: 4,
        desc: "Play action: fake the dive, then the tight end leaks across the formation behind the linebackers." },
      context: { objective: "Hold them out of the end zone. A field goal still leaves you ahead.", scouting: "From 22 personnel at the goal line, offenses run it about 3 times in 4. Their counter is play action to a tight end." },
      read: {
        pers: "Two backs, two tight ends, one receiver: 22 personnel, the heaviest look in football.",
        likely: "At the 2 with 22 personnel, about 3 in 4 are runs. The quick throw off play action is the counter."
      },
      why: {
        pkg: {
          heavy: "Goal-line personnel: bodies in every gap against their extra blockers.",
          base: "Base gives up a gap to their seven blockers and fullback.",
          nickel: "A nickel at the goal line: a light box against the heaviest personnel there is.",
          dime: "Dime at the 2 against 22 personnel: the worst match on the board."
        },
        pressure: {
          four: "Rush four and fit the rest: sound, a step behind man pressure.",
          sim: "Simulated pressure at the goal line moves a gap defender out of his gap.",
          fire: "A zone pressure leaves zone defenders reading the tight end leak late.",
          man5: "Five-man man pressure: attack the run with an extra fitter, and every receiver, including the leaking tight end, has a man on him.",
          zero: "Zero at the goal line: if anyone slips, it's a walk-in."
        },
        cov: {
          zero: "All-out man with nobody behind it.",
          man: "Cover 1 man: the leaking tight end has a defender on him, with a free player in the middle.",
          twoMan: "Two deep safeties at the 2 yard line take two defenders out of the fight.",
          two: "Cover 2 zones: the leaking tight end runs between zones.",
          three: "Cover 3 zones are compressed but leave the tight end to whoever's zone he enters.",
          quarters: "Quarters at the goal line: safeties too deep to help."
        },
        area: {
          run: "They run it 3 times in 4 here: stop it first.",
          quick: "The quick throw off play action is their counter; man coverage handles it.",
          middle: "The tight end leak across the middle: the one you have to remember after the fake.",
          deep: "There is no deep at the 2 yard line."
        }
      },
      best: { pkg: "heavy", pressure: "man5", cov: "man", area: "run" },
      clues: [
        { text: "Two backs and two tight ends at the 2: a run look with eight blockers.", kind: "meaningful" },
        { text: "Third and 2 at the goal line: they can run it twice to score.", kind: "uncertain" },
        { text: "The second tight end lined up to block. He leaked out on play action.", kind: "deceptive" }
      ],
      next: "Stuff the run at the goal line and the next call is play action to the tight end. In man, his defender can't bite on the fake.",
      takeaway: "At the goal line, match bodies with bodies and play man: an extra run fitter for the run, and a defender on every receiver for the play-action leak.",
      learning: { tags: ["dc-personnel", "dc-situational"] },
      fit: { downs: [2, 3, 4], distance: [1, 3], yl: [1, 5], offPers: ["22", "13", "23", "12", "21"], pkg: ["heavy", "base", "nickel", "dime", "quarter"], kinds: ["run", "pass"] }
    },

    {
      id: "def-twominute",
      title: "Two-Minute Defense",
      order: 5,
      provenance: { type: "synthetic", label: "Synthetic teaching scenario. Not a real NFL play: the game, teams and result are invented to teach one principle.", sources: [], fieldConfidence: { all: "synthetic" } },
      snap: { down: 2, dist: 10, yl100: 62, situation: "two-minute", offPers: "11", wrs: 3, ol: 5, fb: 0, formation: "Shotgun", kind: "pass", route: "Deep Out", airYards: 15, qtr: 4, clock: "1:42", offScore: 17, defScore: 20, box: 5, rushers: 4,
        desc: "A deep out at 15 yards to the sideline: a chunk gain and the clock stops." },
      context: { objective: "Protect the lead: keep them out of field goal range and keep the clock running.", scouting: "In the two-minute drill, 11 personnel throws quick and to the sidelines: completions that stop the clock." },
      read: {
        pers: "One back, one tight end, three receivers: 11 personnel, the standard hurry-up group.",
        likely: "Down 3 with under two minutes, they're throwing: quick throws about 4 in 10, intermediate routes to the sideline about 3 in 10."
      },
      why: {
        pkg: {
          heavy: "Linebackers covering receivers in a hurry-up: the worst match on the board.",
          base: "Three linebackers against three receivers: they'll find the linebacker.",
          nickel: "Five DBs, two linebackers: coverage, plus tacklers in the middle to keep the clock moving.",
          dime: "Six DBs is a close second; you give up a tackler in the middle if they run."
        },
        pressure: {
          four: "Rush four and cover with seven: no free shots, no clock-stopping big plays.",
          sim: "Simulated pressure is a close second: confusion without losing coverage.",
          fire: "Five rush leaves soft spots at the sideline.",
          man5: "Five-man man pressure: close, but a beaten man defender near the sideline means a chunk and a stopped clock.",
          zero: "Zero in the two-minute drill: the one call that can lose the game on one snap."
        },
        cov: {
          zero: "Nobody deep, with the game on the line.",
          man: "Cover 1: tight man contests the quick outs that stop the clock, and the free safety keeps the deep ball in front.",
          twoMan: "2-Man brackets deep but trailing defenders give up the sideline catch.",
          two: "Cover 2 corners squat on the out, but the hole behind them is the deep out.",
          three: "Cover 3 gives up the quick outs at the sideline.",
          quarters: "Quarters: soft at the sideline, where two-minute offenses live."
        },
        area: {
          run: "A run keeps the clock moving: you're happy to give it up.",
          quick: "Quick throws to the sideline are their most common call: contest them.",
          middle: "Intermediate sideline routes are their second choice.",
          deep: "The deep ball is what loses the game, but it's their third choice; the free safety has it."
        }
      },
      best: { pkg: "nickel", pressure: "four", cov: "man", area: "quick" },
      clues: [
        { text: "Under two minutes, down 3: they need about 30 yards for a field goal try.", kind: "meaningful" },
        { text: "Sideline routes stop the clock; tackles in the middle don't.", kind: "meaningful" },
        { text: "Soft zones look safe because nothing goes deep. They give up the sideline throws that win the drill.", kind: "deceptive" }
      ],
      next: "Contest the sideline and they'll throw underneath and run out of bounds after the catch. Rally, and tackle inbounds.",
      takeaway: "In the two-minute drill, rush four, contest the sideline throws that stop the clock, and keep a safety over the top. The blitz that might end the game is more likely to lose it.",
      learning: { tags: ["dc-coverage", "dc-situational"] },
      fit: { downs: [1, 2, 3], distance: [5, 15], situation: ["two-minute"], offPers: ["11", "10"], pkg: ["heavy", "base", "nickel", "dime", "quarter"], kinds: ["pass", "run"] }
    }
  ]
});
