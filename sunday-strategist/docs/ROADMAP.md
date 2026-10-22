# Sunday Strategist: roadmap

**Done.**
- **Defensive coordinator mode:** switch sides on the start screen and call the defense on any film-room snap. Graded on expected points allowed, and the real play runs against your call.
- **LCB and RCB labels** on every corner, for coverage talk.
- Grades fitted to real data: `model.js`, from 86,500 snaps from 2023 to 2025. Every film-room option cites its real success rate and sample size, and lessons show the same data line next to their hand-made grades.
- Phases 1 to 3, slice-sized: the page, the data-driven scenario engine, schema validation, provenance, the explainable four-stage simulation, six grades, expected value over 400 reps, mastery tracking, the error taxonomy, revisit scheduling, unit tests and an end-to-end test.
- Four lessons: a nickel fire zone, the bluff into Cover 2, Cover 1 man pressure, and Cover 0.
- Phase 4: `tools/strategist_real.py` pulls real snaps that match each lesson from nflverse play-by-play, participation (NGS) and FTN charting for 2023 to 2025. There are 32 real snaps (8 per lesson, a spread of teams, seasons and outcomes, always one Patriots snap). They're shown with real teams, ESPN logos, the roster on the field, and a "What really happened" section with a confidence chip on every fact.

**Next, in order:**

- **Film room:** 408 more real snaps across 11 situations (1st & 10 through goal line and two-minute), with:
  - personnel groups 10 through 22, and base, nickel, dime and goal-line packages;
  - runs and passes about half and half;
  - every snap built into a full scenario by `gen.js`, and graded by rules: concept vs coverage from `data.matrix`, blockers vs the box for runs, and protection vs rushers.

1. **More lessons.** Add a Cover 3 rotation from the bluff picture, quarters and Cover 6 against four-man rushes, simulated pressure (creeper), and 2-Man on third and long. Each one adds a `fit`, and the importer fills it with real snaps automatically.
2. **Fresher real snaps.** nflverse hasn't published 2026 participation (coverage) data yet. When it does, rerun `python tools/strategist_real.py 2024 2025 2026`, or schedule it weekly in a GitHub Action like the site's other data jobs, for "last Sunday" snaps.
3. **Assistance levels.** Fade the help from all labels, to threats highlighted, to no labels, to a play clock, to motion and disguise.
4. **Teach-back mode.** Pick the conflict defender, the numbers advantage and the time requirement before the result shows.
5. **Coordinator mode (phase 7).** Connected drives, and an opposing coordinator archetype (Repeater, Counterpuncher, Disguiser, Pressure Gambler) that tracks your tendencies.
6. **An authoring page.** Diagram alignments by dragging players, export a scenario block, and validate it live.
7. **Expansion.** A Coverage Academy, run fits, the defensive coordinator side, daily challenges and a leaderboard (reusing Make the Call's Supabase setup).

**Open questions for David:** whether real team names go on screen for real plays (no logos either way), and when the page comes off the hidden list.
