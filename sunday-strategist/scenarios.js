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
    "situational": "Situational football"
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
          { id: "CBB", label: "CB", role: "Boundary corner", x: 6.5, y: 7 },
          { id: "FS", label: "FS", role: "Free safety (boundary)", x: 17, y: 13 },
          { id: "DEB", label: "E", role: "Boundary end", x: 20.2, y: 1 },
          { id: "WILL", label: "W", role: "Will linebacker, mugged in the B-gap", x: 21.6, y: 2.6 },
          { id: "DT", label: "T", role: "Defensive tackle (3-technique)", x: 22.6, y: 1 },
          { id: "NT", label: "N", role: "Nose tackle", x: 24.1, y: 1 },
          { id: "MIKE", label: "M", role: "Mike linebacker", x: 25, y: 5 },
          { id: "DEF", label: "E", role: "Field end", x: 27.6, y: 1 },
          { id: "NB", label: "NB", role: "Nickel, walked down over the slot", x: 33.5, y: 2.2 },
          { id: "SS", label: "SS", role: "Strong safety (field, trips side)", x: 33, y: 13 },
          { id: "CBF", label: "CB", role: "Field corner", x: 44, y: 7 }
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
          { id: "CBF", label: "CB", role: "Field corner", x: 9, y: 6 },
          { id: "NB", label: "NB", role: "Nickel, walked down over the slot", x: 18, y: 2.2 },
          { id: "FS", label: "FS", role: "Free safety (field)", x: 21, y: 13 },
          { id: "DEF", label: "E", role: "Field end", x: 26, y: 1 },
          { id: "MIKE", label: "M", role: "Mike linebacker", x: 28.6, y: 5 },
          { id: "NT", label: "N", role: "Nose tackle", x: 29.2, y: 1 },
          { id: "DT", label: "T", role: "Defensive tackle (3-technique)", x: 31.4, y: 1 },
          { id: "WILL", label: "W", role: "Will linebacker, mugged in the B-gap", x: 31.7, y: 2.6 },
          { id: "DEB", label: "E", role: "Boundary end", x: 33.6, y: 1 },
          { id: "SS", label: "SS", role: "Strong safety (boundary, tight end side)", x: 37, y: 13 },
          { id: "CBB", label: "CB", role: "Boundary corner", x: 46, y: 7 }
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
          { id: "CBL", label: "CB", role: "Left corner, pressed on X", x: 8, y: 1.5 },
          { id: "NB", label: "NB", role: "Nickel, walked down over the slot", x: 18, y: 2 },
          { id: "SS", label: "SS", role: "Strong safety, down at 8 yards", x: 22, y: 8.5 },
          { id: "DEL", label: "E", role: "Left end", x: 23, y: 1 },
          { id: "WILL", label: "W", role: "Will linebacker", x: 24.6, y: 4.5 },
          { id: "DT", label: "T", role: "Defensive tackle", x: 25.2, y: 1 },
          { id: "FS", label: "FS", role: "Free safety, deep middle", x: 26.65, y: 13 },
          { id: "NT", label: "N", role: "Nose tackle", x: 27.5, y: 1 },
          { id: "MIKE", label: "M", role: "Mike linebacker", x: 28.4, y: 4.5 },
          { id: "DER", label: "E", role: "Right end", x: 30.6, y: 1 },
          { id: "CBR", label: "CB", role: "Right corner, pressed on Z", x: 45, y: 1.5 }
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
          { id: "CBL", label: "CB", role: "Left corner, pressed on Z", x: 7, y: 1.5 },
          { id: "NB", label: "NB", role: "Nickel, pressed on the slot", x: 15.5, y: 1.5 },
          { id: "SS", label: "SS", role: "Strong safety, walked down over the tight end", x: 24.5, y: 5.5 },
          { id: "DEL", label: "E", role: "Left end", x: 26.2, y: 1 },
          { id: "DT", label: "T", role: "Defensive tackle", x: 27.7, y: 1 },
          { id: "MIKE", label: "M", role: "Mike linebacker, mugged in the left A-gap", x: 29.08, y: 1.8 },
          { id: "WILL", label: "W", role: "Will linebacker, mugged in the right A-gap", x: 30.4, y: 1.8 },
          { id: "NT", label: "N", role: "Nose tackle", x: 31.7, y: 1 },
          { id: "DER", label: "E", role: "Right end", x: 33.5, y: 1 },
          { id: "FS", label: "FS", role: "Free safety, 9 yards over the back", x: 33, y: 9 },
          { id: "CBR", label: "CB", role: "Right corner, pressed on X", x: 47, y: 1.5 }
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
    }
  ]
});
