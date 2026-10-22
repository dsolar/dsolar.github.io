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
      name: "Nickel fire zone, Cover 3 behind it",
      plain: "Five rush (the nickel and a linebacker blitz, an end drops). Three deep, three underneath. The safety on the blitz side rotates down to replace the nickel.",
      vulnerable: ["Seams against three deep", "The hook-curl windows between three underneath defenders", "Quick game away from the rotating safety"],
      counters: ["Stick and spacing", "Max-protected seams", "Screens away from the pressure"]
    },
    "cover-2-bluff": {
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
    "pressure-disguise": "Seeing through disguised pressure"
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
          { id: "SSB", label: "S", role: "Boundary safety", x: 17, y: 13 },
          { id: "DEB", label: "E", role: "Boundary end", x: 20.2, y: 1 },
          { id: "WILL", label: "W", role: "Will linebacker, mugged in the B-gap", x: 21.6, y: 2.6 },
          { id: "DT", label: "T", role: "Defensive tackle (3-technique)", x: 22.6, y: 1 },
          { id: "NT", label: "N", role: "Nose tackle", x: 24.1, y: 1 },
          { id: "MIKE", label: "M", role: "Mike linebacker", x: 25, y: 5 },
          { id: "DEF", label: "E", role: "Field end", x: 27.6, y: 1 },
          { id: "NB", label: "NB", role: "Nickel, walked down over the slot", x: 33.5, y: 2.2 },
          { id: "FSF", label: "S", role: "Field safety", x: 33, y: 13 },
          { id: "CBF", label: "CB", role: "Field corner", x: 44, y: 7 }
        ]
      },
      actual: {
        call: "fire-zone-3",
        pressure: "five",
        rushers: ["DT", "NT", "DEF", "WILL", "NB"],
        droppers: ["DEB", "MIKE"],
        coverage: "Cover 3 (fire zone)",
        rotation: "The field safety rotates down to replace the nickel; the boundary safety rotates to the deep middle.",
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
          SSB: { x: 26.5, y: 16, zone: "Deep middle" },
          FSF: { x: 36, y: 7, zone: "Curl-flat (replaces the nickel)" }
        },
        events: [
          { t: 0.3, text: "The nickel and the Will declare: five are coming." },
          { t: 0.5, text: "The boundary end drops out to the hook-curl. The line now has a 'rusher' who isn't rushing." },
          { t: 0.8, text: "The field safety rotates down to replace the nickel. The two-high picture becomes Cover 3." }
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
            explain: "Both safeties sit at 13 yards outside the hashes: two-high. That's what it shows, not what it promises. On third-and-6 with a nickel walked down, a rotation to one-high is a standard move."
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
          moves: { FSF: [34, 10.5], MIKE: [25.6, 5] },
          text: "Nobody traveled with the slot, and the field safety crept from 13 yards to 10. Zone, with that safety coming down. That's evidence, not proof: a well-coached defense can fake both.",
          clue: "No one followed the motion and the field safety crept to 10 yards: zone behind the pressure, with that safety rotating down."
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
          why: "Everyone is blocked, but three receivers against six droppers on third-and-6 is a math problem in the other direction.",
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
          conflict: "FSF",
          why: "Stick puts two receivers on the defender who replaces the nickel. If the rotating safety widens to the flat, the stick is open inside him; if he sits on the stick, the flat is open. It also gets the ball out before a fifth rusher arrives.",
          key: { answer: "FSF", partial: { NB: "The nickel decides your protection, not where this ball goes. The safety who replaces him is the read.", MIKE: "The Mike is the inside limit of the window, but the read is the safety who rotates down." } },
          routes: [
            { from: "H", path: [[34.5, 2], [35, 6], [34.2, 5.6]] },
            { from: "Y", path: [[30, 1], [37, 2.5], [41, 3]] },
            { from: "Z", path: [[44, 8], [45, 18]] },
            { from: "X", path: [[7.5, 2], [12, 5]] }
          ],
          assignments: [
            { player: "QB", assignment: "Read the field safety as he rotates down: flat if he sits, stick if he widens", key: "FSF", win: "Throws away from the safety on rhythm", fail: "Stares at the stick and the safety jumps it", p: 0.82, keyBonus: 0.1, critical: true },
            { player: "H", assignment: "Stick at 6 yards, settle between the Mike and the rotating safety", key: "MIKE", win: "Sits in the window facing the QB", fail: "Drifts outside into the safety", p: 0.85, critical: true },
            { player: "Y", assignment: "Arrow to the flat to widen the safety", key: "FSF", win: "Gets width fast enough to pull the safety", fail: "Gets rerouted and the safety never has to choose", p: 0.9, critical: true },
            { player: "Z", assignment: "Clear the field corner deep", key: "CBF", win: "Takes the corner out of the flat", fail: "Corner passes him off and squats", p: 0.95 }
          ]
        },
        {
          id: "verts", concept: "verts", label: "Four verticals",
          detail: "X and Z go, H and Y run the seams. The back checks, then releases.",
          need: 2.9, window: 0.56, yards: 24, spread: 8, intRisk: 0.12, luck: 0.1,
          grade: 76, category: "aggressive",
          conflict: "SSB",
          why: "Against three deep, two seams on one middle safety is a real advantage, and the payoff is a chunk play. But it needs nearly three seconds, which is exactly what a five-man pressure is built to deny.",
          key: { answer: "SSB", partial: { FSF: "He's the read on the stick. On verticals he rotates down and out of the picture; the deep-middle safety is the one choosing a seam." } },
          routes: [
            { from: "X", path: [[6.5, 18]] },
            { from: "Z", path: [[44, 18]] },
            { from: "H", path: [[34.5, 6], [33, 18]] },
            { from: "Y", path: [[29, 6], [28, 18]] }
          ],
          assignments: [
            { player: "QB", assignment: "Hold the deep-middle safety with his eyes, then throw the seam he leaves", key: "SSB", win: "Moves the safety and throws on time", fail: "Locks on one seam; the safety breaks on it", p: 0.72, keyBonus: 0.1, critical: true },
            { player: "H", assignment: "Seam: stay on the landmark outside the middle safety", key: "SSB", win: "Stays on his landmark through the throw", fail: "Drifts inside and gives the safety two routes in one spot", p: 0.75, critical: true },
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
          conflict: "FSF",
          why: "It's the most natural answer and the one this call is designed to bait. The nickel leaves, but the field safety is already rotating into exactly that window, and the Mike's hook drop squeezes it from inside.",
          key: { answer: "NB", partial: { FSF: "Right defender, wrong plan: if he's the threat, the slant shouldn't be the call." } },
          routes: [{ from: "H", path: [[34.5, 1], [30.5, 4.5]] }, { from: "Z", path: [[44, 1.5], [40.5, 5]] }],
          assignments: [
            { player: "QB", assignment: "Throw hot the moment the nickel declares", key: "NB", win: "Ball out in rhythm", fail: "Late; the safety has arrived", p: 0.95, critical: true },
            { player: "H", assignment: "Flat slant, inside the nickel's vacated spot", key: "FSF", win: "Catches it before the safety triggers", fail: "Runs into the rotating safety", p: 0.85, critical: true }
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
          why: "A real tool, but against a fire zone it throws into the replacement defender: the slant goes where the field safety is rotating."
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
          { id: "FSF", label: "S", role: "Field safety", x: 21, y: 13 },
          { id: "DEF", label: "E", role: "Field end", x: 26, y: 1 },
          { id: "MIKE", label: "M", role: "Mike linebacker", x: 28.6, y: 5 },
          { id: "NT", label: "N", role: "Nose tackle", x: 29.2, y: 1 },
          { id: "DT", label: "T", role: "Defensive tackle (3-technique)", x: 31.4, y: 1 },
          { id: "WILL", label: "W", role: "Will linebacker, mugged in the B-gap", x: 31.7, y: 2.6 },
          { id: "DEB", label: "E", role: "Boundary end", x: 33.6, y: 1 },
          { id: "SSB", label: "S", role: "Boundary safety", x: 37, y: 13 },
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
          FSF: { x: 17, y: 17, zone: "Deep half" },
          DEF: { x: 27, y: -3.5 },
          MIKE: { x: 27, y: 9, zone: "Middle hook" },
          NT: { x: 29.4, y: -3 },
          DT: { x: 31, y: -3 },
          WILL: { x: 34, y: 8, zone: "Curl (bluffed)" },
          DEB: { x: 33, y: -3.5 },
          SSB: { x: 40, y: 17, zone: "Deep half" },
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
          why: "Seven block four. Safe, but on second-and-7 against a bluff you've left four blockers with nobody to block.",
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
          key: { answer: "CBF", partial: { FSF: "He's the help over the top. The corner's choice decides the throw.", NB: "The nickel decides your protection. In Cover 2, he bails inside of smash." } },
          routes: [
            { from: "X", path: [[9, 5], [9.6, 4.2]] },
            { from: "H", path: [[17, 9], [11, 15]] },
            { from: "Y", path: [[35.5, 2], [42, 3]] },
            { from: "Z", path: [[46, 9], [45, 8]] }
          ],
          assignments: [
            { player: "QB", assignment: "Read the field corner: hitch if he sinks, corner route if he squats", key: "CBF", win: "Throws away from the corner on time", fail: "Throws the hitch into a squatting corner", p: 0.84, keyBonus: 0.1, critical: true },
            { player: "H", assignment: "Corner route: break at 10 to 12 yards, stay away from the halves safety", key: "FSF", win: "Climbs to the sideline, away from the safety", fail: "Flattens the route into the safety's range", p: 0.82, critical: true },
            { player: "X", assignment: "Hitch at 5: win inside and present your numbers", key: "CBF", win: "Squares up fast", fail: "Drifts and makes a tight window tighter", p: 0.9 }
          ]
        },
        {
          id: "verts", concept: "verts", label: "Four verticals",
          detail: "X and Z go, H and Y bend their seams away from the halves safeties.",
          need: 2.8, window: 0.6, yards: 22, spread: 8, intRisk: 0.1, luck: 0.1,
          grade: 80, category: "aggressive",
          conflict: "FSF",
          why: "Cover 2 is soft down the middle seams, and a four-man rush gives you time. It's a real shot, but it would have been a sack if the nickel had come. You couldn't know he wouldn't.",
          key: { answer: "FSF", partial: { MIKE: "In Tampa 2 the Mike runs the middle. Here he stays shallow, so the halves safety is the choice." } },
          routes: [
            { from: "X", path: [[9, 18]] },
            { from: "H", path: [[17, 7], [22, 18]] },
            { from: "Y", path: [[34.6, 7], [31, 18]] },
            { from: "Z", path: [[46, 18]] }
          ],
          assignments: [
            { player: "QB", assignment: "Hold the field safety with his eyes, throw the seam he leaves", key: "FSF", win: "Moves the safety and throws on time", fail: "Stares at H and the safety rides the seam", p: 0.74, keyBonus: 0.1, critical: true },
            { player: "H", assignment: "Bend the seam away from the halves safety", key: "FSF", win: "Splits the halves safeties", fail: "Runs into the safety's leverage", p: 0.76, critical: true }
          ]
        },
        {
          id: "draw", concept: "draw", label: "Draw",
          detail: "Show pass, let the four rushers come upfield, hand off behind them.",
          kind: "run", need: 0, window: 0.38, yards: 8, spread: 3, failYards: 3, failSpread: 2, luck: 0.04,
          grade: 80, category: "high-floor",
          conflict: "MIKE",
          why: "Against a four-man rush with both linebackers bailing, the box empties out. On second-and-7 a 4-yard draw sets up third-and-short. A real answer to the bluff, and still a reasonable call if the pressure is real.",
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
          why: "A sound floor: third-and-7 is better than a sack."
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
    }
  ]
});
